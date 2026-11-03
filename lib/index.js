/**
 * Host half of dsh-plugin-delete-session.
 *
 * The shipped Host services can archive a conversation but none of them can
 * delete one, so this half owns the one HTTP route the Client half calls:
 * `POST /delete-session/delete { sessionId }`.
 *
 * Deleting a conversation means, in this order:
 *   1. refuse while the conversation is replying (a running turn would keep
 *      writing or resurrect its log after we removed it);
 *   2. release it from the live Session/Agent stores. A session that is live —
 *      the open conversation, or any conversation this Host process resumed —
 *      is listed from memory even when its files are gone, which is why
 *      deleting the files alone used to leave a clickable sidebar row behind.
 *      Detaching the store entry publishes `session/disposed`, which is what
 *      makes every Client drop the row (and stop being able to open it);
 *   3. remove the session directory (log + lock + staging files), re-checking
 *      briefly because a live log writer can recreate the directory;
 *   4. detach the id from every workspace so the grouping that held it goes;
 *   5. forget the id in the archived/pinned bookkeeping;
 *   6. remove the projection-cache record, which carries the conversation
 *      title and the first user messages.
 *
 * Steps 1 and 4-5 use public service methods; steps 2, 3 and 6 are
 * storage/runtime-layer cleanup, because no service exposes a delete or an
 * unload. Every failure before step 3 leaves the conversation untouched.
 */
import { readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export const name = 'delete-session';
export const inject = ['webServer'];

const ROUTE = '/delete-session';
const VERSION = '1.0.4';
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const CWD_LESS_PROJECT = '_no-cwd';
/** How many times to re-remove a directory a live log writer keeps recreating. */
const REMOVAL_ATTEMPTS = 4;

/** A route failure carrying the machine-readable code the Client localizes. */
class RouteError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'RouteError';
    this.code = code;
    this.status = status;
  }
}

/** Read one optional Host service without tripping over an unloaded key. */
function service(ctx, key) {
  try {
    if (typeof ctx.get === 'function') return ctx.get(key);
    return ctx[key];
  } catch {
    return undefined;
  }
}

function respondJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

function readBody(request) {
  return new Promise((done, fail) => {
    const decoder = new TextDecoder();
    let text = '';
    request.on('data', (chunk) => {
      text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    });
    request.on('end', () => {
      try {
        text += decoder.decode();
        done(text === '' ? {} : JSON.parse(text));
      } catch (error) {
        fail(new RouteError('invalid-body', 400, `Request body is not JSON: ${String(error)}`));
      }
    });
    request.on('error', fail);
  });
}

function normalizeSessionId(raw) {
  if (typeof raw !== 'string') throw new RouteError('invalid-session-id', 400, 'sessionId must be a string.');
  const sessionId = raw.trim();
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new RouteError('invalid-session-id', 400, `Not a session id: ${JSON.stringify(sessionId)}`);
  return sessionId;
}

/** The persistence backend's project directory name for one working directory. */
function projectKey(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') return CWD_LESS_PROJECT;
  return `--${cwd.split(/[\\/]+/).filter((part) => part !== '').join('-')}--`;
}

