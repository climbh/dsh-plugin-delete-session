import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { deleteSession } from '../lib/index.js';

const home = join(tmpdir(), 'dsh-plugin-delete-session-test', String(process.pid));
const root = join(home, 'sessions');
const projectKey = (cwd) => `--${cwd.split('/').filter(Boolean).join('-')}--`;
await rm(home, { recursive: true, force: true });
process.on('exit', () => { rm(home, { recursive: true, force: true }).catch(() => {}); });

const exists = (p) => stat(p).then(() => true, () => false);

async function seed(id, cwd, { listed = true, proj = true } = {}) {
  const dir = join(root, projectKey(cwd), id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'session.v4.jsonl.zstd'), 'log');
  await writeFile(join(dir, 'session.lock'), '');
  if (proj) {
    const p = join(home, 'storages', 'session_projcache', 'sessions', `${id}.json`);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify({ record: { identity: { cwd }, rows: { title: { val: 'hello' } } } }));
  }
  return { dir };
}

/** A fake Host: one persistence backend, one registry, live Session/Agent stores. */
function ctxWith({ sessions = [], live = [], agentStore = [], events = [] } = {}) {
  const persistence = {
    root,
    list: () => sessions.filter((s) => s.listed).map((s) => ({ id: s.id, cwd: s.cwd })),
    locate: (meta) => ({ kind: 'jsonl', path: join(root, projectKey(meta.cwd), meta.id, 'session.v4.jsonl.zstd') }),
  };
  const workspaceRegistry = {
    list: () => [{ id: 'w1', sessionIds: sessions.map((s) => s.id), detachSession: async (id) => { events.push(`detach:${id}`); } }],
    unarchiveSession: (id) => { events.push(`unarchive:${id}`); },
    unpinSession: (id) => { events.push(`unpin:${id}`); },
  };
  const sessionStore = new Map(live.map((entry) => [entry.session.id, entry]));
  const agentEntries = new Map(agentStore.map((entry) => [entry.agent.id, entry]));
  const sessionService = {
    store: sessionStore,
    detachEntered: (entry) => {
      events.push(`release-session:${entry.id}`);
      sessionStore.delete(entry.id);
    },
    list: () => [...sessionStore.values()].map((entry) => entry.session),
  };
  const agents = {
    store: agentEntries,
    get: (id) => agentEntries.get(id)?.agent,
    detachEntered: (entry) => {
      events.push(`release-agent:${entry.id}`);
      agentEntries.delete(entry.id);
    },
  };
  return {
    get: (k) => ({
      webServer: undefined,
      sessionPersistence: persistence,
      workspaceRegistry,
      sessions: sessionService,
      agents,
    })[k],
    logger: { warn: (...a) => console.log('warn:', ...a) },
  };
}

const idle = (id) => ({ id, status: 'idle', cancel: (reason) => ({ cancelled: reason }) });
const running = (id) => ({ id, status: 'running', cancel: () => '' });
const sessionEntry = (id) => ({ id, session: { id } });

// 1. an open (idle) conversation is released from both stores, then deleted
{
  const s = await seed('session-aaa', '/Users/test');
  const events = [];
  const ctx = ctxWith({
    sessions: [{ id: 'session-aaa', cwd: '/Users/test', listed: true }],
    live: [sessionEntry('session-aaa')],
    agentStore: [{ id: 'session-aaa', agent: idle('session-aaa') }],
    events,
  });
  const r = await deleteSession(ctx, 'session-aaa');
  assert.equal(r.removed, true);
  assert.deepEqual(r.released, { session: true, agent: true });
  assert.equal(r.detachedFrom.length, 1);
  assert.equal(await exists(s.dir), false, 'dir removed');
  assert.equal(await exists(join(home, 'storages', 'session_projcache', 'sessions', 'session-aaa.json')), false);
  assert.deepEqual(events, [
    'release-agent:session-aaa',
    'release-session:session-aaa',
    'detach:session-aaa',
    'unarchive:session-aaa',
    'unpin:session-aaa',
  ]);
  console.log('ok 1 live conversation released from both stores, then deleted');
}

// 2. running conversation refused before any release or write
{
  const s = await seed('session-bbb', '/Users/test');
  const events = [];
  const ctx = ctxWith({
    sessions: [{ id: 'session-bbb', cwd: '/Users/test', listed: true }],
    live: [sessionEntry('session-bbb')],
    agentStore: [{ id: 'session-bbb', agent: running('session-bbb') }],
    events,
  });
  await assert.rejects(
    () => deleteSession(ctx, 'session-bbb'),
    (e) => e.code === 'session-active' && e.status === 409,
  );
  assert.equal(await exists(s.dir), true, 'running conversation untouched');
  assert.deepEqual(events, []);
  console.log('ok 2 running conversation refused before any release');
}

// 3. a directory a live log writer recreates is removed again
{
  const s = await seed('session-ccc', '/Users/test');
  const ctx = ctxWith({
    sessions: [{ id: 'session-ccc', cwd: '/Users/test', listed: true }],
    live: [sessionEntry('session-ccc')],
    agentStore: [{ id: 'session-ccc', agent: idle('session-ccc') }],
  });
  setTimeout(() => {
    mkdir(s.dir, { recursive: true }).then(() => writeFile(join(s.dir, 'session.v4.jsonl.zstd'), 'flush'), () => {});
  }, 60);
  const r = await deleteSession(ctx, 'session-ccc');
  assert.equal(r.removed, true);
  assert.equal(await exists(s.dir), false, 'recreated dir removed again');
  console.log('ok 3 directory recreated by a live writer is removed again');
}

// 4. orphan files: neither store knows the id, directory still removed
{
  const s = await seed('session-ddd', '/Users/other', { listed: false });
  const r = await deleteSession(ctxWith({ sessions: [] }), 'session-ddd');
  assert.equal(r.removed, true);
  assert.deepEqual(r.released, { session: false, agent: false });
  assert.equal(await exists(s.dir), false);
  console.log('ok 4 unknown-to-host orphan directory removed');
}

// 5. missing conversation reports not-found and still clears the bookkeeping
{
  const events = [];
  const r = await deleteSession(ctxWith({ sessions: [], events }), 'session-fff');
  assert.equal(r.removed, false);
  assert.equal(r.reason, 'not-found');
  assert.deepEqual(events, ['unarchive:session-fff', 'unpin:session-fff']);
  console.log('ok 5 missing conversation reports not-found, markers cleared');
}

// 6. invalid ids refused
{
  for (const bad of ['../../etc/passwd', '', 'a/b']) {
    await assert.rejects(() => deleteSession(ctxWith({}), bad), (e) => e.code === 'invalid-session-id');
  }
  console.log('ok 6 invalid ids refused');
}

console.log('ALL PASS');
