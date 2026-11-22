import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

export const PARTS = Object.freeze({
  'oak-case': 1,
  'index-core': 1,
  'brass-dial': 2,
});
export const CABINET = 'parts-cabinet';
export const BENCH = 'build-bench-a';
export const RIG = 'verify-rig-b';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const copy = (value) => structuredClone(value);
const fail = (message, status = 409) => {
  throw Object.assign(new Error(message), { status });
};
const canonical = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
const bagKey = (actor) => `${actor.runId}:${actor.agentId}`;
const positive = (value) =>
  Number.isSafeInteger(value) && value > 0 && value <= 12;
const text = (value, max = 120) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function acceptanceChecks(project) {
  return (
    project.checks ?? [
      {
        query: project.query,
        mode: 'contains',
        expectedPath: project.expectedPath,
      },
    ]
  );
}

export function runAcceptance(documents, checks) {
  const cases = checks.map((check) => {
    const resultPaths = searchDocuments(documents, check.query).map(
      (result) => result.path,
    );
    const passed =
      check.mode === 'empty'
        ? resultPaths.length === 0
        : check.mode === 'excludes'
          ? !resultPaths.includes(check.expectedPath)
          : resultPaths.includes(check.expectedPath);
    return { ...check, passed, resultPaths };
  });
  return {
    passed: cases.length > 0 && cases.every((check) => check.passed),
    cases,
  };
}

export function initialSandbox() {
  return {
    schemaVersion: 1,
    revision: 0,
    stock: { 'oak-case': 6, 'index-core': 6, 'brass-dial': 12 },
    inventories: {},
    projects: [],
    checkpoints: [],
  };
}

/** This journal is the facility event journal; no second mutable authority exists. */
export class SandboxStore {
  constructor({
    events,
    append,
    recordArtifact,
    proofFinished,
    isActorActive = () => true,
    projectRoot,
    dataDir,
  }) {
    this.events = events;
    this.append = append;
    this.recordArtifact = recordArtifact;
    this.proofFinished = proofFinished;
    this.isActorActive = isActorActive;
    this.root = realpathSync(projectRoot);
    this.output = resolve(dataDir, 'sandbox-devices');
    mkdirSync(this.output, { recursive: true });
    this.state = copy(
      events.filter((event) => event.kind === 'sandbox.changed').at(-1)?.payload
        .snapshot ?? initialSandbox(),
    );
  }

  snapshot() {
    return copy(this.state);
  }
  hasInventory(actor) {
    return Object.values(
      this.state.inventories[bagKey(actor)]?.parts ?? {},
    ).some((count) => count > 0);
  }

  local(actor, roomId, clear) {
    const inventory = copy(this.state.inventories[bagKey(actor)]?.parts ?? {});
    return {
      inventory,
      ...(clear && roomId === 'research'
        ? { cabinet: copy(this.state.stock) }
        : {}),
      ...(clear && roomId === 'build'
        ? {
            projects: copy(
              this.state.projects.filter((project) => !project.archived),
            ),
          }
        : {}),
    };
  }

  receipt(actor, request) {
    if (!text(request.actionId, 160) || !/^[\w:-]+$/.test(request.actionId))
      fail('A valid actionId is required', 400);
    const identity = actor.agentId ? bagKey(actor) : 'operator';
    const fingerprint = digest(canonical(request));
    const prior = this.events.find(
      (event) =>
        event.kind === 'sandbox.changed' &&
        event.payload.identity === identity &&
        event.payload.actionId === request.actionId,
    );
    if (prior && prior.payload.fingerprint !== fingerprint)
      fail('actionId was already used for different content');
    return { identity, fingerprint, prior };
  }

