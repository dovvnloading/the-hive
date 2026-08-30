#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const DEFAULT_URL = process.env.ARENA_BRIDGE_URL || 'http://127.0.0.1:8787';
const DEFAULT_EMITTER_TOKEN_PATH = fileURLToPath(
  new URL('../.arena/emitter-token', import.meta.url),
);
const DEFAULT_CHAT_TOKEN_PATH = fileURLToPath(
  new URL('../.arena/chat-token', import.meta.url),
);
const DEFAULT_AGENT_TOKEN_DIR = fileURLToPath(
  new URL('../.arena/agent-tokens/', import.meta.url),
);

const AGENT_PHASES = [
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
];
const AGENT_ACTIVITY_STATUSES = ['working', 'idle', 'blocked'];

const HELP = `Arena driver — write real Codex subagent activity to the local arena bridge.

Usage:
  node scripts/arena-driver.mjs <command> [flags]

Run:
  reset          --objective TEXT
  run-complete   --summary TEXT
  run-cancel     --reason TEXT

Codex chat access loop:
  chat-ingress   --session ID --turn ID --text TEXT [--ingress ID]
  chat-relay     --ingress ID --state claimed|dispatched|completed|failed
                 --summary TEXT [--targets ID,ID]
  chat-status    --ingress ID

Agent lifecycle:
  spawn          --agent ID --name TEXT --role TEXT [--parent ID]
  assign         --agent ID --objective TEXT [--task ID]
                 [--mode directed|self-directed]
  activity       --agent ID --phase PHASE --summary TEXT
                 [--status working|idle|blocked]
  complete       --agent ID --summary TEXT
  fail           --agent ID --error TEXT
  stop           --agent ID --reason TEXT

Agent environment and research:
  observe         --agent ID [--after N]
  move            --agent ID --to LOCATION --observation OBS_ID [--reason TEXT]
                  [--action-id ID]
  interact        --agent ID --target ENTITY --verb VERB --observation OBS_ID
                  [--action-id ID]
  speak           --agent ID --to ID --text TEXT --observation OBS_ID
                  [--reply-to SPEECH_ID] [--action-id ID]
  collab-invite   --agent ID --to ID --mode collaborate|recruit
                  --objective TEXT --text TEXT --observation OBS_ID
                  [--invitation ID] [--action-id ID]
  collab-respond  --agent ID --invitation ID --decision accept|decline
                  --text TEXT --observation OBS_ID [--action-id ID]
  context         --agent ID [--after N]
  research-select --agent ID --topic-id ID --title TEXT --question TEXT
                  [--parent-topic ID] [--reason TEXT]
  research-update --agent ID --topic-id ID --state active|blocked|complete|dropped
                  [--summary TEXT]
  artifact-record --agent ID --artifact-id ID --kind source-note|change|test-result|decision
                  --title TEXT --summary TEXT [--uri TEXT] [--topic-id ID]

Tools and communication:
  tool-start     --agent ID --tool NAME --summary TEXT [--capability NAME]
                 [--topic-id ID] [--call-id ID]
  tool-finish    --agent ID --call-id ID --outcome succeeded|failed [--summary TEXT]
                 [--artifact-ids ID,ID]
  message        --agent ID --text TEXT [--channel commentary|final] [--target ID]
  board-post     --agent ID --text TEXT [--to all|ID,ID] [--topic TEXT]
                 [--type update|question|decision|handoff] [--thread ID]
                 [--reply-to MESSAGE_ID] [--client-id ID]
                 [--topic-id ID] [--artifact-ids ID,ID]
  board-read     --agent ID [--after N] [--unread true|false] [--thread ID]
  board-ack      --agent ID --message MESSAGE_ID --state read|acknowledged|resolved
  journal-read   --agent ID [--after N]
  journal-write  --agent ID --text TEXT --observation OBS_ID [--title TEXT]
                 [--client-id ID]
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
  assign: ['agent', 'objective', 'task', 'mode', 'correlation'],
  activity: ['agent', 'phase', 'summary', 'status', 'task', 'correlation'],
  'tool-start': [
    'agent',
    'tool',
    'summary',
    'capability',
    'topic-id',
    'call-id',
    'task',
    'correlation',
  ],
  'tool-finish': [
    'agent',
    'call-id',
    'outcome',
    'summary',
    'artifact-ids',
    'task',
    'correlation',
  ],
  message: ['agent', 'channel', 'text', 'target', 'task', 'correlation'],
  'board-post': [
    'agent',
    'text',
    'to',
    'topic',
    'type',
    'thread',
    'reply-to',
    'client-id',
    'topic-id',
    'artifact-ids',
    'correlation',
  ],
  context: ['agent', 'after'],
  observe: ['agent', 'after'],
  move: ['agent', 'to', 'observation', 'reason', 'action-id'],
  interact: ['agent', 'target', 'verb', 'observation', 'action-id'],
  speak: ['agent', 'to', 'text', 'observation', 'reply-to', 'action-id'],
  'collab-invite': [
    'agent',
    'to',
    'mode',
    'objective',
    'text',
    'observation',
    'invitation',
    'action-id',
  ],
  'collab-respond': [
    'agent',
    'invitation',
    'decision',
    'text',
    'observation',
    'action-id',
  ],
  'research-select': [
    'agent',
    'topic-id',
    'parent-topic',
    'title',
    'question',
    'reason',
    'task',
    'correlation',
  ],
  'research-update': [
    'agent',
    'topic-id',
    'state',
    'summary',
    'task',
    'correlation',
  ],
  'artifact-record': [
    'agent',
    'artifact-id',
    'kind',
    'title',
    'summary',
    'uri',
    'topic-id',
    'task',
    'correlation',
  ],
  'board-read': ['agent', 'after', 'unread', 'thread'],
  'board-ack': ['agent', 'message', 'state'],
  'journal-read': ['agent', 'after'],
  'journal-write': ['agent', 'text', 'title', 'observation', 'client-id'],
  block: ['agent', 'prompt-id', 'reason', 'request', 'task', 'correlation'],
  resume: ['agent', 'prompt-id', 'response', 'task', 'correlation'],
  complete: ['agent', 'summary', 'task', 'correlation'],
  fail: ['agent', 'error', 'task', 'correlation'],
  stop: ['agent', 'reason', 'task', 'correlation'],
  'run-complete': ['summary', 'correlation'],
  'run-cancel': ['reason', 'correlation'],
  'chat-ingress': ['session', 'turn', 'text', 'ingress'],
  'chat-relay': ['ingress', 'state', 'summary', 'targets'],
  'chat-status': ['ingress'],
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

function commaIds(value) {
  return value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;
}

function identifier(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function chatIngressId(sessionId, turnId) {
  return `chat_${createHash('sha256')
    .update(`${sessionId}\0${turnId}`)
    .digest('hex')
    .slice(0, 32)}`;
}

function agentTokenPath(agentId) {
  return resolve(
    DEFAULT_AGENT_TOKEN_DIR,
    `${Buffer.from(agentId, 'utf8').toString('base64url')}.token`,
  );
}

async function saveAgentToken(agentId, token) {
  await mkdir(DEFAULT_AGENT_TOKEN_DIR, { recursive: true });
  await writeFile(agentTokenPath(agentId), `${token}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

