#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const DEFAULT_URL = process.env.ARENA_BRIDGE_URL || 'http://127.0.0.1:8787';
const DEFAULT_EMITTER_TOKEN_PATH = fileURLToPath(
  new URL('../.arena/emitter-token', import.meta.url),
);

const HELP = `Arena driver — write real Codex subagent activity to the local arena bridge.

Usage:
  node scripts/arena-driver.mjs <command> [flags]

Run:
  reset          --objective TEXT
  run-complete   --summary TEXT
  run-cancel     --reason TEXT

Agent lifecycle:
  spawn          --agent ID --name TEXT --role TEXT [--parent ID]
  assign         --agent ID --objective TEXT [--task ID]
  activity       --agent ID --phase PHASE --summary TEXT [--status working]
  complete       --agent ID --summary TEXT
  fail           --agent ID --error TEXT
  stop           --agent ID --reason TEXT

Tools and communication:
  tool-start     --agent ID --tool NAME --summary TEXT [--call-id ID]
  tool-finish    --agent ID --call-id ID --outcome succeeded|failed [--summary TEXT]
  message        --agent ID --text TEXT [--channel commentary|final] [--target ID]
  block          --agent ID --reason approval|question|error --request TEXT [--prompt-id ID]
  resume         --agent ID --prompt-id ID [--response TEXT]

Protocol inspection:
  health
  events         [--after N]
  intents        [--after N]
  intent         --payload JSON|@FILE
  emit KIND      --payload JSON|@FILE [--agent ID] [--parent ID] [--task ID]

Global flags:
  --url URL       Bridge URL (default: ${DEFAULT_URL})
  --pretty        Pretty-print JSON output
  --help, -h      Show this help

Aliases: --agent-id, --parent-agent-id, --task-id, --correlation-id,
--tool-call-id, --prompt-id, and their shorter forms are accepted.
`;

const COMMAND_FLAGS = {
  health: [],
  events: ['after'],
  intents: ['after'],
  intent: ['payload'],
  reset: ['objective', 'correlation'],
  spawn: ['agent', 'name', 'role', 'parent', 'task', 'correlation'],
  assign: ['agent', 'objective', 'task', 'correlation'],
  activity: ['agent', 'phase', 'summary', 'status', 'task', 'correlation'],
  'tool-start': ['agent', 'tool', 'summary', 'call-id', 'task', 'correlation'],
  'tool-finish': [
    'agent',
    'call-id',
    'outcome',
    'summary',
    'task',
    'correlation',
  ],
  message: ['agent', 'channel', 'text', 'target', 'task', 'correlation'],
  block: ['agent', 'prompt-id', 'reason', 'request', 'task', 'correlation'],
  resume: ['agent', 'prompt-id', 'response', 'task', 'correlation'],
  complete: ['agent', 'summary', 'task', 'correlation'],
  fail: ['agent', 'error', 'task', 'correlation'],
  stop: ['agent', 'reason', 'task', 'correlation'],
  'run-complete': ['summary', 'correlation'],
  'run-cancel': ['reason', 'correlation'],
  emit: ['payload', 'agent', 'parent', 'task', 'correlation'],
};

const FLAG_ALIASES = {
  'agent-id': 'agent',
  'parent-agent-id': 'parent',
  'task-id': 'task',
  'correlation-id': 'correlation',
  'tool-call-id': 'call-id',
};