function isInside(parent, child) {
  const root = resolve(parent);
  const target = resolve(child);
  return target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

/**
 * Detach the live store entry for one id, if this Host holds it.
 *
 * `sessions`/`agents` expose `detachEntered(entry)` beside their public
 * `enter()`; it removes the entry and publishes the matching disposal event
 * (`session/disposed` → `api-session/removed`, `agent/disposed`). Those are the
 * only shipped hooks that make a Client forget a row it can otherwise still
 * open, so a missing hook is reported instead of thrown.
 */
function detachStoreEntry(owner, store, sessionId, label, ctx) {
  if (store === undefined || typeof owner?.detachEntered !== 'function') return false;
  const entry = typeof store.get === 'function' ? store.get(sessionId) : undefined;
  if (entry === undefined) return false;
  try {
    owner.detachEntered(entry);
    return true;
  } catch (error) {
    ctx.logger?.warn?.(`delete-session: could not release the live ${label} "${sessionId}"`, error);
    return false;
  }
}

/** Release one conversation from the live hosts, so no surface can list or open it. */
function releaseLive(ctx, sessionId) {
  const sessions = service(ctx, 'sessions');
  const agents = service(ctx, 'agents');
  const agent = typeof agents?.get === 'function' ? agents.get(sessionId) : undefined;
  if (agent !== undefined && agent !== null && typeof agent.cancel === 'function') {
    try {
      agent.cancel({ kind: 'user' });
    } catch {
      /* an idle agent refuses nothing; a busy one is refused earlier */
    }
  }
  const releasedAgent = detachStoreEntry(agents, agents?.store, sessionId, 'agent', ctx);
  const releasedSession = detachStoreEntry(sessions, sessions?.store, sessionId, 'session', ctx);
  return { session: releasedSession, agent: releasedAgent };
}

/** Where a conversation's files live, or undefined when nothing is stored. */
async function findSessionDir(persistence, sessionId) {
  const root = persistence?.root;
  if (typeof root !== 'string' || root === '') return undefined;
  const listed = typeof persistence.list === 'function' ? await persistence.list() : [];
  const meta = (Array.isArray(listed) ? listed : []).find((entry) => entry && entry.id === sessionId);
  if (meta !== undefined) {
    if (typeof persistence.locate === 'function') {
      try {
        const located = persistence.locate(meta);
        if (located && typeof located.path === 'string' && located.path !== '') return dirname(located.path);
      } catch {
        /* locate() refuses unflushed or foreign logs; fall back to the layout below */
      }
    }
    if (typeof meta.cwd === 'string') return join(root, projectKey(meta.cwd), sessionId);
  }
  let projects = [];
  try {
    projects = await readdir(root);
  } catch {
    return undefined;
  }
  for (const project of projects) {
    const candidate = join(root, project, sessionId);
    if (await isDirectory(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Remove one session directory and keep it removed.
 *
 * A conversation whose Session object is still alive holds an open log writer;
 * when that writer flushes or reopens after the directory is gone it recreates
 * it. Re-checking a few times turns that race into a bounded retry instead of a
 * resurrected conversation.
 */
async function removeSessionDir(directory) {
  for (let attempt = 0; attempt < REMOVAL_ATTEMPTS; attempt += 1) {
    await rm(directory, { recursive: true, force: true });
    if (!(await isDirectory(directory))) return true;
    await delay(120 + attempt * 180);
  }
  await rm(directory, { recursive: true, force: true });
  return !(await isDirectory(directory));
}

/** Detach the id from every workspace that lists it. */
async function detachFromWorkspaces(ctx, sessionId) {
  const registry = service(ctx, 'workspaceRegistry');
  if (registry === undefined) return [];
  const detached = [];
  const workspaces = typeof registry.list === 'function' ? registry.list() : [];
  for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
    if (workspace === undefined || workspace === null) continue;
    if (!Array.isArray(workspace.sessionIds) || !workspace.sessionIds.includes(sessionId)) continue;
    if (typeof workspace.detachSession !== 'function') continue;
    try {
      await workspace.detachSession(sessionId);
      detached.push(workspace.id);
    } catch (error) {
      ctx.logger?.warn?.(`delete-session: could not detach "${sessionId}" from workspace "${workspace.id}"`, error);
    }
  }
  return detached;
}

/** Drop the id from the archived/pinned sets; both calls are idempotent. */
function forget(ctx, method, sessionId) {
  const registry = service(ctx, 'workspaceRegistry');
  if (registry === undefined || typeof registry[method] !== 'function') return false;
  try {
    registry[method].call(registry, sessionId);
    return true;
  } catch (error) {
    ctx.logger?.warn?.(`delete-session: workspaceRegistry.${method} failed`, error);
    return false;
  }
}

/** Remove the projection-cache record (title and first user messages). */
async function purgeProjectionRecord(persistence, sessionId) {
  const root = persistence?.root;
  if (typeof root !== 'string' || root === '') return false;
  const home = dirname(resolve(root));
  const record = join(home, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`);
  if (!(await stat(record).then(() => true, () => false))) return false;
  try {
    await rm(record, { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function deleteSession(ctx, rawSessionId) {
  const sessionId = normalizeSessionId(rawSessionId);

  const agents = service(ctx, 'agents');
  const agent = typeof agents?.get === 'function' ? agents.get(sessionId) : undefined;
  if (agent !== undefined && agent !== null && agent.status === 'running') {
    throw new RouteError('session-active', 409, 'This session is still replying. Stop it, then delete it.');
  }

  const persistence = service(ctx, 'sessionPersistence');
  const registry = service(ctx, 'workspaceRegistry');
  if (persistence === undefined && registry === undefined) {
    throw new RouteError('no-storage', 500, 'Neither sessionPersistence nor workspaceRegistry is available.');
  }

  /*
   * Release before touching files: detaching the live entries publishes the
   * disposal events every Client surface reacts to (row removed, pane closed),
   * so the conversation cannot be reopened through a stale row afterwards.
   */
  const released = releaseLive(ctx, sessionId);

  try {
    const directory = await findSessionDir(persistence, sessionId);
    const root = persistence?.root;
    let projectionPurged = false;
    if (directory !== undefined) {
      if (typeof root === 'string' && !isInside(root, directory)) {
        throw new RouteError('foreign-path', 500, `Refusing to delete outside the session store: ${directory}`);
      }
      if (!(await removeSessionDir(directory))) {
        throw new RouteError('session-undeletable', 500, `The session directory survived deletion: ${directory}`);
      }
      projectionPurged = await purgeProjectionRecord(persistence, sessionId);
    }
    const detachedFrom = await detachFromWorkspaces(ctx, sessionId);
    forget(ctx, 'unarchiveSession', sessionId);
    forget(ctx, 'unpinSession', sessionId);
    if (directory === undefined) {
      return { ok: true, sessionId, removed: false, reason: 'not-found', released, detachedFrom };
    }
    return {
      ok: true,
      sessionId,
      removed: true,
      directory,
      projectionPurged,
      released,
      detachedFrom,
    };
  } catch (error) {
    /* Files are still there: put the row back rather than leave a dead entry. */
    ctx.logger?.warn?.(`delete-session: deleting "${sessionId}" failed after releasing it`, error);
    throw error;
  }
}

/** Read-only capability report, used to verify a Host build after a reload. */
function diagnostics(ctx) {
  const sessions = service(ctx, 'sessions');
  const agents = service(ctx, 'agents');
  const listLive = (owner) => (typeof owner?.list === 'function' ? owner.list().map((entry) => entry?.id ?? entry) : []);
  return {
    ok: true,
    plugin: 'dsh-plugin-delete-session',
    version: VERSION,
    route: ROUTE,
    sessionStore: {
      store: sessions?.store instanceof Map,
      detachEntered: typeof sessions?.detachEntered === 'function',
      live: listLive(sessions),
    },
    agentStore: {
      store: agents?.store instanceof Map,
      detachEntered: typeof agents?.detachEntered === 'function',
      live: listLive(agents),
    },
  };
}

async function handleRoute(ctx, request, response) {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const { pathname } = url;
    if (pathname !== ROUTE && !pathname.startsWith(`${ROUTE}/`)) {
      respondJson(response, 404, { ok: false, code: 'not-found', error: `Not found: ${pathname}` });
      return;
    }
    if (request.method === 'GET' && (pathname === ROUTE || pathname === `${ROUTE}/status`)) {
      respondJson(response, 200, {
        ok: true,
        plugin: 'dsh-plugin-delete-session',
        version: VERSION,
        route: ROUTE,
      });
      return;
    }
    if (request.method === 'GET' && pathname === `${ROUTE}/diag`) {
      respondJson(response, 200, diagnostics(ctx));
      return;
    }
    if (request.method === 'POST' && (pathname === `${ROUTE}/delete` || pathname === ROUTE)) {
      const body = await readBody(request);
      const result = await deleteSession(ctx, body?.sessionId);
      respondJson(response, 200, result);
      return;
    }
    respondJson(response, 405, { ok: false, code: 'method-not-allowed', error: `${request.method} is not supported for ${pathname}` });
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    if (status >= 500) ctx.logger?.warn?.(`delete-session: ${message}`, error);
    respondJson(response, status, { ok: false, code: error?.code, error: message });
  }
}

export function apply(ctx) {
  const webServer = service(ctx, 'webServer');
  if (webServer === undefined || typeof webServer.register !== 'function') {
    ctx.logger?.warn?.('delete-session: no webServer route carrier is loaded; the delete row has no backend.');
    return;
  }
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: (request, response) => handleRoute(ctx, request, response),
  }), 'delete-session: HTTP route');
}
