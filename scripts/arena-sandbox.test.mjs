import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  SandboxStore,
  PARTS,
  CABINET,
  BENCH,
  RIG,
  searchDocuments,
} from '../lib/arena/sandbox-store.mjs';

// Isolated contract fixtures. These are not facility residents or a live run.
function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'hive-sandbox-contract-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['docs', 'scripts', 'lib/arena'])
    mkdirSync(resolve(root, dir), { recursive: true });
  copyFileSync(
    resolve(import.meta.dirname, 'validate-sandbox-device.mjs'),
    resolve(root, 'scripts/validate-sandbox-device.mjs'),
  );
  copyFileSync(
    resolve(import.meta.dirname, '../lib/arena/sandbox-store.mjs'),
    resolve(root, 'lib/arena/sandbox-store.mjs'),
  );
  writeFileSync(
    resolve(root, 'docs/guide.md'),
    '# Workshop guide\nCopper lanterns illuminate the reading room.\n',
  );
  writeFileSync(
    resolve(root, 'docs/notes.md'),
    '# Notes\nLantern repair log.\n',
  );
  const events = [],
    artifacts = [],
    finished = new Set();
  let counter = 0;
  const options = {
    events,
    projectRoot: root,
    dataDir: resolve(root, '.arena'),
    append(payload, actor) {
      const event = {
        kind: 'sandbox.changed',
        sequence: events.length + 1,
        eventId: `event-${events.length + 1}`,
        payload: structuredClone(payload),
        ...actor,
      };
      events.push(event);
      return event;
    },
    recordArtifact(actor, payload) {
      const id = `artifact-${artifacts.length + 1}`;
      artifacts.push({ id, actor, ...payload });
      return id;
    },
    proofFinished(proof) {
      return (
        !!proof &&
        finished.has(
          `${proof.runId}/${proof.agentId}/${proof.toolCallId}/${proof.artifactId}`,
        )
      );
    },
  };
  const store = new SandboxStore(options);
  const actor = {
    agentId: 'contract-owner',
    runId: 'contract-run',
    locationId: CABINET,
    moving: false,
    vision: 'clear',
  };
  const request = (operation, fields = {}) => ({
    actionId: `action-${++counter}`,
    expectedRevision: store.state.revision,
    operation,
    ...fields,
  });
  const act = (operation, fields = {}) =>
    store.action(actor, request(operation, fields));
  const blueprint = (fields = {}) =>
    store.operator(
      request('blueprint', {
        title: 'Reading lantern',
        sources: ['docs/guide.md', 'docs/notes.md'],
        query: 'copper lanterns',
        expectedPath: 'docs/guide.md',
        ...fields,
      }),
    ).projectId;
  const finish = (proof) =>
    finished.add(
      `${proof.runId}/${proof.agentId}/${proof.toolCallId}/${proof.artifactId}`,
    );
  const utility = (operation) => {
    const build = operation === 'build';
    actor.locationId = build ? BENCH : RIG;
    actor.tool = {
      callId: `call-${++counter}`,
      capability: build ? 'build' : 'test',
      activityId: build
        ? 'build.compile-project'
        : 'verify.run-scoped-validation',
      resourceId: actor.locationId,
    };
    return actor.tool.callId;
  };
  const assemble = (projectId) => {
    actor.locationId = CABINET;
    for (const [part, quantity] of Object.entries(PARTS))
      act('take', { part, quantity });
    actor.locationId = BENCH;
    for (const [part, quantity] of Object.entries(PARTS))
      act('place', { part, quantity, projectId });
    act('assemble', { projectId });
  };
  return {
    root,
    store,
    options,
    events,
    artifacts,
    actor,
    request,
    act,
    blueprint,
    finish,
    utility,
    assemble,
  };
}