function parseCli(argv) {
  const positionals = [];
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      flags.help = true;
      continue;
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const [rawName, inlineValue] = token.slice(2).split(/=(.*)/s, 2);
    const name = FLAG_ALIASES[rawName] || rawName;
    if (name === 'pretty') {
      flags.pretty = true;
      continue;
    }

    const value = inlineValue ?? argv[++index];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${rawName} requires a value`);
    }
    flags[name] = value;
  }

  return { positionals, flags };
}

function validateFlags(command, flags) {
  const allowed = new Set([
    ...(COMMAND_FLAGS[command] || []),
    'url',
    'pretty',
    'help',
  ]);
  for (const name of Object.keys(flags)) {
    if (!allowed.has(name))
      throw new Error(`Unknown flag for ${command}: --${name}`);
  }
}

function required(flags, ...names) {
  for (const name of names) {
    if (typeof flags[name] !== 'string' || flags[name].trim() === '') {
      throw new Error(`--${name} is required`);
    }
  }
}

function identifier(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function jsonFlag(value) {
  if (!value) throw new Error('--payload is required');
  const raw = value.startsWith('@')
    ? await readFile(value.slice(1), 'utf8')
    : value;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('--payload must be valid JSON or @path-to-json');
  }
}

function eventMeta(flags) {
  return {
    ...(flags.agent ? { agentId: flags.agent } : {}),
    ...(flags.parent ? { parentAgentId: flags.parent } : {}),
    ...(flags.task ? { taskId: flags.task } : {}),
    ...(flags.correlation ? { correlationId: flags.correlation } : {}),
  };
}

async function request(baseUrl, path, init) {
  let response;
  try {
    response = await fetch(new URL(path, `${baseUrl.replace(/\/$/, '')}/`), {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    throw new Error(`Bridge unavailable at ${baseUrl}: ${error.message}`);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || `Bridge returned HTTP ${response.status}`);
  return body;
}

async function emitterToken() {
  const configured = process.env.ARENA_EMITTER_TOKEN?.trim();
  if (configured) return configured;
  try {
    const saved = (await readFile(DEFAULT_EMITTER_TOKEN_PATH, 'utf8')).trim();
    if (saved) return saved;
  } catch {
    // The error below explains the required startup order without exposing a secret.
  }
  throw new Error('Emitter token unavailable; start the local arena bridge first');
}

function emitBody(kind, payload, flags, extra = {}) {
  return {
    kind,
    payload,
    ...eventMeta(flags),
    ...extra,
  };
}

async function execute(command, args, flags, baseUrl) {
  if (command === 'health') return request(baseUrl, '/health');
  if (command === 'events' || command === 'intents') {
    const after = flags.after ?? '0';
    if (!/^\d+$/.test(after))
      throw new Error('--after must be a non-negative integer');
    return request(baseUrl, `/${command}?after=${after}`);
  }
  if (command === 'intent') {
    const intent = await jsonFlag(flags.payload);
    return request(baseUrl, '/intent', {
      method: 'POST',
      body: JSON.stringify({
        intentId: identifier('intent'),
        intent,
        sentAt: new Date().toISOString(),
      }),
    });
  }

  let body;
  switch (command) {
    case 'reset':
      required(flags, 'objective');
      body = emitBody('run.started', { objective: flags.objective }, flags, {
        reset: true,
      });
      break;
    case 'spawn':
      required(flags, 'agent', 'name', 'role');
      body = emitBody(
        'agent.spawned',
        { name: flags.name, role: flags.role },
        flags,
      );
      break;
    case 'assign':
      required(flags, 'agent', 'objective');
      flags.task ||= identifier(`task_${flags.agent}`);
      body = emitBody('task.assigned', { objective: flags.objective }, flags);
      break;
    case 'activity':
      required(flags, 'agent', 'phase', 'summary');
      body = emitBody(
        'agent.activity',
        {
          phase: flags.phase,
          status: flags.status || 'working',
          summary: flags.summary,
        },
        flags,
      );
      break;
    case 'tool-start':
      required(flags, 'agent', 'tool', 'summary');
      body = emitBody(
        'tool.started',
        {
          toolCallId: flags['call-id'] || identifier(`tool_${flags.agent}`),
          tool: flags.tool,
          summary: flags.summary,
        },
        flags,
      );
      break;
    case 'tool-finish':
      required(flags, 'agent', 'call-id', 'outcome');
      body = emitBody(
        'tool.finished',
        {
          toolCallId: flags['call-id'],
          outcome: flags.outcome,
          ...(flags.summary ? { summary: flags.summary } : {}),
        },
        flags,
      );
      break;
    case 'message':
      required(flags, 'agent', 'text');
      body = emitBody(
        'agent.message',
        {
          channel: flags.channel || 'commentary',
          text: flags.text,
          ...(flags.target ? { targetAgentId: flags.target } : {}),
        },
        flags,
      );
      break;
    case 'block':
      required(flags, 'agent', 'reason', 'request');
      body = emitBody(
        'agent.blocked',
        {
          promptId: flags['prompt-id'] || identifier(`prompt_${flags.agent}`),
          reason: flags.reason,
          request: flags.request,
        },
        flags,
      );
      break;
    case 'resume':
      required(flags, 'agent', 'prompt-id');
      body = emitBody(
        'agent.resumed',
        {
          promptId: flags['prompt-id'],
          ...(flags.response ? { response: flags.response } : {}),
        },
        flags,
      );
      break;
    case 'complete':
      required(flags, 'agent', 'summary');
      body = emitBody('agent.completed', { summary: flags.summary }, flags);
      break;
    case 'fail':
      required(flags, 'agent', 'error');
      body = emitBody('agent.failed', { error: flags.error }, flags);
      break;
    case 'stop':
      required(flags, 'agent', 'reason');
      body = emitBody('agent.stopped', { reason: flags.reason }, flags);
      break;
    case 'run-complete':
      required(flags, 'summary');
      body = emitBody('run.completed', { summary: flags.summary }, flags);
      break;
    case 'run-cancel':
      required(flags, 'reason');
      body = emitBody('run.canceled', { reason: flags.reason }, flags);
      break;
    case 'emit': {
      const kind = args[0];
      if (!kind) throw new Error('emit requires an event kind');
      body = emitBody(kind, await jsonFlag(flags.payload), flags);
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }

  return request(baseUrl, '/event', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'X-Arena-Emitter-Token': await emitterToken() },
  });
}

async function main() {
  const { positionals, flags } = parseCli(process.argv.slice(2));
  const command = positionals.shift();
  if (!command || flags.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!COMMAND_FLAGS[command]) throw new Error(`Unknown command: ${command}`);
  validateFlags(command, flags);
  if (command !== 'emit' && positionals.length > 0) {
    throw new Error(`Unexpected argument: ${positionals[0]}`);
  }
  if (command === 'emit' && positionals.length > 1) {
    throw new Error(`Unexpected argument: ${positionals[1]}`);
  }

  const result = await execute(
    command,
    positionals,
    flags,
    flags.url || DEFAULT_URL,
  );
  process.stdout.write(
    `${JSON.stringify(result, null, flags.pretty ? 2 : 0)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`arena-driver: ${error.message}\n`);
  process.exitCode = 1;
});