  commit(actor, request, next, summary, result = {}) {
    const { identity, fingerprint } = this.receipt(actor, request);
    next.revision = this.state.revision + 1;
    const projectId = result.projectId ?? request.projectId;
    const project = next.projects.find((item) => item.id === projectId);
    if (
      project &&
      actor.agentId &&
      !['use', 'claim', 'release', 'note'].includes(request.operation)
    ) {
      const contributors = (project.contributors ??= []);
      let contributor = contributors.find(
        (item) => item.agentId === actor.agentId && item.runId === actor.runId,
      );
      if (!contributor) {
        contributor = {
          agentId: actor.agentId,
          runId: actor.runId,
          name: actor.name ?? actor.agentId,
          actions: {},
          firstAt: new Date().toISOString(),
        };
        contributors.push(contributor);
      }
      contributor.actions[request.operation] =
        (contributor.actions[request.operation] ?? 0) + 1;
      contributor.lastAt = new Date().toISOString();
    }
    const payload = {
      operation: request.operation,
      actionId: request.actionId,
      identity,
      actorName: actor.name ?? actor.agentId ?? 'Operator',
      fingerprint,
      revision: next.revision,
      summary,
      ...(projectId ? { projectId } : {}),
      result,
      snapshot: next,
    };
    const event = this.append(payload, actor);
    this.state = copy(next);
    return {
      created: true,
      eventId: event.eventId,
      ...result,
      snapshot: this.snapshot(),
    };
  }

  checkRevision(request) {
    if (request.expectedRevision !== this.state.revision)
      fail('The workshop changed; refresh before trying again');
  }

