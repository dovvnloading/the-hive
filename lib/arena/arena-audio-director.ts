import {
  allHiveSoundAssets,
  audioPanForPosition,
  HIVE_AUDIO_MIX,
  HIVE_MUSIC_TIMING,
  HIVE_MUSIC_TONE,
  HIVE_SOUND_POOLS,
  ShuffleBag,
  workSoundForAgent,
  type AudioAssetDefinition,
  type SoundPoolId,
  type WorkSoundId,
} from './audio-cues';
import type { RuntimeAgent } from './agentic-types';
import { scheduleAudioEnvelope, silenceAudioParameter } from './audio-envelope';

type ActiveLayer = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner?: StereoPannerNode;
};

type ActiveOneShot = Required<Pick<ActiveLayer, 'source' | 'gain'>> & {
  panner: StereoPannerNode;
};

type VariantLoop = {
  kind: SoundPoolId;
  stop: (immediate?: boolean) => void;
};

function randomBetween(
  [minimum, maximum]: readonly [number, number],
  random: () => number,
) {
  return minimum + (maximum - minimum) * random();
}

function softClipCurve(drive: number) {
  return Float32Array.from({ length: 1_024 }, (_, index) => {
    const input = (index / 1_023) * 2 - 1;
    return Math.tanh(input * drive) / drive;
  });
}

/**
 * Browser-only Web Audio graph. It consumes authoritative projected state but
 * never emits facility events or changes simulation behavior.
 */
export class ArenaAudioDirector {
  readonly context: AudioContext;
  private readonly random: () => number;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly bags = new Map<
    SoundPoolId,
    ShuffleBag<AudioAssetDefinition>
  >();
  private readonly activeWork = new Map<string, VariantLoop>();
  private readonly activeOneShots = new Set<ActiveOneShot>();
  private readonly duckTimers = new Set<number>();
  private ambientLoop?: VariantLoop;
  private musicSource?: ActiveLayer;
  private musicTimer?: number;
  private transientDucks = 0;
  private operational = false;
  private interfaceDucked = false;
  private destroyed = false;
  private contextDesiredRunning = false;
  private contextTransition: Promise<void> = Promise.resolve();

  private readonly masterBus: GainNode;
  private readonly effectsBus: GainNode;
  private readonly workBus: GainNode;
  private readonly ambienceBus: GainNode;
  private readonly musicBus: GainNode;
  private readonly musicInput: GainNode;

  constructor(context: AudioContext, random: () => number = Math.random) {
    this.context = context;
    this.random = random;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -18;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.24;

    this.masterBus = context.createGain();
    this.effectsBus = context.createGain();
    this.workBus = context.createGain();
    this.ambienceBus = context.createGain();
    this.musicBus = context.createGain();
    this.musicInput = context.createGain();

    this.masterBus.gain.value = HIVE_AUDIO_MIX.master;
    this.effectsBus.gain.value = HIVE_AUDIO_MIX.effects;
    this.workBus.gain.value = HIVE_AUDIO_MIX.work;
    this.ambienceBus.gain.value = HIVE_AUDIO_MIX.ambience;
    this.musicBus.gain.value = HIVE_AUDIO_MIX.music;

    this.effectsBus.connect(this.masterBus);
    this.workBus.connect(this.masterBus);
    this.ambienceBus.connect(this.masterBus);
    this.musicBus.connect(this.masterBus);
    this.masterBus.connect(limiter);
    limiter.connect(context.destination);

    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = HIVE_MUSIC_TONE.highpassHz;
    highpass.Q.value = 0.55;
    const presence = context.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = HIVE_MUSIC_TONE.presenceHz;
    presence.gain.value = HIVE_MUSIC_TONE.presenceDb;
    presence.Q.value = 0.7;
    const lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = HIVE_MUSIC_TONE.lowpassHz;
    lowpass.Q.value = 0.5;
    const saturation = context.createWaveShaper();
    saturation.curve = softClipCurve(HIVE_MUSIC_TONE.saturationDrive);
    saturation.oversample = '2x';
    this.musicInput
      .connect(highpass)
      .connect(presence)
      .connect(lowpass)
      .connect(saturation)
      .connect(this.musicBus);

    for (const [poolId, assets] of Object.entries(HIVE_SOUND_POOLS)) {
      this.bags.set(poolId as SoundPoolId, new ShuffleBag(assets, this.random));
    }
  }