async function agentToken(agentId) {
  const configured = process.env.ARENA_AGENT_TOKEN?.trim();
  if (configured) return configured;
  try {
    const saved = (await readFile(agentTokenPath(agentId), 'utf8')).trim();
    if (saved) return saved;
  } catch {
    // The error below gives the required order without printing credential data.
  }
  throw new Error(
    `Agent credential unavailable for ${agentId}; spawn it in the current run first`,
  );
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
  if (!response.ok) {
    const observation = body.observation?.text
      ? `\n${body.observation.text}`
      : '';
    throw new Error(
      `${body.error || `Bridge returned HTTP ${response.status}`}${observation}`,
    );
  }
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
  throw new Error(
    'Emitter token unavailable; start the local arena bridge first',
  );
}

async function chatToken() {
  const configured = process.env.ARENA_CHAT_TOKEN?.trim();
  if (configured) return configured;
  try {
    const saved = (await readFile(DEFAULT_CHAT_TOKEN_PATH, 'utf8')).trim();
    if (saved) return saved;
  } catch {
    // The error below explains the required startup order without exposing a secret.
  }
  throw new Error(
    'Chat-hook token unavailable; start the local arena bridge first',
  );
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
  if (command === 'context') {
    required(flags, 'agent');
    const after = flags.after ?? '0';
    if (!/^\d+$/.test(after))
      throw new Error('--after must be a non-negative integer');
    return request(baseUrl, `/agent/context?after=${after}`, {
      headers: { 'X-Arena-Agent-Token': await agentToken(flags.agent) },
    });
  }
  if (command === 'observe') {
    required(flags, 'agent');
    const after = flags.after ?? '0';
    if (!/^\d+$/.test(after))
      throw new Error('--after must be a non-negative integer');
    return request(baseUrl, `/agent/observation?after=${after}`, {
      headers: { 'X-Arena-Agent-Token': await agentToken(flags.agent) },
    });
  }
  if (command === 'move' || command === 'interact') {
    required(flags, 'agent', 'observation');
    if (command === 'move') required(flags, 'to');
    if (command === 'interact') required(flags, 'target', 'verb');
    return request(baseUrl, '/world/action', {
      method: 'POST',
      body: JSON.stringify({
        actionId: flags['action-id'] || identifier(`world_${flags.agent}`),
        observationId: flags.observation,
        action: command,
        targetId: command === 'move' ? flags.to : flags.target,
        ...(command === 'interact' ? { verb: flags.verb } : {}),
        ...(flags.reason ? { reason: flags.reason } : {}),
      }),
      headers: { 'X-Arena-Agent-Token': await agentToken(flags.agent) },
    });
  }
  if (
    command === 'speak' ||
    command === 'collab-invite' ||
    command === 'collab-respond'
  ) {
    required(flags, 'agent', 'text', 'observation');
    if (command === 'speak') required(flags, 'to');
    if (command === 'collab-invite') {
      required(flags, 'to', 'mode', 'objective');
      if (!new Set(['collaborate', 'recruit']).has(flags.mode)) {
        throw new Error('--mode must be collaborate or recruit');
      }
    }
    if (command === 'collab-respond') {
      required(flags, 'invitation', 'decision');
      if (!new Set(['accept', 'decline']).has(flags.decision)) {
        throw new Error('--decision must be accept or decline');
      }
    }
    const speechAct =
      command === 'speak'
        ? 'say'
        : command === 'collab-invite'
          ? 'invite'
          : flags.decision;
    return request(baseUrl, '/proximity/speech', {
      method: 'POST',
      body: JSON.stringify({
        actionId: flags['action-id'] || identifier(`speech_${flags.agent}`),
        observationId: flags.observation,
        speechAct,
        text: flags.text,
        ...(flags.to ? { targetAgentId: flags.to } : {}),
        ...(flags['reply-to'] ? { replyToSpeechId: flags['reply-to'] } : {}),
        ...(flags.invitation ? { invitationId: flags.invitation } : {}),
        ...(command === 'collab-invite'
          ? {
              invitationMode: flags.mode,
              objective: flags.objective,
            }
          : {}),
      }),
      headers: { 'X-Arena-Agent-Token': await agentToken(flags.agent) },
    });
  }
  if (command === 'chat-ingress') {
    required(flags, 'session', 'turn', 'text');
    return request(baseUrl, '/chat/ingress', {
      method: 'POST',
      body: JSON.stringify({
        ingressId: flags.ingress || chatIngressId(flags.session, flags.turn),
        sessionId: flags.session,
        turnId: flags.turn,
        prompt: flags.text,
        capturedAt: new Date().toISOString(),
      }),
      headers: { 'X-Arena-Chat-Token': await chatToken() },
    });
  }
  if (command === 'chat-relay') {
    required(flags, 'ingress', 'state', 'summary');
    const targets = flags.targets
      ? flags.targets
          .split(',')
          .map((agentId) => agentId.trim())
          .filter(Boolean)
      : undefined;
    return request(baseUrl, '/chat/relay', {
      method: 'POST',
      body: JSON.stringify({
        ingressId: flags.ingress,
        state: flags.state,
        summary: flags.summary,
        ...(targets ? { targetAgentIds: targets } : {}),
      }),
      headers: { 'X-Arena-Emitter-Token': await emitterToken() },
    });
  }
  if (command === 'chat-status') {
    required(flags, 'ingress');
    return request(
      baseUrl,
      `/chat/status?ingress=${encodeURIComponent(flags.ingress)}`,
      { headers: { 'X-Arena-Emitter-Token': await emitterToken() } },
    );
  }
  if (command === 'board-post') {
    required(flags, 'agent', 'text');
    const recipients =
      flags.to && flags.to !== 'all'
        ? flags.to
            .split(',')
            .map((agentId) => agentId.trim())
            .filter(Boolean)
        : [];
    const startsThread = !flags.thread && !flags['reply-to'];
    return request(baseUrl, '/board/message', {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: flags['client-id'] || identifier('client'),
        text: flags.text,
        messageType: flags.type || 'update',
        ...(startsThread || flags.to !== undefined
          ? {
              audience: recipients.length > 0 ? 'direct' : 'broadcast',
              recipientAgentIds: recipients,
            }
          : {}),
        ...(flags.topic ? { topic: flags.topic } : {}),
        ...(flags.thread ? { threadId: flags.thread } : {}),
        ...(flags['reply-to'] ? { replyToMessageId: flags['reply-to'] } : {}),
        ...(flags['topic-id'] ? { topicId: flags['topic-id'] } : {}),
        ...(flags['artifact-ids']
          ? { artifactIds: commaIds(flags['artifact-ids']) }
          : {}),
        ...(flags.correlation ? { correlationId: flags.correlation } : {}),
      }),
      headers: { 'X-Arena-Agent-Token': await agentToken(flags.agent) },
    });
  }
  if (command === 'board-read') {
    required(flags, 'agent');
    const after = flags.after ?? '0';
    if (!/^\d+$/.test(after)) {
      throw new Error('--after must be a non-negative integer');
    }
    if (
      flags.unread !== undefined &&
      flags.unread !== 'true' &&
      flags.unread !== 'false'
    ) {
      throw new Error('--unread must be true or false');
    }
    const parameters = new URLSearchParams({ after });
    if (flags.unread !== undefined) parameters.set('unread', flags.unread);
    if (flags.thread) parameters.set('thread', flags.thread);
    return request(baseUrl, `/board?${parameters}`, {
      headers: { 'X-Arena-Agent-Token': await agentToken(flags.agent) },
    });
  }
  if (command === 'board-ack') {
    required(flags, 'agent', 'message', 'state');
    return request(baseUrl, '/board/ack', {
      method: 'POST',
      body: JSON.stringify({
        messageId: flags.message,
        state: flags.state,
      }),
      headers: { 'X-Arena-Agent-Token': await agentToken(flags.agent) },
    });
  }
  if (command === 'journal-read') {
    required(flags, 'agent');
    const after = flags.after ?? '0';
    if (!/^\d+$/.test(after)) {
      throw new Error('--after must be a non-negative integer');
    }
    return request(baseUrl, `/journal?after=${after}`, {
      headers: { 'X-Arena-Agent-Token': await agentToken(flags.agent) },
    });
  }
  if (command === 'journal-write') {
    required(flags, 'agent', 'text', 'observation');
    return request(baseUrl, '/journal/note', {
      method: 'POST',
      body: JSON.stringify({
        clientNoteId: flags['client-id'] || identifier('note'),
        observationId: flags.observation,
        text: flags.text,
        ...(flags.title ? { title: flags.title } : {}),
      }),
      headers: { 'X-Arena-Agent-Token': await agentToken(flags.agent) },
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
      if (
        flags.mode &&
        !new Set(['directed', 'self-directed']).has(flags.mode)
      ) {
        throw new Error('--mode must be directed or self-directed');
      }
      flags.task ||= identifier(`task_${flags.agent}`);
      body = emitBody(
        'task.assigned',
        {
          objective: flags.objective,
          ...(flags.mode ? { mode: flags.mode } : {}),
        },
        flags,
      );
      break;
    case 'activity':
      required(flags, 'agent', 'phase', 'summary');
      if (!AGENT_PHASES.includes(flags.phase)) {
        throw new Error(`--phase must be one of: ${AGENT_PHASES.join(', ')}`);
      }
      if (flags.status && !AGENT_ACTIVITY_STATUSES.includes(flags.status)) {
        throw new Error(
          `--status must be one of: ${AGENT_ACTIVITY_STATUSES.join(', ')}`,
        );
      }
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
          ...(flags.capability ? { capability: flags.capability } : {}),
          ...(flags['topic-id'] ? { topicId: flags['topic-id'] } : {}),
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
          ...(flags['artifact-ids']
            ? { artifactIds: commaIds(flags['artifact-ids']) }
            : {}),
        },
        flags,
      );
      break;
    case 'research-select':
      required(flags, 'agent', 'topic-id', 'title', 'question');
      body = emitBody(
        'research.topic.selected',
        {
          topicId: flags['topic-id'],
          ...(flags['parent-topic']
            ? { parentTopicId: flags['parent-topic'] }
            : {}),
          title: flags.title,
          question: flags.question,
          ...(flags.reason ? { reason: flags.reason } : {}),
        },
        flags,
      );
      break;
    case 'research-update':
      required(flags, 'agent', 'topic-id', 'state');
      body = emitBody(
        'research.topic.updated',
        {
          topicId: flags['topic-id'],
          status: flags.state,
          ...(flags.summary ? { summary: flags.summary } : {}),
        },
        flags,
      );
      break;
    case 'artifact-record':
      required(flags, 'agent', 'artifact-id', 'kind', 'title', 'summary');
      body = emitBody(
        'artifact.recorded',
        {
          artifactId: flags['artifact-id'],
          kind: flags.kind,
          title: flags.title,
          summary: flags.summary,
          ...(flags.uri ? { uri: flags.uri } : {}),
          ...(flags['topic-id'] ? { topicId: flags['topic-id'] } : {}),
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

  const result = await request(baseUrl, '/event', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'X-Arena-Emitter-Token': await emitterToken() },
  });
  if (command === 'spawn' && result.agentToken) {
    await saveAgentToken(flags.agent, result.agentToken);
    return {
      event: result.event,
      credentialStored: true,
    };
  }
  if (
    flags.agent &&
    new Set([
      'activity',
      'tool-start',
      'tool-finish',
      'research-select',
      'research-update',
      'artifact-record',
      'resume',
    ]).has(command)
  ) {
    const observation = await request(baseUrl, '/agent/observation?after=0', {
      headers: { 'X-Arena-Agent-Token': await agentToken(flags.agent) },
    });
    return { ...result, observation };
  }
  return result;
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