  operator(request, { busy = false } = {}) {
    const actor = {};
    const { prior } = this.receipt(actor, request);
    if (prior)
      return {
        created: false,
        ...prior.payload.result,
        snapshot: this.snapshot(),
      };
    this.checkRevision(request);
    const next = this.snapshot();
    if (
      ['fork', 'archive', 'reopen', 'commission'].includes(request.operation)
    ) {
      const original = next.projects.find(
        (item) => item.id === request.projectId,
      );
      if (!original) fail('That project is unavailable', 404);
      if (busy)
        fail('Wait until residents finish moving and using their tools');
      if (request.operation === 'fork') {
        if (
          next.projects.filter((item) => !item.archived).length >= 24 ||
          next.projects.length >= 128
        )
          fail('Archive an unused blueprint before adding another');
        if (!text(request.title, 72)) fail('Name the new edition', 400);
        const project = {
          id: `device_${randomUUID()}`,
          title: request.title.trim(),
          recipe: original.recipe,
          blueprintRevision: 1,
          sources: copy(original.sources),
          checks: copy(acceptanceChecks(original)),
          query: original.query,
          expectedPath: original.expectedPath,
          purpose: original.purpose ?? '',
          priority: original.priority ?? 'normal',
          parentId: original.id,
          parentRevision: original.blueprintRevision,
          stage: 'blueprint',
          allocated: {},
          createdAt: new Date().toISOString(),
        };
        next.projects.push(project);
        return this.commit(
          actor,
          { ...request },
          next,
          `New edition of ${original.title}: ${project.title}`,
          { projectId: project.id, parentId: original.id },
        );
      }
      if (request.operation === 'commission') {
        if (
          typeof request.purpose !== 'string' ||
          request.purpose.length > 600 ||
          !['low', 'normal', 'high'].includes(request.priority)
        )
          fail('Use a brief of up to 600 characters and a valid priority', 400);
        original.purpose = request.purpose.trim();
        original.priority = request.priority;
      } else {
        if (
          original.stage !== 'blueprint' ||
          Object.values(original.allocated).some((count) => count > 0)
        )
          fail('Dismantle the device and return its parts before archiving');
        if (original.claim && this.isActorActive(original.claim))
          fail('The current resident must release this commission first');
        if (
          request.operation === 'reopen' &&
          next.projects.filter((item) => !item.archived).length >= 24
        )
          fail('The active shelf is full');
        original.archived = request.operation === 'archive';
        delete original.claim;
      }
      return this.commit(
        actor,
        request,
        next,
        `${request.operation}: ${original.title}`,
      );
    }
    if (request.operation === 'blueprint' || request.operation === 'revise') {
      if (
        request.operation === 'blueprint' &&
        (next.projects.filter((item) => !item.archived).length >= 24 ||
          next.projects.length >= 128)
      )
        fail('The project shelf holds 24 blueprints');
      if (!text(request.title, 72))
        fail('Name the device and its search test', 400);
      if (
        !Array.isArray(request.sources) ||
        request.sources.length < 1 ||
        request.sources.length > 8
      )
        fail('Choose 1–8 documentation files', 400);
      const sources = [
        ...new Set(request.sources.map((path) => this.document(path).path)),
      ];
      const checks = request.checks ?? [
        {
          query: request.query,
          mode: 'contains',
          expectedPath: request.expectedPath,
        },
      ];
      if (!Array.isArray(checks) || checks.length < 1 || checks.length > 6)
        fail('Choose 1–6 acceptance checks', 400);
      for (const check of checks) {
        if (
          !check ||
          !text(check.query, 160) ||
          !/[\p{L}\p{N}]/u.test(check.query) ||
          !['contains', 'excludes', 'empty'].includes(check.mode)
        )
          fail(
            'Each check needs a searchable phrase and a valid expectation',
            400,
          );
        if (check.mode !== 'empty' && !sources.includes(check.expectedPath))
          fail(
            'The expected result must be one of the selected documents',
            400,
          );
      }
      if (
        request.purpose !== undefined &&
        (typeof request.purpose !== 'string' || request.purpose.length > 600)
      )
        fail('The commission brief is limited to 600 characters', 400);
      if (
        request.priority !== undefined &&
        !['low', 'normal', 'high'].includes(request.priority)
      )
        fail('Choose a valid priority', 400);
      const existing =
        request.operation === 'revise'
          ? next.projects.find((project) => project.id === request.projectId)
          : undefined;
      if (
        request.operation === 'revise' &&
        (!existing || existing.stage === 'installed' || existing.archived)
      )
        fail('Only an unfinished blueprint can be revised');
      if (existing && busy)
        fail(
          'Wait for the current utility to finish before revising its blueprint',
        );
      const project = {
        id: `device_${randomUUID()}`,
        title: request.title.trim(),
        recipe: 'document-index',
        blueprintRevision: 1,
        sources,
        checks: checks.map((check) => ({
          query: check.query.trim(),
          mode: check.mode,
          ...(check.mode !== 'empty'
            ? { expectedPath: check.expectedPath }
            : {}),
        })),
        query: checks[0].query.trim(),
        expectedPath: checks[0].expectedPath ?? '',
        purpose: request.purpose?.trim() ?? existing?.purpose ?? '',
        priority: request.priority ?? existing?.priority ?? 'normal',
        stage: 'blueprint',
        allocated: {},
        createdAt: new Date().toISOString(),
      };
      if (existing) {
        project.createdAt = existing.createdAt;
        project.contributors = existing.contributors ?? [];
        if (existing.claim) project.claim = existing.claim;
        if (existing.parentId) {
          project.parentId = existing.parentId;
          project.parentRevision = existing.parentRevision;
        }
        project.id = existing.id;
        project.blueprintRevision = existing.blueprintRevision + 1;
        project.allocated = existing.allocated;
        project.stage =
          existing.stage === 'blueprint' ? 'blueprint' : 'assembled';
        next.projects = next.projects.map((item) =>
          item.id === existing.id ? project : item,
        );
      } else next.projects.push(project);
      return this.commit(
        actor,
        request,
        next,
        `Blueprint laid out: ${project.title}`,
        { projectId: project.id },
      );
    }
    if (!['save', 'restore', 'recover'].includes(request.operation))
      fail('Unknown workshop operation', 400);
    if (busy) fail('Wait until residents finish moving and using their tools');
    const carrying = Object.values(next.inventories).some((bag) =>
      Object.values(bag.parts).some((count) => count > 0),
    );
    if (request.operation === 'recover') {
      for (const bag of Object.values(next.inventories))
        for (const [part, count] of Object.entries(bag.parts))
          next.stock[part] += count;
      next.inventories = {};
      return this.commit(
        actor,
        request,
        next,
        'Abandoned parts returned to the cabinet',
      );
    }
    if (carrying)
      fail(
        'Return carried parts to the cabinet or bench before saving or restoring',
      );
    if (request.operation === 'save') {
      if (!text(request.title, 72))
        fail('Give this saved workshop a name', 400);
      if (next.checkpoints.length >= 24)
        fail('The save shelf holds 24 checkpoints');
      this.checkDependencies(next.projects);
      const checkpoint = {
        id: `save_${randomUUID()}`,
        title: request.title.trim(),
        createdAt: new Date().toISOString(),
        revision: next.revision,
      };
      next.checkpoints.push(checkpoint);
      // The immutable pre-save snapshot remains in this append-only event itself.
      return this.commit(
        actor,
        request,
        next,
        `Workshop saved: ${checkpoint.title}`,
        { checkpointId: checkpoint.id },
      );
    }
    const checkpoint = next.checkpoints.find(
      (item) => item.id === request.checkpointId,
    );
    const saved = this.events.find(
      (event) =>
        event.kind === 'sandbox.changed' &&
        event.payload.operation === 'save' &&
        event.payload.result.checkpointId === request.checkpointId,
    );
    if (!checkpoint || !saved) fail('That saved workshop is unavailable', 404);
    this.checkDependencies(saved.payload.snapshot.projects);
    next.stock = copy(saved.payload.snapshot.stock);
    next.projects = copy(saved.payload.snapshot.projects);
    next.inventories = {};
    return this.commit(
      actor,
      request,
      next,
      `Workshop restored: ${checkpoint.title}`,
    );
  }