void test('acceptance suites run positive, exclusion and empty-result checks in the actual validator', (t) => {
  const f = fixture(t);
  const checks = [
    { query: 'copper', mode: 'contains', expectedPath: 'docs/guide.md' },
    { query: 'copper', mode: 'excludes', expectedPath: 'docs/notes.md' },
    { query: 'unfindable', mode: 'empty' },
  ];
  const id = f.blueprint({ checks });
  f.assemble(id);
  f.act('build', { projectId: id, toolCallId: f.utility('build') });
  f.finish(f.store.state.projects[0].build);
  const result = f.act('test', {
    projectId: id,
    toolCallId: f.utility('test'),
  });
  assert.equal(result.passed, true);
  assert.equal(JSON.parse(result.output).cases.length, 3);
  assert.ok(
    f.store.state.projects[0].validation.cases.every((check) => check.passed),
  );
  assert.throws(() => f.blueprint({ checks: [] }), /1–6/);
  assert.throws(() => f.blueprint({ checks: Array(7).fill(checks[0]) }), /1–6/);
  assert.throws(
    () => f.blueprint({ checks: [{ query: '???', mode: 'empty' }] }),
    /searchable/,
  );
  assert.throws(() => f.blueprint({ priority: '__proto__' }), /priority/);
  const failing = f.blueprint({ checks: [{ query: 'copper', mode: 'empty' }] });
  delete f.actor.tool;
  f.assemble(failing);
  f.act('build', { projectId: failing, toolCallId: f.utility('build') });
  f.finish(f.store.state.projects[1].build);
  assert.equal(
    f.act('test', { projectId: failing, toolCallId: f.utility('test') }).passed,
    false,
  );
  assert.equal(f.store.state.projects[1].stage, 'built');
});

void test('claims are voluntary, local and owned; inactive leads can be succeeded without impersonation', (t) => {
  const f = fixture(t),
    id = f.blueprint({
      purpose: 'Help find lighting guidance',
      priority: 'high',
    });
  assert.throws(() => f.act('claim', { projectId: id }), /Move to/);
  f.actor.locationId = 'comms-board';
  f.act('claim', { projectId: id });
  const other = {
    ...f.actor,
    agentId: 'second-contract-owner',
    name: 'Second owner',
  };
  assert.throws(
    () => f.store.action(other, f.request('claim', { projectId: id })),
    /Another resident/,
  );
  assert.throws(
    () => f.store.action(other, f.request('release', { projectId: id })),
    /Only the resident/,
  );
  assert.throws(
    () => f.store.operator(f.request('archive', { projectId: id })),
    /release/,
  );
  f.store.isActorActive = () => false;
  f.store.action(other, f.request('claim', { projectId: id }));
  assert.equal(f.store.state.projects[0].claim.agentId, other.agentId);
  f.actor.vision = 'dark';
  assert.throws(
    () => f.act('note', { projectId: id, text: 'Hidden note' }),
    /light/,
  );
  f.actor.vision = 'clear';
  f.act('note', {
    projectId: id,
    text: 'The first test should cover lighting.',
  });
  const revision = f.store.state.revision;
  const history = f.act('chronicle', { projectId: id });
  assert.equal(f.store.state.revision, revision);
  assert.match(history.items[0].summary, /first test/);
  assert.equal(history.items[1].actor, 'Second owner');
  f.store.action(other, f.request('release', { projectId: id }));
  assert.equal(f.store.state.projects[0].claim, undefined);
});

void test('cooperative contributions and salvage conserve every part across archive, fork and restart', (t) => {
  const f = fixture(t),
    id = f.blueprint();
  const partner = {
    ...f.actor,
    agentId: 'second-contract-owner',
    name: 'Second maker',
  };
  for (const [part, quantity] of Object.entries(PARTS)) {
    const carrier = part === 'oak-case' ? f.actor : partner;
    carrier.locationId = CABINET;
    f.store.action(carrier, f.request('take', { part, quantity }));
    carrier.locationId = BENCH;
    f.store.action(
      carrier,
      f.request('place', { part, quantity, projectId: id }),
    );
  }
  f.act('assemble', { projectId: id });
  const before = structuredClone(f.store.state.stock);
  const toolCallId = f.utility('build');
  f.act('build', { projectId: id, toolCallId });
  delete f.actor.tool;
  assert.throws(
    () => f.store.operator(f.request('archive', { projectId: id })),
    /Dismantle/,
  );
  f.actor.locationId = CABINET;
  f.act('take', { part: 'oak-case', quantity: 1 });
  f.actor.locationId = BENCH;
  assert.throws(() => f.act('dismantle', { projectId: id }), /satchel space/);
  f.actor.locationId = CABINET;
  f.act('return', { part: 'oak-case', quantity: 1 });
  f.actor.locationId = BENCH;
  f.act('dismantle', { projectId: id });
  assert.equal(f.store.state.projects[0].build, undefined);
  assert.throws(() => f.act('dismantle', { projectId: id }), /no parts/);
  assert.deepEqual(f.store.state.stock, before);
  f.actor.locationId = CABINET;
  for (const [part, quantity] of Object.entries(PARTS))
    f.act('return', { part, quantity });
  assert.deepEqual(f.store.state.stock, {
    'oak-case': 6,
    'index-core': 6,
    'brass-dial': 12,
  });
  f.store.operator(f.request('archive', { projectId: id }));
  assert.equal(f.store.local(f.actor, 'build', true).projects.length, 0);
  f.actor.locationId = BENCH;
  assert.throws(() => f.act('assemble', { projectId: id }), /archived/);
  const fork = f.store.operator(
    f.request('fork', { projectId: id, title: 'A second edition' }),
  );
  assert.deepEqual(f.store.state.projects[1].allocated, {});
  assert.equal(f.store.state.projects[1].parentId, id);
  assert.equal(
    f.store.history({ projectId: fork.projectId }).items[0].operation,
    'fork',
  );
  f.store.operator(f.request('reopen', { projectId: id }));
  const next = new SandboxStore(f.options);
  assert.equal(next.state.projects[0].contributors[0].actions.dismantle, 1);
  const dossier = next.dossier(id);
  assert.equal(dossier.contributions.length, 2);
  assert.deepEqual(dossier.contributions[0].actions, {
    place: 1,
    assemble: 1,
    build: 1,
    dismantle: 1,
  });
  assert.equal(dossier.contributions[1].name, 'Second maker');
  assert.deepEqual(dossier.contributions[1].actions, { place: 2 });
  assert.deepEqual(next.dossier(fork.projectId).contributions, []);
  assert.equal(
    next
      .history({ projectId: id })
      .items.filter((item) => item.operation === 'build').length,
    1,
  );
});