  get loadedAssetCount() {
    return this.buffers.size;
  }

  async load() {
    const assets = allHiveSoundAssets();
    const results = await Promise.allSettled(
      assets.map(async (asset) => {
        const response = await fetch(asset.url, { cache: 'force-cache' });
        if (!response.ok) {
          throw new Error(
            `Audio asset ${asset.id} returned ${response.status}`,
          );
        }
        const encoded = await response.arrayBuffer();
        const decoded = await this.context.decodeAudioData(encoded);
        this.buffers.set(asset.id, decoded);
      }),
    );
    if (this.destroyed) return 0;
    const loaded = results.filter(
      (result) => result.status === 'fulfilled',
    ).length;
    if (loaded !== assets.length) {
      throw new Error(
        `Hive audio load incomplete: ${loaded}/${assets.length} assets decoded`,
      );
    }
    return loaded;
  }

  async resume() {
    if (this.destroyed) return;
    this.contextDesiredRunning = true;
    await this.reconcileContextState();
  }

  async suspend() {
    if (this.destroyed) return;
    this.contextDesiredRunning = false;
    await this.reconcileContextState();
  }

  setOperational(operational: boolean) {
    if (this.destroyed) return;
    if (this.operational === operational && operational) return;
    this.operational = operational;
    if (!operational) {
      // Suspension freezes Web Audio time. Clear every voice immediately so
      // a rapid resume cannot revive stale tails, loops, or ducking state.
      this.stopAmbient(true);
      this.stopAllWork(true);
      this.stopMusic(true);
      this.stopOneShots();
      this.cancelMusicTimer();
      for (const timer of this.duckTimers) window.clearTimeout(timer);
      this.duckTimers.clear();
      this.transientDucks = 0;
      this.updateMusicBus();
      return;
    }
    this.startAmbient();
    this.scheduleMusic(true);
  }

  setInterfaceDucked(ducked: boolean) {
    if (this.interfaceDucked === ducked) return;
    this.interfaceDucked = ducked;
    const now = this.context.currentTime;
    const ambientTarget =
      HIVE_AUDIO_MIX.ambience * (ducked ? HIVE_AUDIO_MIX.modalDuck : 1);
    this.ambienceBus.gain.setTargetAtTime(ambientTarget, now, 0.08);
    this.updateMusicBus();
  }