  document(path) {
    if (
      typeof path !== 'string' ||
      !/^docs\/[\w./ -]+\.md$/.test(path) ||
      path.includes('..') ||
      isAbsolute(path)
    )
      fail('Only Markdown files under docs/ may be indexed', 400);
    const candidate = resolve(this.root, path);
    if (!existsSync(candidate)) fail(`Document not found: ${path}`, 404);
    const real = realpathSync(candidate);
    const boundary = relative(resolve(this.root, 'docs'), real);
    if (
      boundary.startsWith(`..${sep}`) ||
      boundary === '..' ||
      isAbsolute(boundary)
    )
      fail('Document resolves outside docs/', 400);
    const size = statSync(real).size;
    if (size > 256_000 || !statSync(real).isFile())
      fail('Documents must be files smaller than 256 KB', 400);
    const content = readFileSync(real, 'utf8');
    return { path, content, digest: digest(content), bytes: size };
  }

  index(project) {
    if (!project.build || !/^[a-f0-9]{64}$/.test(project.build.digest))
      fail('This device has not been built');
    const file = resolve(this.output, `${project.build.digest}.json`);
    if (!existsSync(file))
      fail('The built index is missing; rebuild this device');
    const bytes = readFileSync(file);
    if (digest(bytes) !== project.build.digest)
      fail('The built index changed; rebuild and retest this device');
    return { file, data: JSON.parse(bytes.toString('utf8')) };
  }

  checkDependencies(projects) {
    for (const project of projects) if (project.build) this.index(project);
  }

  assertReach(actor, target) {
    if (actor.moving) fail('Finish moving before handling workshop objects');
    if (actor.vision !== 'clear')
      fail('Switch the room light on before handling workshop objects');
    if (actor.locationId !== target)
      fail(`Move to ${target} before this action`);
  }