void test('diagnosis detects genuine source drift and corruption without manufacturing wear or modifying the device', (t) => {
  const f = fixture(t),
    id = f.blueprint();
  assert.equal(f.store.dossier(id).health.status, 'unbuilt');
  f.assemble(id);
  f.act('build', { projectId: id, toolCallId: f.utility('build') });
  const revision = f.store.state.revision;
  assert.equal(f.store.dossier(id).health.status, 'current');
  assert.equal(f.store.state.revision, revision);
  writeFileSync(resolve(f.root, 'docs/guide.md'), 'New source edition');
  assert.equal(f.store.dossier(id).health.status, 'source-changed');
  const result = f.act('diagnose', {
    projectId: id,
    toolCallId: f.utility('test'),
  });
  assert.equal(result.health.documents[0].status, 'changed');
  assert.ok(result.artifactId);
  assert.equal(f.store.state.projects[0].stage, 'built');
  writeFileSync(
    f.store.index(f.store.state.projects[0]).file,
    'Broken index bytes',
  );
  assert.equal(f.store.dossier(id).health.status, 'damaged');
  assert.equal(f.store.state.projects[0].diagnosis.status, 'source-changed');
  assert.equal(f.store.documents().documents.length, 2);
  assert.equal(f.store.documents().documents[0].path, 'docs/guide.md');
});

void test('history is paginated without exposing state snapshots or skipping prior records', (t) => {
  const f = fixture(t),
    id = f.blueprint();
  f.actor.locationId = BENCH;
  for (let i = 0; i < 45; i++)
    f.act('note', { projectId: id, text: `Actual contract note ${i}` });
  const first = f.store.history({ projectId: id });
  const second = f.store.history({ projectId: id, before: first.nextBefore });
  assert.equal(first.items.length, 40);
  assert.equal(second.items.length, 6);
  assert.equal(
    new Set([...first.items, ...second.items].map((item) => item.sequence))
      .size,
    46,
  );
  assert.equal('snapshot' in first.items[0], false);
  assert.equal('fingerprint' in first.items[0], false);
  assert.throws(() => f.store.history({ before: NaN }), /window/);
  assert.throws(() => f.store.history({ before: -1 }), /window/);
});

