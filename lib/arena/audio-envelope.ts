const STEPS = 32;

/** Curve endpoints already hold their final value until the next automation. */
export function scheduleAudioEnvelope(
  parameter: Pick<AudioParam, 'setValueCurveAtTime'>,
  gain: number,
  start: number,
  duration: number,
  requestedFade: number,
) {
  const fade = Math.min(requestedFade, duration * 0.28);
  const fadeIn = Float32Array.from(
    { length: STEPS },
    (_, index) => gain * Math.sin(((index / (STEPS - 1)) * Math.PI) / 2),
  );
  const fadeOut = Float32Array.from(
    { length: STEPS },
    (_, index) => gain * Math.cos(((index / (STEPS - 1)) * Math.PI) / 2),
  );
  // Exact endpoints avoid both residual sound and redundant events that can
  // fall inside a curve when the audio clock advances between scheduling calls.
  fadeIn[0] = 0;
  fadeIn[STEPS - 1] = gain;
  fadeOut[0] = gain;
  fadeOut[STEPS - 1] = 0;
  parameter.setValueCurveAtTime(fadeIn, start, fade);
  parameter.setValueCurveAtTime(fadeOut, start + duration - fade, fade);
}

export function silenceAudioParameter(
  parameter: Pick<AudioParam, 'cancelScheduledValues' | 'setValueAtTime'>,
  at: number,
) {
  // Cancel from zero: canceling only future events leaves an active curve
  // intact and makes an immediate setValueAtTime overlap it.
  parameter.cancelScheduledValues(0);
  parameter.setValueAtTime(0, at);
}