  assertUtility(actor, request, operation) {
    const build = operation === 'build';
    const resource = build ? BENCH : RIG;
    this.assertReach(actor, resource);
    if (
      !actor.tool?.callId ||
      actor.tool.callId !== request.toolCallId ||
      actor.tool.resourceId !== resource ||
      actor.tool.capability !== (build ? 'build' : 'test') ||
      actor.tool.activityId !==
        (build ? 'build.compile-project' : 'verify.run-scoped-validation')
    )
      fail(
        'Engage the matching station and start its named utility before doing this work',
      );
  }

  action(actor, request) {
    const { prior } = this.receipt(actor, request);
    if (prior)
      return {
        created: false,
        ...prior.payload.result,
        snapshot: this.snapshot(),
      };
    this.checkRevision(request);
    const next = this.snapshot();
    const project = next.projects.find((item) => item.id === request.projectId);
    const operation = request.operation;
    if (project?.archived)
      fail('Reopen this archived blueprint before working on it');
    if (['claim', 'release', 'note', 'chronicle'].includes(operation)) {
      if (!project) fail('That blueprint is unavailable', 404);
      this.assertReach(
        actor,
        [BENCH, RIG, 'comms-board'].includes(actor.locationId)
          ? actor.locationId
          : BENCH,
      );
      if (actor.tool?.callId)
        fail('Finish the current utility before changing this commission');
      if (operation === 'chronicle')
        return {
          ...this.history({ projectId: project.id, before: request.before }),
          created: false,
        };
      if (operation === 'claim') {
        if (project.stage === 'installed')
          fail(
            'This commission is installed; create a new edition or inspect its condition',
          );
        if (
          project.claim &&
          bagKey(project.claim) !== bagKey(actor) &&
          this.isActorActive(project.claim)
        )
          fail('Another resident has claimed this commission');
        project.claim = {
          agentId: actor.agentId,
          runId: actor.runId,
          name: actor.name ?? actor.agentId,
          at: new Date().toISOString(),
        };
      } else if (operation === 'release') {
        if (!project.claim || bagKey(project.claim) !== bagKey(actor))
          fail('Only the resident who claimed this commission may release it');
        delete project.claim;
      } else if (!text(request.text, 1000))
        fail('Write a project note of 1–1000 characters', 400);
      return this.commit(
        actor,
        request,
        next,
        operation === 'note'
          ? `${project.title}: ${request.text.trim()}`
          : `${operation}: ${project.title}`,
      );
    }
    if (['take', 'return', 'place'].includes(operation)) {
      this.assertReach(actor, operation === 'place' ? BENCH : CABINET);
      if (actor.tool?.callId)
        fail('Finish the current utility before handling parts');
      if (!Object.hasOwn(PARTS, request.part) || !positive(request.quantity))
        fail('Choose a known part and a whole quantity from 1 to 12', 400);
      const bag = (next.inventories[bagKey(actor)] ??= {
        agentId: actor.agentId,
        runId: actor.runId,
        parts: {},
      });
      const quantity = request.quantity;
      if (operation === 'take') {
        if (
          Object.values(bag.parts).reduce((sum, count) => sum + count, 0) +
            quantity >
          4
        )
          fail('Your satchel holds four parts');
        if (next.stock[request.part] < quantity)
          fail('There are not enough parts in the cabinet');
        next.stock[request.part] -= quantity;
        bag.parts[request.part] = (bag.parts[request.part] ?? 0) + quantity;
      } else {
        if ((bag.parts[request.part] ?? 0) < quantity)
          fail('Those parts are not in your satchel');
        if (operation === 'place') {
          if (!project || project.stage !== 'blueprint')
            fail('Choose an unassembled blueprint at the bench');
          if (
            (project.allocated[request.part] ?? 0) + quantity >
            PARTS[request.part]
          )
            fail('This blueprint already has enough of that part');
          project.allocated[request.part] =
            (project.allocated[request.part] ?? 0) + quantity;
        } else next.stock[request.part] += quantity;
        bag.parts[request.part] -= quantity;
      }
      return this.commit(
        actor,
        request,
        next,
        `${operation}: ${quantity} ${request.part}`,
      );
    }
    if (!project) fail('That blueprint is unavailable', 404);
    if (operation === 'diagnose') {
      this.assertUtility(actor, request, 'test');
      const health = this.diagnose(project);
      const summary = `Condition of ${project.title}: ${health.status}. ${health.documents.map((doc) => `${doc.path}: ${doc.status}`).join('; ')}`;
      const artifactId = this.recordArtifact(actor, {
        kind: 'test-result',
        title: `Condition: ${project.title}`,
        summary,
      });
      project.diagnosis = {
        ...health,
        artifactId,
        agentId: actor.agentId,
        runId: actor.runId,
        toolCallId: actor.tool.callId,
      };
      return this.commit(actor, request, next, summary, { artifactId, health });
    }
    if (['build', 'test'].includes(operation)) {
      this.assertUtility(actor, request, operation);
      if (
        !['assembled', 'built', 'verified', 'installed'].includes(project.stage)
      )
        fail('Assemble the parts before building or testing');
      if (operation === 'build') {
        const documents = project.sources.map((path) => this.document(path));
        const data = {
          schemaVersion: 1,
          projectId: project.id,
          blueprintRevision: project.blueprintRevision,
          documents,
        };
        const bytes = JSON.stringify(data);
        const hash = digest(bytes);
        const file = resolve(this.output, `${hash}.json`);
        // Immutable content-addressed output also makes saved devices restorable.
        if (!existsSync(file) || digest(readFileSync(file)) !== hash) {
          const temporary = resolve(this.output, `${randomUUID()}.tmp`);
          writeFileSync(temporary, bytes, { flag: 'wx' });
          if (digest(readFileSync(temporary)) !== hash)
            fail('The index could not be written intact');
          renameSync(temporary, file);
        }
        const summary = `Built ${project.title}: ${documents.length} documents, ${documents.reduce((sum, doc) => sum + doc.bytes, 0)} bytes; SHA256 ${hash}`;
        const artifactId = this.recordArtifact(actor, {
          kind: 'test-result',
          title: `Build: ${project.title}`,
          summary,
          uri: file,
        });
        project.build = {
          digest: hash,
          runId: actor.runId,
          agentId: actor.agentId,
          toolCallId: actor.tool.callId,
          artifactId,
          blueprintRevision: project.blueprintRevision,
          at: new Date().toISOString(),
        };
        delete project.validation;
        project.stage = 'built';
        return this.commit(actor, request, next, summary, {
          artifactId,
          digest: hash,
        });
      }
      const { file } = this.index(project);
      if (!this.proofFinished(project.build))
        fail('Finish the successful build utility before testing');
      const check = spawnSync(
        process.execPath,
        [
          resolve(this.root, 'scripts/validate-sandbox-device.mjs'),
          file,
          '--suite',
          JSON.stringify(acceptanceChecks(project)),
        ],
        {
          encoding: 'utf8',
          timeout: 10_000,
          maxBuffer: 64_000,
          windowsHide: true,
        },
      );
      const output = (
        check.stdout ||
        check.stderr ||
        check.error?.message ||
        'No validation output'
      )
        .trim()
        .slice(0, 4000);
      const passed = check.status === 0;
      let cases = [];
      try {
        cases = JSON.parse(check.stdout).cases ?? [];
      } catch {
        /* Failed validator output stays available below. */
      }
      const summary = `${passed ? 'PASS' : 'FAIL'} ${project.title}: ${output}`;
      const artifactId = this.recordArtifact(actor, {
        kind: 'test-result',
        title: `Validation: ${project.title}`,
        summary,
        uri: file,
      });
      project.validation = {
        ...project.build,
        runId: actor.runId,
        agentId: actor.agentId,
        toolCallId: actor.tool.callId,
        artifactId,
        passed,
        cases,
        output,
        at: new Date().toISOString(),
      };
      project.stage = passed ? 'verified' : 'built';
      return this.commit(actor, request, next, summary, {
        artifactId,
        passed,
        output,
      });
    }
    this.assertReach(actor, BENCH);
    if (actor.tool?.callId)
      fail('Finish the current utility before handling this device');
    if (operation === 'assemble') {
      if (
        project.stage !== 'blueprint' ||
        Object.entries(PARTS).some(
          ([part, count]) => project.allocated[part] !== count,
        )
      )
        fail(
          'Place all four required parts beside this blueprint before assembly',
        );
      project.stage = 'assembled';
    } else if (operation === 'install') {
      if (
        project.stage !== 'verified' ||
        !project.validation?.passed ||
        project.validation.digest !== project.build?.digest ||
        !this.proofFinished(project.build) ||
        !this.proofFinished(project.validation)
      )
        fail(
          'Installation needs this device’s successful, finished build and validation calls',
        );
      const { data } = this.index(project);
      if (
        data.documents.some(
          (doc) => this.document(doc.path).digest !== doc.digest,
        )
      )
        fail(
          'Source documents changed; rebuild and retest before installation',
        );
      project.stage = 'installed';
      project.installedAt = new Date().toISOString();
      delete project.claim;
    } else if (operation === 'dismantle') {
      const count = Object.values(project.allocated).reduce(
        (total, value) => total + value,
        0,
      );
      if (!count) fail('There are no parts to recover from this blueprint');
      const bag = (next.inventories[bagKey(actor)] ??= {
        agentId: actor.agentId,
        runId: actor.runId,
        parts: {},
      });
      if (
        Object.values(bag.parts).reduce((sum, value) => sum + value, 0) +
          count >
        4
      )
        fail('Empty enough satchel space to recover all device parts');
      for (const [part, quantity] of Object.entries(project.allocated))
        bag.parts[part] = (bag.parts[part] ?? 0) + quantity;
      project.allocated = {};
      project.stage = 'blueprint';
      delete project.build;
      delete project.validation;
      delete project.installedAt;
      delete project.diagnosis;
    } else if (operation === 'use') {
      const result = this.query(project.id, request.query);
      project.uses = (project.uses ?? 0) + 1;
      project.lastUsedAt = new Date().toISOString();
      return this.commit(
        actor,
        request,
        next,
        `Searched ${project.title}: ${request.query}`,
        result,
      );
    } else fail('Unknown device action', 400);
    return this.commit(actor, request, next, `${operation}: ${project.title}`);
  }