void test('portable stock is conserved, identity-bound, physically reachable and retry-safe', (t) => {
  const f = fixture(t);
  const id = f.blueprint();
  const take = f.request('take', { part: 'oak-case', quantity: 1 });
  f.store.action(f.actor, take);
  assert.equal(f.store.action(f.actor, take).created, false);
  assert.equal(f.store.state.stock['oak-case'], 5);
  assert.throws(
    () => f.store.action(f.actor, { ...take, quantity: 2 }),
    /different content/,
  );
  for (const part of ['__proto__', 'toString', 'missing'])
    assert.throws(() => f.act('take', { part, quantity: 1 }), /known part/);
  for (const quantity of [-1, 0, 0.5, 13])
    assert.throws(
      () => f.act('take', { part: 'oak-case', quantity }),
      /whole quantity/,
    );
  f.actor.locationId = BENCH;
  assert.throws(
    () => f.act('take', { part: 'oak-case', quantity: 1 }),
    /Move to parts-cabinet/,
  );
  const other = { ...f.actor, runId: 'different-run' };
  assert.throws(
    () =>
      f.store.action(
        other,
        f.request('place', { part: 'oak-case', quantity: 1, projectId: id }),
      ),
    /not in your satchel/,
  );
  f.actor.vision = 'dark';
  assert.throws(
    () => f.act('place', { part: 'oak-case', quantity: 1, projectId: id }),
    /light/,
  );
  assert.equal(f.store.local(f.actor, 'build', false).projects, undefined);
  f.actor.vision = 'clear';
  f.actor.moving = true;
  assert.throws(
    () => f.act('place', { part: 'oak-case', quantity: 1, projectId: id }),
    /moving/,
  );
  f.actor.moving = false;
  f.act('place', { part: 'oak-case', quantity: 1, projectId: id });
  assert.throws(() => f.act('assemble', { projectId: id }), /four required/);
  assert.equal(f.store.hasInventory(f.actor), false);
  assert.equal(f.store.state.projects[0].allocated['oak-case'], 1);
});

void test('actual build, subprocess validation and installed search share exact evidence and persist on restart', (t) => {
  const f = fixture(t),
    id = f.blueprint();
  f.assemble(id);
  assert.throws(() => f.act('build', { projectId: id }), /named utility/);
  let toolCallId = f.utility('build');
  const build = f.act('build', { projectId: id, toolCallId });
  assert.ok(build.artifactId);
  const project = () => f.store.state.projects[0];
  assert.ok(
    JSON.parse(
      readFileSync(
        resolve(f.root, '.arena/sandbox-devices', `${build.digest}.json`),
        'utf8',
      ),
    ).documents.length === 2,
  );
  toolCallId = f.utility('test');
  assert.throws(
    () => f.act('test', { projectId: id, toolCallId }),
    /Finish the successful build/,
  );
  f.finish(project().build);
  const validation = f.act('test', { projectId: id, toolCallId });
  assert.equal(validation.passed, true);
  assert.equal(JSON.parse(validation.output).expectedPath, 'docs/guide.md');
  f.actor.locationId = BENCH;
  delete f.actor.tool;
  assert.throws(
    () => f.act('install', { projectId: id }),
    /finished build and validation/,
  );
  f.finish(project().validation);
  f.act('install', { projectId: id });
  assert.equal(
    f.store.query(id, 'copper lanterns').results[0].path,
    'docs/guide.md',
  );
  assert.equal(
    f.act('use', { projectId: id, query: 'copper lanterns' }).results[0].path,
    'docs/guide.md',
  );
  const restored = new SandboxStore(f.options);
  assert.equal(
    restored.query(id, 'copper lanterns').results[0].path,
    'docs/guide.md',
  );
  assert.equal(restored.state.revision, f.store.state.revision);
  // Installed instruments intentionally search their captured edition.
  writeFileSync(resolve(f.root, 'docs/guide.md'), 'A different edition.');
  assert.equal(restored.query(id, 'copper lanterns').results.length, 1);
});

void test('failed searches, unfinished calls, source drift and corrupt indexes cannot unlock installation', (t) => {
  const f = fixture(t),
    id = f.blueprint({ query: 'unfindableword' });
  f.assemble(id);
  let toolCallId = f.utility('build');
  f.act('build', { projectId: id, toolCallId });
  f.finish(f.store.state.projects[0].build);
  toolCallId = f.utility('test');
  assert.equal(f.act('test', { projectId: id, toolCallId }).passed, false);
  assert.equal(f.store.state.projects[0].stage, 'built');
  f.actor.locationId = BENCH;
  delete f.actor.tool;
  assert.throws(() => f.act('install', { projectId: id }), /successful/);
  assert.match(f.artifacts.at(-1).summary, /^FAIL/);
  const build = f.store.state.projects[0].build;
  writeFileSync(
    resolve(f.root, '.arena/sandbox-devices', `${build.digest}.json`),
    'corrupted',
  );
  assert.throws(
    () => f.store.operator(f.request('save', { title: 'Corrupt' })),
    /changed/,
  );
});

