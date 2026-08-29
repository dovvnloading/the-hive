#!/usr/bin/env node

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import process from 'node:process';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_BROWSER_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const EVENT_KINDS = new Set([
  'run.started',
  'run.completed',
  'run.canceled',
  'agent.spawned',
  'task.assigned',
  'agent.activity',
  'tool.started',
  'tool.finished',
  'agent.message',
  'agent.blocked',
  'agent.resumed',
  'agent.completed',
  'agent.failed',
  'agent.stopped',
]);

const AGENT_PHASES = new Set([
  'spawning',
  'planning',
  'delegating',
  'researching',
  'implementing',
  'tooling',
  'verifying',
  'synthesizing',
  'waiting',
  'completed',
  'failed',
  'canceled',
]);

const AGENT_EVENT_KINDS = new Set(
  [...EVENT_KINDS].filter((kind) => !kind.startsWith('run.')),
);

const OPERATOR_INTENTS = new Set([
  'SubmitObjective',
  'ReplyToPrompt',
  'ApprovePrompt',
  'SendFollowUp',
  'InterruptAgent',
  'CancelRun',
  'RetryRun',
]);

function parseArguments(argv) {
  const options = {
    port: Number(process.env.ARENA_BRIDGE_PORT || DEFAULT_PORT),
    dataDir: process.env.ARENA_DATA_DIR || resolve(process.cwd(), '.arena'),
    allowedOrigins: new Set(
      (process.env.ARENA_ALLOWED_ORIGINS || DEFAULT_BROWSER_ORIGINS.join(','))
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const [name, inlineValue] = token.split(/=(.*)/s, 2);
    if (name === '--port') {
      const value = inlineValue ?? argv[++index];
      options.port = Number(value);
    } else if (name === '--data-dir') {
      const value = inlineValue ?? argv[++index];
      if (!value) throw new Error('--data-dir requires a path');
      options.dataDir = resolve(value);
    } else if (name === '--help' || name === '-h') {
      process.stdout.write(
        'Usage: node scripts/arena-bridge.mjs [--port 8787] [--data-dir .arena]\n',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown bridge option: ${token}`);
    }
  }

  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65535
  ) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  return options;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasText(record, key) {
  return typeof record[key] === 'string' && record[key].trim().length > 0;
}

function optionalText(record, key) {
  return record[key] === undefined || typeof record[key] === 'string';
}

function assertPayload(kind, payload) {
  if (!isRecord(payload)) return 'payload must be a JSON object';

  switch (kind) {
    case 'run.started':
      return hasText(payload, 'objective')
        ? undefined
        : 'payload.objective is required';
    case 'run.completed':
    case 'agent.completed':
      return hasText(payload, 'summary')
        ? undefined
        : 'payload.summary is required';
    case 'run.canceled':
    case 'agent.stopped':
      return hasText(payload, 'reason')
        ? undefined
        : 'payload.reason is required';
    case 'agent.spawned':
      return hasText(payload, 'name') && hasText(payload, 'role')
        ? undefined
        : 'payload.name and payload.role are required';
    case 'task.assigned':
      return hasText(payload, 'objective')
        ? undefined
        : 'payload.objective is required';
    case 'agent.activity':
      if (!AGENT_PHASES.has(payload.phase)) return 'payload.phase is invalid';
      if (!new Set(['working', 'idle', 'blocked']).has(payload.status)) {
        return 'payload.status must be working, idle, or blocked';
      }
      return hasText(payload, 'summary')
        ? undefined
        : 'payload.summary is required';
    case 'tool.started':
      return hasText(payload, 'toolCallId') &&
        hasText(payload, 'tool') &&
        hasText(payload, 'summary')
        ? undefined
        : 'payload.toolCallId, payload.tool, and payload.summary are required';
    case 'tool.finished':
      if (!hasText(payload, 'toolCallId'))
        return 'payload.toolCallId is required';
      if (!new Set(['succeeded', 'failed']).has(payload.outcome)) {
        return 'payload.outcome must be succeeded or failed';
      }
      return optionalText(payload, 'summary')
        ? undefined
        : 'payload.summary must be a string';
    case 'agent.message':
      if (!new Set(['commentary', 'final']).has(payload.channel)) {
        return 'payload.channel must be commentary or final';
      }
      if (!hasText(payload, 'text')) return 'payload.text is required';
      return optionalText(payload, 'targetAgentId')
        ? undefined
        : 'payload.targetAgentId must be a string';
    case 'agent.blocked':
      if (!hasText(payload, 'promptId') || !hasText(payload, 'request')) {
        return 'payload.promptId and payload.request are required';
      }
      return new Set(['approval', 'question', 'error']).has(payload.reason)
        ? undefined
        : 'payload.reason must be approval, question, or error';
    case 'agent.resumed':
      if (!hasText(payload, 'promptId')) return 'payload.promptId is required';
      return optionalText(payload, 'response')
        ? undefined
        : 'payload.response must be a string';
    case 'agent.failed':
      return hasText(payload, 'error')
        ? undefined
        : 'payload.error is required';
    default:
      return `Unsupported event kind: ${kind}`;
  }
}

function validateIntent(intent) {
  if (!isRecord(intent) || !OPERATOR_INTENTS.has(intent.type)) {
    return 'intent.type is not supported';
  }

  switch (intent.type) {
    case 'SubmitObjective':
      return hasText(intent, 'objective')
        ? undefined
        : 'intent.objective is required';
    case 'ReplyToPrompt':
      return hasText(intent, 'promptId') && hasText(intent, 'content')
        ? undefined
        : 'intent.promptId and intent.content are required';
    case 'ApprovePrompt':
      return hasText(intent, 'promptId') && typeof intent.approved === 'boolean'
        ? undefined
        : 'intent.promptId and boolean intent.approved are required';
    case 'SendFollowUp':
      return hasText(intent, 'agentId') && hasText(intent, 'content')
        ? undefined
        : 'intent.agentId and intent.content are required';
    case 'InterruptAgent':
      return hasText(intent, 'agentId')
        ? undefined
        : 'intent.agentId is required';
    case 'CancelRun':
      return optionalText(intent, 'reason')
        ? undefined
        : 'intent.reason must be a string';
    case 'RetryRun':
      return undefined;
    default:
      return 'intent.type is not supported';
  }
}

function readJsonLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function readState(path, events, intents) {
  let saved = {};
  if (existsSync(path)) {
    try {
      saved = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      saved = {};
    }
  }

  const lastEvent = events.at(-1);
  const lastIntent = intents.at(-1);
  return {
    schemaVersion: 1,
    runId:
      typeof saved.runId === 'string'
        ? saved.runId
        : typeof lastEvent?.runId === 'string'
          ? lastEvent.runId
          : null,
    sequence: Math.max(
      Number(saved.sequence) || 0,
      Number(lastEvent?.sequence) || 0,
    ),
    intentSequence: Math.max(
      Number(saved.intentSequence) || 0,
      Number(lastIntent?.sequence) || 0,
    ),
    startedAt: typeof saved.startedAt === 'string' ? saved.startedAt : null,
    updatedAt: new Date().toISOString(),
  };
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !options.allowedOrigins.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}

function writeJson(request, response, status, body, extraHeaders = {}) {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(serialized),
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(request),
    ...extraHeaders,
  });
  response.end(serialized);
}

function readJsonBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectBody(new Error('Request body exceeds 1 MiB'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        rejectBody(new Error('Request body must be valid JSON'));
      }
    });
    request.on('error', rejectBody);
  });
}

function parseAfter(url) {
  const raw = url.searchParams.get('after') ?? '0';
  const after = Number(raw);
  if (!Number.isSafeInteger(after) || after < 0) return undefined;
  return after;
}

const options = parseArguments(process.argv.slice(2));
mkdirSync(options.dataDir, { recursive: true });

const statePath = resolve(options.dataDir, 'state.json');
const eventsPath = resolve(options.dataDir, 'events.jsonl');
const intentsPath = resolve(options.dataDir, 'intents.jsonl');
const emitterTokenPath = resolve(options.dataDir, 'emitter-token');

function loadEmitterToken() {
  const configured = process.env.ARENA_EMITTER_TOKEN?.trim();
  if (configured) return configured;

  if (existsSync(emitterTokenPath)) {
    const saved = readFileSync(emitterTokenPath, 'utf8').trim();
    if (saved.length >= 32) return saved;
  }

  const created = randomBytes(32).toString('base64url');
  writeFileSync(emitterTokenPath, `${created}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return created;
}

const emitterToken = loadEmitterToken();

function hasEmitterAuthority(request) {
  const raw = request.headers['x-arena-emitter-token'];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate !== 'string') return false;
  const supplied = Buffer.from(candidate);
  const expected = Buffer.from(emitterToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

let events = readJsonLines(eventsPath);
let intents = readJsonLines(intentsPath);
const state = readState(statePath, events, intents);

function persistState() {
  state.updatedAt = new Date().toISOString();
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function resetRun() {
  const now = new Date().toISOString();
  state.runId = `run_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  state.startedAt = now;
  events = [];
  intents = [];
  writeFileSync(eventsPath, '', 'utf8');
  writeFileSync(intentsPath, '', 'utf8');
  persistState();
}

function appendEvent(body) {
  const kind = body.kind;
  if (!EVENT_KINDS.has(kind))
    throw new Error(`Unsupported event kind: ${kind}`);

  const payloadError = assertPayload(kind, body.payload);
  if (payloadError) throw new Error(payloadError);

  if (kind === 'run.started') {
    if (body.reset !== true) {
      throw new Error('run.started requires reset: true');
    }
    resetRun();
  } else if (!state.runId) {
    throw new Error('No active run. Emit run.started with reset: true first.');
  }

  if (AGENT_EVENT_KINDS.has(kind) && !hasText(body, 'agentId')) {
    throw new Error(`${kind} requires agentId`);
  }

  state.sequence += 1;
  const event = {
    schemaVersion: 1,
    eventId: `evt_${randomUUID()}`,
    sequence: state.sequence,
    occurredAt: new Date().toISOString(),
    source: 'codex',
    runId: state.runId,
    ...(hasText(body, 'agentId') ? { agentId: body.agentId.trim() } : {}),
    ...(hasText(body, 'parentAgentId')
      ? { parentAgentId: body.parentAgentId.trim() }
      : {}),
    ...(hasText(body, 'taskId') ? { taskId: body.taskId.trim() } : {}),
    ...(hasText(body, 'correlationId')
      ? { correlationId: body.correlationId.trim() }
      : {}),
    kind,
    payload: body.payload,
  };

  events.push(event);
  appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
  persistState();
  return event;
}

function appendIntent(body) {
  const intent = isRecord(body.intent) ? body.intent : body;
  const intentId = hasText(body, 'intentId')
    ? body.intentId.trim()
    : `intent_${randomUUID()}`;
  const receivedAt = new Date().toISOString();
  const error = validateIntent(intent);

  if (error) {
    return {
      receipt: { intentId, accepted: false, receivedAt, reason: error },
      envelope: undefined,
    };
  }

  state.intentSequence += 1;
  const envelope = {
    schemaVersion: 1,
    intentId,
    sequence: state.intentSequence,
    occurredAt: receivedAt,
    source: 'operator',
    runId: state.runId ?? 'unbound',
    sentAt: hasText(body, 'sentAt') ? body.sentAt : undefined,
    intent,
  };
  if (envelope.sentAt === undefined) delete envelope.sentAt;

  intents.push(envelope);
  appendFileSync(intentsPath, `${JSON.stringify(envelope)}\n`, 'utf8');
  persistState();
  return {
    receipt: { intentId, accepted: true, receivedAt },
    envelope,
  };
}

persistState();

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${HOST}:${options.port}`);

  if (request.method === 'OPTIONS') {
    writeJson(request, response, 204, {});
    return;
  }

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      writeJson(request, response, 200, {
        ok: true,
        schemaVersion: 1,
        source: 'codex',
        runId: state.runId,
        latestSequence: state.sequence,
        latestIntentSequence: state.intentSequence,
        eventCount: events.length,
        intentCount: intents.length,
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/events') {
      const after = parseAfter(url);
      if (after === undefined) {
        writeJson(request, response, 400, {
          error: 'after must be a non-negative integer',
        });
        return;
      }
      writeJson(request, response, 200, {
        events: events.filter((event) => event.sequence > after),
        latestSequence: state.sequence,
        runId: state.runId,
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/intents') {
      const after = parseAfter(url);
      if (after === undefined) {
        writeJson(request, response, 400, {
          error: 'after must be a non-negative integer',
        });
        return;
      }
      writeJson(request, response, 200, {
        intents: intents.filter((intent) => intent.sequence > after),
        latestSequence: state.intentSequence,
        runId: state.runId,
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/event') {
      if (!hasEmitterAuthority(request)) {
        writeJson(request, response, 401, {
          error: 'Emitter authentication required',
        });
        return;
      }
      const body = await readJsonBody(request);
      try {
        const event = appendEvent(body);
        writeJson(request, response, 201, { event });
      } catch (error) {
        const status = error.message.startsWith('No active run') ? 409 : 400;
        writeJson(request, response, status, { error: error.message });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/intent') {
      const body = await readJsonBody(request);
      const { receipt } = appendIntent(body);
      writeJson(request, response, 200, { receipt });
      return;
    }

    writeJson(request, response, 404, { error: 'Not found' });
  } catch (error) {
    if (!response.headersSent) {
      writeJson(request, response, 400, { error: error.message || 'Request failed' });
    }
  }
});

server.on('error', (error) => {
  process.stderr.write(`[arena-bridge] ${error.message}\n`);
  process.exitCode = 1;
});

server.listen(options.port, HOST, () => {
  process.stdout.write(
    `[arena-bridge] http://${HOST}:${options.port} · ${options.dataDir}\n`,
  );
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