  query(projectId, query) {
    const project = this.state.projects.find((item) => item.id === projectId);
    if (project?.stage !== 'installed')
      fail('Install this device before using it');
    if (!text(query, 160)) fail('Enter a search of 1–160 characters', 400);
    const { data } = this.index(project);
    return {
      results: searchDocuments(data.documents, query),
      indexedAt: project.build.at,
      digest: project.build.digest,
    };
  }

  diagnose(project) {
    const at = new Date().toISOString();
    if (!project.build)
      return { at, status: 'unbuilt', integrity: 'unbuilt', documents: [] };
    let data;
    try {
      data = this.index(project).data;
    } catch {
      return { at, status: 'damaged', integrity: 'damaged', documents: [] };
    }
    const documents = data.documents.map((doc) => {
      try {
        const current = this.document(doc.path);
        return {
          path: doc.path,
          status: current.digest === doc.digest ? 'current' : 'changed',
          indexedBytes: doc.bytes,
          currentBytes: current.bytes,
        };
      } catch {
        return {
          path: doc.path,
          status: 'unavailable',
          indexedBytes: doc.bytes,
        };
      }
    });
    return {
      at,
      integrity: 'intact',
      status: documents.every((doc) => doc.status === 'current')
        ? 'current'
        : 'source-changed',
      documents,
    };
  }

