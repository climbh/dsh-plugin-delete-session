/**
 * Client-half smoke test: executes lib/client.js in a stub browser module
 * environment and drives the row -> dialog -> confirm flow, for the two
 * situations that matter: the deleted session is on screen, or it is not.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8');

function makeReact() {
  return {
    createElement: (type, props, ...rest) => {
      const merged = { ...(props || {}) };
      if (rest.length === 1) merged.children = rest[0];
      else if (rest.length > 1) merged.children = rest;
      return { type, props: merged };
    },
    Fragment: 'Fragment',
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useRef: (initial) => ({ current: initial }),
  };
}

function makeDocument() {
  const tags = [];
  return {
    head: { appendChild: (tag) => tags.push(tag) },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ dataset: {}, setAttribute() {}, style: {} }),
    addEventListener() {},
    removeEventListener() {},
    tags,
  };
}

const DICT = {
  'menu.delete': '删除会话',
  'dialog.title': '删除会话',
  'dialog.description': '「{name}」删除后不可恢复。',
  'dialog.cancel': '取消',
  'dialog.confirm': '删除',
  'dialog.deleting': '正在删除…',
};

function loadClient() {
  const registrations = [];
  let loaded = null;
  const document = makeDocument();
  const require = (id) => {
    if (id === 'react') return makeReact();
    throw new Error('unexpected require: ' + id);
  };
  const sandbox = {
    window: { __ModuleLoader__: { load: (definition) => { loaded = definition; } } },
    document,
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, removed: true }) }),
    console,
    setTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'client.js' });
  assert.ok(loaded !== null, 'module registered');
  const moduleExports = loaded.factory(require);
  assert.equal(JSON.stringify(moduleExports.inject), JSON.stringify(['slots', 'locale']), 'declares slots + locale only');
  const t = (key, params) => {
    const value = DICT[key] ?? key;
    return params ? value.replace('{name}', params.name) : value;
  };
  return { moduleExports, registrations, t, document };
}

/** Render nested function components until a host element is reached. */
const render = (element) => (typeof element.type === 'function' ? render(element.type(element.props)) : element);

function childArray(children) {
  if (children === undefined || children === null) return [];
  return Array.isArray(children) ? children : [children];
}

function findByProp(element, key, value) {
  if (element === null || typeof element !== 'object') return null;
  const props = element.props || {};
  if (props[key] === value) return element;
  for (const child of childArray(props.children)) {
    const hit = findByProp(child, key, value);
    if (hit !== null) return hit;
  }
  return null;
}

async function runScenario({ wasMain }) {
  const { moduleExports, registrations, t, document } = loadClient();

  const calls = [];
  const sessions = {
    list: { getSnapshot: () => ({ byId: { 'session-x': { retainedBy: { mainView: wasMain ? 1 : 0 } } } }) },
    handleSessionRemoved: (id) => calls.push('removed:' + id),
    refresh: async () => calls.push('refresh'),
  };
  const uiWorkspace = {
    mainReference: wasMain ? { sessionId: 'session-x' } : { sessionId: 'session-other' },
    clearMain: () => calls.push('clearMain'),
  };
  const ctx = {
    get: (key) => ({ sessions, uiWorkspace })[key],
    effect: (fn) => { fn(); },
    locale: { register: () => () => {} },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  moduleExports.apply(ctx);

  assert.equal(registrations.length, 2, 'two slot occupants');
  const overlay = registrations.find((r) => r.options.name === 'shell.overlay');
  const menu = registrations.find((r) => r.options.name === 'sidebar.workspaces.session.menu.item');
  assert.ok(overlay && menu, 'both slots registered');
  assert.equal(menu.options.order, 500, 'row sits below the shipped rows');
  assert.equal(menu.options.locale, 'delete-session', 'row uses the plugin locale namespace');
  assert.match(document.tags[0]?.textContent ?? '', /\.dshds-row/, 'styles injected');
  assert.match(document.tags[0]?.textContent ?? '', /var\(--dsw-alias-state-error-primary\)/, 'tones come from theme tokens');

  let menuOpen = true;
  const row = render(
    menu.component({
      sessionId: 'session-x',
      displayTitle: 'hello',
      useMenuOpenState: () => [menuOpen, (next) => { menuOpen = next; }],
      t,
    }),
  );
  assert.equal(row.type, 'button', 'row is a real button');
  assert.equal(row.props.role, 'menuitem', 'row joins the menu keyboard walk');
  assert.equal(row.props.className, 'dshds-row');
  assert.equal(findByProp(row, 'className', 'dshds-row-label')?.props.children, '删除会话', 'row label');
  row.props.onClick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(menuOpen, false, 'menu closes on select');

  const dialog = render(overlay.component({ t }));
  assert.ok(dialog, 'dialog renders once the row was selected');
  const panel = findByProp(dialog, 'className', 'dshds-dialog');
  assert.ok(panel, 'dialog panel rendered');
  assert.equal(panel.props.role, 'dialog');
  assert.equal(panel.props['aria-modal'], 'true');
  assert.equal(findByProp(dialog, 'id', 'dshds-delete-title')?.props.children, '删除会话');
  assert.equal(
    findByProp(dialog, 'id', 'dshds-delete-description')?.props.children,
    '「hello」删除后不可恢复。',
    'one sentence carries the session title',
  );

  const buttons = childArray(findByProp(dialog, 'className', 'dshds-actions').props.children);
  assert.equal(buttons.length, 2, 'cancel + delete');
  assert.equal(childArray(buttons[0].props.children)[0], '取消');
  assert.equal(childArray(buttons[1].props.children)[0], '删除');
  assert.equal(buttons[1].props.className, 'dshds-btn dshds-btn-danger', 'delete reads as destructive');

  buttons[1].props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(
    calls.filter((call) => call.startsWith('removed:') || call === 'refresh'),
    ['removed:session-x', 'refresh'],
    'row dropped, then list refreshed',
  );
  assert.equal(
    calls.includes('clearMain'),
    wasMain,
    wasMain ? 'main view returns to a new session' : 'another session leaves the main view alone',
  );
}

await runScenario({ wasMain: true });
console.log('ok deleting the on-screen session clears the main view');
await runScenario({ wasMain: false });
console.log('ok deleting another session leaves the main view alone');
console.log('ALL CLIENT CHECKS PASS');
