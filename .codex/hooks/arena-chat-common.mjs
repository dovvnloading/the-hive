import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DATA_DIR = resolve(
  process.env.ARENA_DATA_DIR || resolve(PROJECT_ROOT, '.arena'),
);
const INGRESS_PATH = resolve(DATA_DIR, 'chat-ingress.jsonl');
const EVENTS_PATH = resolve(DATA_DIR, 'events.jsonl');
const CHAT_TOKEN_PATH = resolve(DATA_DIR, 'chat-token');
const REQUEST_TIMEOUT_MS = 1_750;

export async function readHookInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const value = JSON.parse(raw || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('hook input must be a JSON object');
  }
  return value;
}

export function stableIngressId(sessionId, turnId) {
  return `chat_${createHash('sha256')
    .update(`${sessionId}\0${turnId}`)
    .digest('hex')
    .slice(0, 32)}`;
}

function readJsonLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function requiredIdentifier(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/u.test(value)) {
    throw new Error(`${label} is missing or invalid`);
  }
  return value;
}

export function captureIngress(input) {
  const sessionId = requiredIdentifier(input.session_id, 'session_id');
  const turnId = requiredIdentifier(input.turn_id, 'turn_id');
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
    throw new Error('prompt is missing');
  }
  const ingressId = stableIngressId(sessionId, turnId);
  const prior = readJsonLines(INGRESS_PATH).find(
    (record) => record.ingressId === ingressId,
  );
  if (prior) {
    if (
      prior.sessionId !== sessionId ||
      prior.turnId !== turnId ||
      prior.prompt !== input.prompt
    ) {
      throw new Error('stable ingress id conflicts with an earlier payload');
    }
    return prior;
  }

  const record = {
    schemaVersion: 1,
    ingressId,
    sessionId,
    turnId,
    prompt: input.prompt,
    capturedAt: new Date().toISOString(),
    source: 'codex-chat',
  };
  mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(INGRESS_PATH, `${JSON.stringify(record)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return record;
}

function bridgeOrigin() {
  const configured = process.env.ARENA_BRIDGE_URL || 'http://127.0.0.1:8787';
  const url = new URL(configured);
  if (
    url.protocol !== 'http:' ||
    !new Set(['127.0.0.1', 'localhost', '[::1]']).has(url.hostname)
  ) {
    throw new Error('ARENA_BRIDGE_URL must be an HTTP loopback URL');
  }
  return url;
}

function chatToken() {
  const configured = process.env.ARENA_CHAT_TOKEN?.trim();
  if (configured) return configured;
  const saved = readFileSync(CHAT_TOKEN_PATH, 'utf8').trim();
  if (saved.length < 32) throw new Error('chat-hook credential is invalid');
  return saved;
}

export async function chatRequest(path, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(path, bridgeOrigin()), {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        'X-Arena-Chat-Token': chatToken(),
        ...init.headers,
      },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || `arena bridge returned ${response.status}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export function localChatStatus(ingressId) {
  const ingress = readJsonLines(EVENTS_PATH).find(
    (event) =>
      event.kind === 'chat.ingress' && event.payload?.ingressId === ingressId,
  );
  const captured = readJsonLines(INGRESS_PATH).find(
    (record) => record.ingressId === ingressId,
  );
  if (!ingress && !captured) return undefined;
  const latestRelay = readJsonLines(EVENTS_PATH)
    .filter(
      (event) =>
        event.kind === 'chat.relay' && event.payload?.ingressId === ingressId,
    )
    .at(-1);
  return {
    state: latestRelay?.payload?.state ?? 'received',
    terminal: new Set(['completed', 'failed']).has(latestRelay?.payload?.state),
  };
}

export function writeHookOutput(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