  history({ projectId, before = Number.MAX_SAFE_INTEGER, limit = 40 } = {}) {
    if (
      !Number.isSafeInteger(before) ||
      before < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      fail('Invalid history window', 400);
    const all = this.events.filter(
      (event) =>
        event.kind === 'sandbox.changed' &&
        event.sequence < before &&
        (!projectId ||
          event.payload.projectId === projectId ||
          event.payload.result?.projectId === projectId),
    );
    const items = all
      .slice(-limit)
      .reverse()
      .map((event) => ({
        eventId: event.eventId,
        sequence: event.sequence,
        at: event.occurredAt,
        operation: event.payload.operation,
        projectId: event.payload.projectId ?? event.payload.result?.projectId,
        projectTitle: event.payload.snapshot?.projects.find(
          (item) =>
            item.id ===
            (event.payload.result?.projectId ?? event.payload.projectId),
        )?.title,
        actor: event.payload.actorName ?? event.agentId ?? 'Operator',
        agentId: event.agentId,
        runId: event.runId,
        summary: event.payload.summary,
        revision: event.payload.revision,
        artifactId: event.payload.result?.artifactId,
      }));
    return {
      items,
      nextBefore: all.length > limit ? items.at(-1).sequence : null,
    };
  }

  dossier(projectId) {
    const project = this.state.projects.find((item) => item.id === projectId);
    if (!project) fail('That project is unavailable', 404);
    const work = this.events.filter(
      (event) =>
        event.kind === 'sandbox.changed' &&
        event.agentId &&
        event.payload.projectId === projectId,
    );
    const contributions = [];
    for (const event of work.filter((event) =>
      [
        'place',
        'assemble',
        'build',
        'test',
        'diagnose',
        'install',
        'dismantle',
      ].includes(event.payload.operation),
    )) {
      let person = contributions.find(
        (item) => item.agentId === event.agentId && item.runId === event.runId,
      );
      if (!person) {
        person = {
          agentId: event.agentId,
          runId: event.runId,
          name: event.payload.actorName ?? event.agentId,
          actions: {},
        };
        contributions.push(person);
      }
      person.actions[event.payload.operation] =
        (person.actions[event.payload.operation] ?? 0) + 1;
    }
    return {
      projectId,
      revision: this.state.revision,
      health: this.diagnose(project),
      history: this.history({ projectId }),
      claimActive: !!project.claim && this.isActorActive(project.claim),
      residentUses: work.filter((event) => event.payload.operation === 'use')
        .length,
      contributions,
    };
  }

  documents() {
    const found = [];
    const visit = (directory, depth) => {
      if (depth > 6 || found.length >= 200) return;
      for (const entry of readdirSync(resolve(this.root, directory), {
        withFileTypes: true,
      }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (found.length >= 200) break;
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory()) visit(path, depth + 1);
        else if (entry.isFile() && entry.name.endsWith('.md')) {
          try {
            const doc = this.document(path);
            found.push({
              path,
              bytes: doc.bytes,
              title:
                doc.content.match(/^#\s+(.+)$/m)?.[1]?.slice(0, 120) ??
                entry.name,
            });
          } catch {
            /* Only readable, permitted documents enter the catalog. */
          }
        }
      }
    };
    if (existsSync(resolve(this.root, 'docs'))) visit('docs', 0);
    return { documents: found, limit: 200 };
  }
}

/** Shared by actual validation, operator searches, and resident device use. */
export function searchDocuments(documents, query) {
  const terms = [
    ...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []),
  ];
  if (!terms.length) return [];
  return documents
    .flatMap((doc) => {
      const lower = doc.content.toLowerCase();
      if (!terms.every((term) => lower.includes(term))) return [];
      const first = lower.indexOf(terms[0]);
      const score = terms.reduce(
        (sum, term) => sum + lower.split(term).length - 1,
        0,
      );
      return [
        {
          path: doc.path,
          score,
          excerpt: doc.content
            .slice(Math.max(0, first - 60), first + 200)
            .replace(/\s+/g, ' '),
        },
      ];
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.path.localeCompare(right.path),
    )
    .slice(0, 8);
}
