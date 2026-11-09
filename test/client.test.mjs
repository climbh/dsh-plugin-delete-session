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
  'dialog.description': '“{name}”删除后不可恢复。',
  'dialog.close': '关闭',
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
  const fetches = [];
  const sandbox = {
    window: { __ModuleLoader__: { load: (definition) => { loaded = definition; } } },
    document,
    fetch: async (url, init) => {
      fetches.push({ url, method: init?.method, body: init?.body === undefined ? undefined : JSON.parse(init.body) });
      return { ok: true, json: async () => ({ ok: true, removed: true }) };
    },
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
  return { moduleExports, registrations, t, document, fetches };
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

async function runScenario({ view }) {
  const { moduleExports, registrations, t, document, fetches } = loadClient();

  const calls = [];
  const sessions = {
    list: { getSnapshot: () => ({ byId: { 'session-x': { retainedBy: { mainView: view.retainedBy ?? 0 } } } }) },
    handleSessionRemoved: (id) => calls.push('removed:' + id),
    refresh: async () => calls.push('refresh'),
  };
  const uiWorkspace = {
    mainReference: view.mainReference,
    selection: { getSnapshot: () => view.selection ?? {} },
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', sessionIds: ['session-x'] }, { workspaceId: 'ws-2', sessionIds: [] }] }) } },
    clearMain: () => calls.push('clearMain'),
    ...(view.noStartSession === true ? {} : { startSession: (workspaceId) => calls.push('startSession:' + workspaceId) }),
  };
  // `late` mimics the real boot order: this plugin loads immediately, before
  // ui-workspace and the session controller have activated.
  let activated = view.lateServices !== true;
  const registry = { sessions, uiWorkspace };
  const ctx = {
    get: (key) => (activated ? registry[key] : undefined),
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
  activated = true;

  assert.equal(registrations.length, 2, 'two slot occupants');
  const overlay = registrations.find((r) => r.options.name === 'shell.overlay');
  const menu = registrations.find((r) => r.options.name === 'sidebar.workspaces.session.menu.item');
  assert.ok(overlay && menu, 'both slots registered');
  assert.equal(menu.options.order, 500, 'row sits below the shipped rows');
  assert.equal(menu.options.locale, 'delete-session', 'row uses the plugin locale namespace');
  const css = document.tags[0]?.textContent ?? '';
  assert.match(css, /\.dshds-item/, 'styles injected');
  assert.match(css, /var\(--dsw-alias-state-error-primary\)/, 'tones come from theme tokens');
  assert.match(css, /background: var\(--dsw-alias-bg-mask-1\)/, 'dialog mask matches the shipped modal');
  assert.match(css, /backdrop-filter: var\(--dsw-mask-blur\)/, 'dialog mask blurs like the shipped modal');
  assert.match(css, /border-radius: var\(--dsw-radius-panel\)/, 'panel radius matches the shipped modal');
  assert.match(css, /min-height: 34px/, 'row height matches the shipped menu item');
  assert.match(css, /height: 36px/, 'buttons match the shipped outline button');

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
  assert.equal(row.props.className, 'dshds-item');
  assert.ok(findByProp(row, 'className', 'dshds-item-icon'), 'row leads with the shipped trash glyph');
  assert.equal(findByProp(row, 'className', 'dshds-item-label')?.props.children, '删除会话', 'row label');
  row.props.onClick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(menuOpen, false, 'menu closes on select');

  const dialog = render(overlay.component({ t }));
  assert.ok(dialog, 'dialog renders once the row was selected');
  const closeButton = findByProp(dialog, 'className', 'dshds-dialog-close');
  assert.ok(closeButton, 'close button rendered');
  assert.equal(closeButton.props['aria-label'], '关闭');
  const closeGlyph = render(closeButton.props.children);
  const closePaths = childArray(closeGlyph.props.children).map((path) => path.props.d);
  assert.equal(
    JSON.stringify(closePaths),
    JSON.stringify(['M3.5 3.5L12.5 12.5', 'M12.5 3.5L3.5 12.5']),
    'close glyph is the shipped two-stroke X',
  );
  assert.equal(closeGlyph.props.strokeWidth, 1, 'close glyph uses the shipped 1px stroke');
  assert.equal(closeGlyph.props.width, 14, 'close glyph is 14px');

  const panel = findByProp(dialog, 'className', 'dshds-dialog');
  assert.ok(panel, 'dialog panel rendered');
  assert.equal(panel.props.role, 'dialog');
  assert.equal(panel.props['aria-modal'], 'true');
  assert.equal(findByProp(dialog, 'id', 'dshds-delete-title')?.props.children, '删除会话');
  assert.equal(
    findByProp(dialog, 'id', 'dshds-delete-description')?.props.children,
    '“hello”删除后不可恢复。',
    'one sentence carries the session title',
  );

  const buttons = childArray(findByProp(dialog, 'className', 'dshds-dialog-footer').props.children);
  assert.equal(buttons.length, 2, 'cancel + delete');
  assert.equal(childArray(buttons[0].props.children)[0], '取消');
  assert.equal(childArray(buttons[1].props.children)[0], '删除');
  assert.equal(buttons[1].props.className, 'dshds-btn dshds-btn-outline dshds-btn-danger', 'delete is an outlined danger button');

  buttons[1].props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(
    calls.filter((call) => call.startsWith('removed:') || call === 'refresh'),
    ['removed:session-x', 'refresh'],
    'row dropped, then list refreshed',
  );
  if (view.expectClear && view.noStartSession === true) {
    assert.ok(calls.includes('clearMain'), 'falls back to clearing when the service cannot open one');
  } else if (view.expectClear) {
    assert.ok(calls.includes('startSession:ws-1'), 'the workspace opens its next conversation');
  } else {
    assert.equal(calls.filter((call) => call.startsWith('startSession')).length, 0, 'another session leaves the main view alone');
    assert.equal(calls.includes('clearMain'), false, 'another session does not clear the pane');
  }


  const del = fetches.find((call) => call.url === '/delete-session/delete');
  assert.ok(del, 'delete request sent');
  assert.deepEqual(del.body, { sessionId: 'session-x' });
  const report = fetches.find((call) => call.url === '/delete-session/report');
  assert.ok(report, 'diagnostics reported to the host');
  assert.equal(report.body.wasOnScreen, view.expectClear, 'report records what the pane showed');
  assert.equal(report.body.services.uiWorkspace, true, 'report records that the service resolved');
  assert.equal(report.body.services.startSession, view.noStartSession !== true, 'report records the navigation API');
}

// On screen: the live reference names it, and a new conversation replaces it.
await runScenario({
  view: { mainReference: { sessionId: 'session-x' }, retainedBy: 1, expectClear: true },
});
console.log('ok deleting the on-screen session clears the main view');

// On screen through a workspace project: the reference is gone but the persisted
// selection still names it — this is the case the workspace rows hit.
await runScenario({
  view: { mainReference: undefined, selection: { sessionId: 'session-x' }, expectClear: true },
});
console.log('ok deleting a workspace session that only the selection names clears the main view');

// On screen through the retain count alone.
await runScenario({ view: { mainReference: undefined, selection: {}, retainedBy: 1, expectClear: true } });
console.log('ok deleting a session retained by the main view clears it');

// Another session: the pane is left alone.
await runScenario({
  view: { mainReference: { sessionId: 'session-other' }, selection: { sessionId: 'session-other' }, expectClear: false },
});
console.log('ok deleting another session leaves the main view alone');

// Without startSession the plugin still clears the pane instead of leaving the
// deleted transcript mounted.
await runScenario({
  view: { mainReference: { sessionId: 'session-x' }, noStartSession: true, expectClear: true },
});
console.log('ok the pane is cleared when the workspace cannot open a new conversation');

// Services that activate after this plugin mounts must still be found.
await runScenario({
  view: { mainReference: { sessionId: 'session-x' }, lateServices: true, expectClear: true },
});
console.log('ok services resolved after mount are still used');
console.log('ALL CLIENT CHECKS PASS');