  playOneShot(poolId: SoundPoolId, pan = 0, allowWhenInactive = false) {
    if (
      this.destroyed ||
      this.context.state !== 'running' ||
      (!this.operational && !allowWhenInactive)
    ) {
      return false;
    }
    const asset = this.nextAsset(poolId);
    const buffer = this.buffers.get(asset.id);
    if (!buffer) return false;

    const offset = Math.min(asset.offsetSeconds ?? 0, buffer.duration - 0.01);
    const duration = Math.max(0.01, buffer.duration - offset);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    source.buffer = buffer;
    // Positional effects are near-mono; explicitly downmix before panning so
    // their stereo recording does not pull against the world position.
    gain.channelCount = 1;
    gain.channelCountMode = 'explicit';
    gain.channelInterpretation = 'speakers';
    panner.pan.value = Math.max(-0.65, Math.min(0.65, pan));
    source.connect(gain).connect(panner).connect(this.effectsBus);

    const now = this.context.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(asset.gain, now + 0.006);
    source.start(now, offset);
    const voice = { source, gain, panner };
    source.onended = () => {
      this.activeOneShots.delete(voice);
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
    this.activeOneShots.add(voice);
    this.duckMusicFor(duration + 0.25);
    return true;
  }

  syncWorkLoops(agents: readonly RuntimeAgent[]) {
    if (!this.operational) {
      this.stopAllWork();
      return;
    }
    const desired = new Map<string, { kind: WorkSoundId; pan: number }>();
    for (const agent of agents) {
      const kind = workSoundForAgent(agent);
      if (!kind) continue;
      desired.set(agent.id, {
        kind,
        pan: audioPanForPosition(agent.currentPosition),
      });
    }

    for (const [agentId, loop] of this.activeWork) {
      const target = desired.get(agentId);
      if (target?.kind === loop.kind) continue;
      loop.stop();
      this.activeWork.delete(agentId);
    }
    for (const [agentId, target] of desired) {
      if (this.activeWork.has(agentId)) continue;
      this.activeWork.set(
        agentId,
        this.startVariantLoop(
          target.kind,
          this.workBus,
          target.pan,
          0.14,
          this.random() * 220,
        ),
      );
    }
    this.updateWorkBus();
    this.updateMusicBus();
  }

  async destroy() {
    if (this.destroyed) return;
    this.setOperational(false);
    this.destroyed = true;
    for (const { source, gain, panner } of this.activeOneShots) {
      try {
        source.stop();
      } catch {
        // A voice may already have naturally ended.
      }
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
    }
    this.activeOneShots.clear();
    for (const timer of this.duckTimers) window.clearTimeout(timer);
    this.duckTimers.clear();
    await this.context.close();
  }

  private nextAsset(poolId: SoundPoolId) {
    const bag = this.bags.get(poolId);
    if (!bag) throw new Error(`Unknown sound pool: ${poolId}`);
    return bag.next();
  }

  private startAmbient() {
    if (this.ambientLoop || !this.operational) return;
    this.ambientLoop = this.startVariantLoop(
      'ambientOffice',
      this.ambienceBus,
      undefined,
      1.2,
    );
  }

  private stopAmbient(immediate = false) {
    this.ambientLoop?.stop(immediate);
    this.ambientLoop = undefined;
  }

  private startVariantLoop(
    poolId: SoundPoolId,
    bus: AudioNode,
    pan: number | undefined,
    crossfadeSeconds: number,
    initialDelayMs = 0,
  ): VariantLoop {
    let active = true;
    let timer: number | undefined;
    const layers = new Set<ActiveLayer>();

    const launch = () => {
      if (!active || this.destroyed || !this.operational) return;
      const asset = this.nextAsset(poolId);
      const buffer = this.buffers.get(asset.id);
      if (!buffer) {
        timer = window.setTimeout(launch, 100);
        return;
      }
      const offset = Math.min(asset.offsetSeconds ?? 0, buffer.duration - 0.01);
      const duration = Math.max(0.05, buffer.duration - offset);
      const fade = Math.min(crossfadeSeconds, duration * 0.28);
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = buffer;
      let tail: AudioNode = gain;
      let panner: StereoPannerNode | undefined;
      if (pan !== undefined) {
        gain.channelCount = 1;
        gain.channelCountMode = 'explicit';
        gain.channelInterpretation = 'speakers';
        panner = this.context.createStereoPanner();
        panner.pan.value = Math.max(-0.65, Math.min(0.65, pan));
        tail = panner;
        gain.connect(panner);
      }
      source.connect(gain);
      tail.connect(bus);

      const now = this.context.currentTime + 0.03;
      scheduleAudioEnvelope(gain.gain, asset.gain, now, duration, fade);
      source.start(now, offset);
      source.stop(now + duration + 0.02);

      const layer = { source, gain, panner };
      layers.add(layer);
      source.onended = () => {
        layers.delete(layer);
        source.disconnect();
        gain.disconnect();
        panner?.disconnect();
      };
      timer = window.setTimeout(
        launch,
        Math.max(50, (duration - fade) * 1_000),
      );
    };

    timer = window.setTimeout(launch, initialDelayMs);
    return {
      kind: poolId,
      stop: (immediate = false) => {
        if (!active) return;
        active = false;
        if (timer !== undefined) window.clearTimeout(timer);
        const now = this.context.currentTime;
        for (const layer of layers) {
          const { source, gain, panner } = layer;
          if (immediate) {
            source.onended = null;
            silenceAudioParameter(gain.gain, now);
            try {
              source.stop(now);
            } catch {
              // A layer may already have naturally ended.
            }
            source.disconnect();
            gain.disconnect();
            panner?.disconnect();
            layers.delete(layer);
            continue;
          }
          gain.gain.cancelAndHoldAtTime(now);
          gain.gain.linearRampToValueAtTime(0, now + 0.22);
          try {
            source.stop(now + 0.24);
          } catch {
            // A layer may already be in its natural tail.
          }
        }
      },
    };
  }

  private stopAllWork(immediate = false) {
    for (const loop of this.activeWork.values()) loop.stop(immediate);
    this.activeWork.clear();
    this.updateWorkBus();
    this.updateMusicBus();
  }

  private updateWorkBus() {
    const voiceScale = 1 / Math.sqrt(Math.max(1, this.activeWork.size));
    this.workBus.gain.setTargetAtTime(
      HIVE_AUDIO_MIX.work * voiceScale,
      this.context.currentTime,
      0.06,
    );
  }

  private scheduleMusic(first: boolean) {
    this.cancelMusicTimer();
    if (!this.operational || this.musicSource || this.destroyed) return;
    const range = first
      ? HIVE_MUSIC_TIMING.firstGapRangeMs
      : HIVE_MUSIC_TIMING.laterGapRangeMs;
    this.musicTimer = window.setTimeout(
      () => this.startMusic(),
      randomBetween(range, this.random),
    );
  }

  private startMusic() {
    this.musicTimer = undefined;
    if (!this.operational || this.musicSource || this.destroyed) return;
    const asset = this.nextAsset('loungeMusic');
    const buffer = this.buffers.get(asset.id);
    if (!buffer) {
      this.scheduleMusic(false);
      return;
    }
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.connect(gain).connect(this.musicInput);
    const now = this.context.currentTime + 0.03;
    const fade = Math.min(
      HIVE_MUSIC_TIMING.fadeSeconds,
      buffer.duration * 0.25,
    );
    scheduleAudioEnvelope(gain.gain, asset.gain, now, buffer.duration, fade);
    source.start(now);
    source.stop(now + buffer.duration + 0.02);
    this.musicSource = { source, gain };
    source.onended = () => {
      if (this.musicSource?.source === source) this.musicSource = undefined;
      source.disconnect();
      gain.disconnect();
      if (this.operational) this.scheduleMusic(false);
    };
  }

  private stopMusic(immediate = false) {
    const voice = this.musicSource;
    if (!voice) return;
    this.musicSource = undefined;
    const now = this.context.currentTime;
    if (immediate) {
      voice.source.onended = null;
      silenceAudioParameter(voice.gain.gain, now);
      try {
        voice.source.stop(now);
      } catch {
        // The track may already have naturally ended.
      }
      voice.source.disconnect();
      voice.gain.disconnect();
      return;
    }
    voice.gain.gain.cancelAndHoldAtTime(now);
    voice.gain.gain.linearRampToValueAtTime(0, now + 0.3);
    try {
      voice.source.stop(now + 0.32);
    } catch {
      // The track may already be ending.
    }
  }

  private cancelMusicTimer() {
    if (this.musicTimer !== undefined) window.clearTimeout(this.musicTimer);
    this.musicTimer = undefined;
  }

  private stopOneShots() {
    const now = this.context.currentTime;
    for (const voice of this.activeOneShots) {
      voice.source.onended = null;
      silenceAudioParameter(voice.gain.gain, now);
      try {
        voice.source.stop(now);
      } catch {
        // A voice may already have naturally ended.
      }
      voice.source.disconnect();
      voice.gain.disconnect();
      voice.panner.disconnect();
    }
    this.activeOneShots.clear();
  }

  private reconcileContextState() {
    this.contextTransition = this.contextTransition
      .catch(() => {
        // Later desired state changes must still reconcile after a browser
        // transition failure.
      })
      .then(async () => {
        while (!this.destroyed && this.context.state !== 'closed') {
          const desiredRunning = this.contextDesiredRunning;
          if (desiredRunning && this.context.state !== 'running') {
            await this.context.resume();
          } else if (!desiredRunning && this.context.state !== 'suspended') {
            await this.context.suspend();
          }
          if (desiredRunning === this.contextDesiredRunning) return;
        }
      });
    return this.contextTransition;
  }

  private duckMusicFor(durationSeconds: number) {
    this.transientDucks += 1;
    this.updateMusicBus();
    const timer = window.setTimeout(() => {
      this.duckTimers.delete(timer);
      this.transientDucks = Math.max(0, this.transientDucks - 1);
      this.updateMusicBus();
    }, durationSeconds * 1_000);
    this.duckTimers.add(timer);
  }

  private updateMusicBus() {
    const duck =
      (this.interfaceDucked ? HIVE_AUDIO_MIX.modalDuck : 1) *
      (this.activeWork.size > 0 ? HIVE_AUDIO_MIX.workMusicDuck : 1) *
      (this.transientDucks > 0 ? HIVE_AUDIO_MIX.effectMusicDuck : 1);
    this.musicBus.gain.setTargetAtTime(
      HIVE_AUDIO_MIX.music * duck,
      this.context.currentTime,
      0.08,
    );
  }
}