void test('installation detects documentation changed since the passing build', (t) => {
  const f = fixture(t),
    id = f.blueprint();
  f.assemble(id);
  let toolCallId = f.utility('build');
  f.act('build', { projectId: id, toolCallId });
  f.finish(f.store.state.projects[0].build);
  toolCallId = f.utility('test');
  f.act('test', { projectId: id, toolCallId });
  f.finish(f.store.state.projects[0].validation);
  f.actor.locationId = BENCH;
  delete f.actor.tool;
  writeFileSync(resolve(f.root, 'docs/guide.md'), 'Changed content');
  assert.throws(
    () => f.act('install', { projectId: id }),
    /Source documents changed/,
  );
});

void test('checkpoint restoration is append-only and refuses occupied resources and carried parts', (t) => {
  const f = fixture(t);
  const id = f.blueprint();
  const saved = f.store.operator(
    f.request('save', { title: 'Before assembly' }),
  );
  const saveRevision = f.store.state.revision;
  f.act('take', { part: 'oak-case', quantity: 1 });
  assert.throws(
    () =>
      f.store.operator(
        f.request('restore', { checkpointId: saved.checkpointId }),
      ),
    /carried parts/,
  );
  assert.throws(
    () => f.store.operator(f.request('recover'), { busy: true }),
    /residents/,
  );
  f.act('return', { part: 'oak-case', quantity: 1 });
  f.assemble(id);
  assert.throws(
    () =>
      f.store.operator(
        f.request('restore', { checkpointId: saved.checkpointId }),
        { busy: true },
      ),
    /residents/,
  );
  f.store.operator(f.request('restore', { checkpointId: saved.checkpointId }));
  assert.equal(f.store.state.projects[0].stage, 'blueprint');
  assert.equal(f.store.state.stock['oak-case'], 6);
  assert.ok(f.store.state.revision > saveRevision);
  assert.deepEqual(
    f.events.map((event) => event.sequence),
    f.events.map((_, i) => i + 1),
  );
});

void test('blueprints reject paths outside approved documents and stale revisions', (t) => {
  const f = fixture(t);
  for (const path of [
    '.arena/private-journals.jsonl',
    'docs/../secret.md',
    'C:/secret.md',
    '//server/docs/a.md',
  ])
    assert.throws(() => f.blueprint({ sources: [path] }), /Markdown files/);
  assert.throws(
    () => f.blueprint({ expectedPath: 'docs/absent.md' }),
    /expected result/,
  );
  const stale = f.request('save', { title: 'Stale' });
  f.blueprint();
  assert.throws(() => f.store.operator(stale), /workshop changed/);
  assert.equal(f.store.state.revision, 1);
});

void test('search requires every distinct term, handles punctuation and ranks deterministically', () => {
  const documents = [
    { path: 'docs/b.md', content: 'Copper lantern. COPPER.' },
    { path: 'docs/a.md', content: 'Copper lantern.' },
    { path: 'docs/c.md', content: 'Copper only.' },
  ];
  assert.deepEqual(
    searchDocuments(documents, 'copper lantern').map((item) => item.path),
    ['docs/b.md', 'docs/a.md'],
  );
  assert.equal(searchDocuments(documents, '???').length, 0);
  assert.equal(searchDocuments(documents, 'copper missing').length, 0);
});

void test('revising a failed blueprint preserves parts but invalidates old evidence; a damaged index can be rebuilt', (t) => {
  const f = fixture(t),
    id = f.blueprint({ query: 'absent' });
  f.assemble(id);
  let toolCallId = f.utility('build');
  f.act('build', { projectId: id, toolCallId });
  const oldBuild = f.store.state.projects[0].build;
  f.finish(oldBuild);
  delete f.actor.tool;
  const revision = f.request('revise', {
    projectId: id,
    title: 'Corrected index',
    sources: ['docs/guide.md'],
    query: 'copper lanterns',
    expectedPath: 'docs/guide.md',
  });
  assert.throws(() => f.store.operator(revision, { busy: true }), /utility/);
  f.store.operator(revision);
  assert.equal(f.store.state.projects[0].blueprintRevision, 2);
  assert.equal(f.store.state.projects[0].stage, 'assembled');
  assert.equal(f.store.state.projects[0].build, undefined);
  assert.equal(f.store.state.stock['oak-case'], 5);
  toolCallId = f.utility('build');
  f.act('build', { projectId: id, toolCallId });
  const newBuild = f.store.state.projects[0].build;
  assert.notEqual(newBuild.digest, oldBuild.digest);
  writeFileSync(
    resolve(f.root, '.arena/sandbox-devices', `${newBuild.digest}.json`),
    'interrupted output',
  );
  f.act('build', { projectId: id, toolCallId });
  assert.equal(
    f.store.index(f.store.state.projects[0]).data.blueprintRevision,
    2,
  );
});
