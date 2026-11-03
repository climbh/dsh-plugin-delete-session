/**
 * Client half of dsh-plugin-delete-session.
 *
 * Two slot occupants share one confirmation state:
 *   - `sidebar.workspaces.session.menu.item` adds the red "Delete session" row
 *     under the shipped pin/rename/fork/archive rows;
 *   - `shell.overlay` renders the confirmation dialog.
 *
 * Both surfaces are drawn here instead of importing a Host package, but their
 * geometry and colors are copied from the shipped conversation-menu row, the
 * shipped `MenuItemButton` danger tone, and the shipped `Modal` + outline
 * `Button` pair used by "Delete workspace" — down to the mask blur, the
 * `bg-mask-1` fill, the panel radius/elevation and the 36px outlined buttons.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-delete-session',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const ROUTE = '/delete-session';
    const NS = 'delete-session';
    const STYLE_ID = 'dsh-plugin-delete-session';

    const EN = {
      'menu.delete': 'Delete session',
      'dialog.title': 'Delete session',
      'dialog.description': '“{name}” will be deleted permanently.',
      'dialog.close': 'Close',
      'dialog.cancel': 'Cancel',
      'dialog.confirm': 'Delete',
      'dialog.deleting': 'Deleting…',
      'error.active': 'This session is still replying. Stop it, then delete it.',
      'error.invalid': 'This session id is not valid.',
      'error.undeletable': 'The stored session files could not be removed. Check the permissions of the session directory.',
      'error.failed': 'Deleting the session failed',
    };

    const ZH = {
      'menu.delete': '删除会话',
      'dialog.title': '删除会话',
      'dialog.description': '“{name}”删除后不可恢复。',
      'dialog.close': '关闭',
      'dialog.cancel': '取消',
      'dialog.confirm': '删除',
      'dialog.deleting': '正在删除…',
      'error.active': '该会话仍在回复中，请先停止后再删除。',
      'error.invalid': '这个会话 id 无效。',
      'error.undeletable': '无法删除会话文件，请检查会话目录的访问权限。',
      'error.failed': '删除会话失败',
    };

    /*
     * Class names are plugin-prefixed, but every number below is lifted from the
     * shipped build so the row and the dialog sit in the same visual rhythm as
     * the host's own menu rows and confirmation modals:
     *   row   -> primitives MenuItemButton (`_item_4ub78_90`) + danger tone
     *   modal -> primitives Modal (`_root/_mask/_dialog/_header/..._o6lrb`)
     *   button-> primitives Button variant="outline" (`_button/_outline/_md_1rv3m`)
     *   danger-> ui-workspace `deleteAction` (`color: state-error-primary`)
     */
    const CSS = `
      .dshds-item {
        display: flex; align-items: center; gap: 6px; width: 100%; min-height: 34px;
        padding: 6px 8px; border: none; border-radius: var(--dsw-radius-md);
        background: transparent; cursor: pointer; text-align: left;
        font-size: 13px; line-height: 20px; color: var(--dsw-alias-state-error-primary);
      }
      .dshds-item:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }
      .dshds-item:focus-visible:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); outline: none; }
      .dshds-item:disabled { opacity: 0.4; cursor: not-allowed; }
      .dshds-item-icon {
        display: inline-flex; flex: none; width: 14px; height: 14px;
        align-items: center; justify-content: center; color: var(--dsw-alias-state-error-primary);
      }
      .dshds-item-icon svg { display: block; width: 14px; height: 14px; }
      .dshds-item-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .dshds-root {
        pointer-events: auto; position: fixed; inset: 0; z-index: 1000;
        display: flex; align-items: center; justify-content: center;
        padding: max(24px, var(--dsh-frame-overlay-top, 24px)) 24px;
      }
      .dshds-mask {
        position: absolute; inset: var(--dsh-frame-chrome-top, 0px) 0 0;
        backdrop-filter: var(--dsw-mask-blur);
      }
      .dshds-mask:after {
        content: ""; position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1);
        animation: dshds-fade var(--ds-transition-duration, 160ms) var(--ds-ease-in-out, ease);
      }
      .dshds-dialog {
        box-sizing: border-box; position: relative; z-index: 1; display: flex;
        flex-direction: column; gap: 20px; width: min(380px, 100%);
        padding: 0 0 24px; overflow: hidden; border: 0;
        border-radius: var(--dsw-radius-panel);
        background: var(--dsw-alias-bg-layer-2);
        box-shadow: var(--dsw-elevation-prominent);
        color: var(--dsw-alias-label-primary);
        animation: dshds-enter var(--ds-transition-duration, 160ms) var(--ds-ease-in-out, ease);
      }
      .dshds-dialog:focus { outline: none; }
      .dshds-dialog-content { display: flex; flex-direction: column; width: 100%; }
      .dshds-dialog-header {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; padding: 22px 14px 12px 24px;
      }
      .dshds-dialog-title {
        margin: 0; font-size: 16px; line-height: 24px; font-weight: 500;
        color: var(--dsw-alias-label-primary);
      }
      .dshds-dialog-close {
        flex: none; display: inline-flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; border: none; border-radius: var(--dsw-radius-sm);
        background: transparent; cursor: pointer; color: var(--dsw-alias-label-secondary);
      }
      .dshds-dialog-close:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dshds-dialog-close svg { display: block; width: 14px; height: 14px; }
      .dshds-dialog-description {
        margin: 0; padding: 0 24px; font-weight: 400; overflow-wrap: anywhere;
        font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary);
      }
      .dshds-dialog-body {
        display: flex; flex-direction: column; min-width: 0;
        margin-top: 20px; padding: 0 24px;
      }
      .dshds-dialog-footer {
        display: flex; align-items: center; justify-content: flex-end;
        gap: 8px; padding: 0 24px;
      }
      .dshds-btn {
        box-sizing: border-box; display: inline-flex; align-items: center;
        justify-content: center; gap: 4px; height: 36px; padding: 0 14px;
        border: none; border-radius: var(--dsw-radius-md); cursor: pointer;
        font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary);
        background: transparent;
      }
      .dshds-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
      .dshds-btn:disabled { cursor: not-allowed; opacity: 0.4; }
      .dshds-btn-outline { border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; }
      .dshds-btn-danger:not(:disabled) { color: var(--dsw-alias-state-error-primary); }
      .dshds-status { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
      .dshds-error {
        margin-top: 8px; color: var(--dsw-alias-state-error-primary);
        font-size: 12px; line-height: 18px;
      }

      @keyframes dshds-fade { from { opacity: 0 } to { opacity: 1 } }
      @keyframes dshds-enter { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
      @media (prefers-reduced-motion: reduce) {
        .dshds-dialog, .dshds-mask:after { animation: none; }
      }
    `;

    function mountStyles() {
      if (typeof document === 'undefined') return () => {};
      const selector = 'style[data-plugin-css="' + STYLE_ID + '"]';
      if (document.querySelector(selector) === null) {
        const tag = document.createElement('style');
        tag.dataset.plugin = 'dsh-plugin-delete-session';
        tag.setAttribute('data-plugin-css', STYLE_ID);
        tag.textContent = CSS;
        document.head.appendChild(tag);
      }
      return () => {
        for (const tag of document.querySelectorAll(selector)) tag.remove();
      };
    }

    /** Confirmation state shared by the menu row and the overlay dialog. */
    function createConfirmStore() {
      let value = null;
      const listeners = new Set();
      const emit = () => {
        for (const listener of [...listeners]) listener();
      };
      return {
        get: () => value,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        open: (next) => {
          value = next;
          emit();
        },
        close: () => {
          if (value === null) return;
          value = null;
          emit();
        },
      };
    }

    function requestDelete(sessionId) {
      return fetch(ROUTE + '/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload === null || payload.ok !== true) {
          const failure = new Error(payload && typeof payload.error === 'string' ? payload.error : 'request failed');
          failure.code = payload && typeof payload.code === 'string' ? payload.code : 'failed';
          failure.status = response.status;
          throw failure;
        }
        return payload;
      });
    }

    function describeFailure(failure, t) {
      const code = failure !== null && typeof failure === 'object' ? failure.code : undefined;
      if (code === 'session-active') return t('error.active');
      if (code === 'invalid-session-id') return t('error.invalid');
      if (code === 'session-undeletable') return t('error.undeletable');
      const message = failure instanceof Error ? failure.message : String(failure);
      return t('error.failed') + ': ' + message;
    }

    /** The host's `IconTrashOutlineRegular` glyph, path for path. */
    function TrashIcon() {
      const paths = [
        'M1.28149 3.88831H14.7187',
        'M5.41602 3.88833V2.47962C5.41602 2.29282 5.52492 2.11366 5.71876 1.98157C5.9126 1.84948 6.17551 1.77527 6.44964 1.77527H9.55053C9.82466 1.77527 10.0876 1.84948 10.2814 1.98157C10.4753 2.11366 10.5842 2.29282 10.5842 2.47962V3.88833',
        'M2.57349 3.88831L3.19366 13.2943C3.21937 13.5502 3.33952 13.7872 3.53065 13.9593C3.72178 14.1313 3.97016 14.2259 4.22729 14.2246H11.7728C12.0299 14.2259 12.2783 14.1313 12.4694 13.9593C12.6605 13.7872 12.7807 13.5502 12.8064 13.2943L13.4266 3.88831',
        'M6.44946 6.98926V11.1238',
        'M9.55054 6.98926V11.1238',
      ];
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'none',
          strokeWidth: 1,
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        paths.map((d, index) => h('path', { key: index, d, stroke: 'currentColor' })),
      );
    }

    /** The host's `IconCloseFillRegular` glyph: two 1px strokes, no disc. */
    function CloseIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'none',
          strokeWidth: 1,
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', { d: 'M3.5 3.5L12.5 12.5', stroke: 'currentColor' }),
        h('path', { d: 'M12.5 3.5L3.5 12.5', stroke: 'currentColor' }),
      );
    }

    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, t, confirmStore }) {
      const [, setMenuOpen] = useMenuOpenState();
      const onSelect = (event) => {
        if (event !== null && typeof event === 'object') {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          if (typeof event.stopPropagation === 'function') event.stopPropagation();
        }
        if (typeof setMenuOpen === 'function') setMenuOpen(false);
        confirmStore.open({ sessionId, displayTitle });
      };
      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          className: 'dshds-item',
          'data-dsh-delete-session': '',
          onClick: onSelect,
        },
        h('span', { className: 'dshds-item-icon' }, h(TrashIcon, null)),
        h('span', { className: 'dshds-item-label' }, t('menu.delete')),
      );
    }

    function DeleteSessionDialog({ t, confirmStore, removeSession }) {
      const pending = React.useSyncExternalStore(confirmStore.subscribe, confirmStore.get, confirmStore.get);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const cancelRef = React.useRef(null);
      const panelRef = React.useRef(null);
      const open = pending !== null;
      const sessionId = pending === null ? null : pending.sessionId;
      const targetTitle = pending === null ? '' : pending.displayTitle;

      React.useEffect(() => {
        if (!open) return undefined;
        setBusy(false);
        setError(null);
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          confirmStore.close();
        };
        document.addEventListener('keydown', onKeyDown, true);
        const focusTarget = cancelRef.current ?? panelRef.current;
        if (focusTarget !== null && typeof focusTarget.focus === 'function') focusTarget.focus();
        return () => document.removeEventListener('keydown', onKeyDown, true);
      }, [open, sessionId]);

      if (!open) return null;

      const cancel = () => {
        if (busy) return;
        confirmStore.close();
      };
      const confirm = () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        removeSession(sessionId).then(
          () => confirmStore.close(),
          (failure) => {
            setError(describeFailure(failure, t));
            setBusy(false);
          },
        );
      };
      const closeOnMask = (event) => {
        if (event.target === event.currentTarget && !busy) cancel();
      };

      return h(
        'div',
        { className: 'dshds-root', role: 'presentation' },
        h('div', { className: 'dshds-mask', 'aria-hidden': 'true', onClick: closeOnMask }),
        h(
          'div',
          {
            className: 'dshds-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'dshds-delete-title',
            'aria-describedby': 'dshds-delete-description',
            tabIndex: -1,
            ref: panelRef,
          },
          h(
            'div',
            { className: 'dshds-dialog-content' },
            h(
              'div',
              { className: 'dshds-dialog-header' },
              h('h2', { id: 'dshds-delete-title', className: 'dshds-dialog-title' }, t('dialog.title')),
              h(
                'button',
                { type: 'button', className: 'dshds-dialog-close', 'aria-label': t('dialog.close'), onClick: cancel },
                h(CloseIcon, null),
              ),
            ),
            h(
              'p',
              { id: 'dshds-delete-description', className: 'dshds-dialog-description' },
              t('dialog.description', { name: targetTitle }),
            ),
            busy || error !== null
              ? h(
                  'div',
                  { className: 'dshds-dialog-body' },
                  busy ? h('div', { className: 'dshds-status', role: 'status' }, t('dialog.deleting')) : null,
                  error === null ? null : h('div', { className: 'dshds-error', role: 'alert' }, error),
                )
              : null,
          ),
          h(
            'div',
            { className: 'dshds-dialog-footer' },
            h(
              'button',
              { type: 'button', className: 'dshds-btn dshds-btn-outline', disabled: busy, onClick: cancel, ref: cancelRef },
              t('dialog.cancel'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dshds-btn dshds-btn-outline dshds-btn-danger',
                disabled: busy,
                onClick: confirm,
              },
              busy ? t('dialog.deleting') : t('dialog.confirm'),
            ),
          ),
        ),
      );
    }

    function apply(ctx) {
      ctx.effect(mountStyles, 'delete-session: styles');

      ctx.effect(() => {
        const disposers = [ctx.locale.register(NS, 'en', EN), ctx.locale.register(NS, 'zh', ZH)];
        return () => {
          for (const dispose of disposers) if (typeof dispose === 'function') dispose();
        };
      }, 'delete-session: locale');

      const confirmStore = createConfirmStore();
      const service = (key) => (typeof ctx.get === 'function' ? ctx.get(key) : ctx[key]);
      const sessions = service('sessions');
      const uiWorkspace = service('uiWorkspace');

      /**
       * Whether the conversation is on screen right now. `mainReference` is the
       * live selection the workspace service keeps; `retainedBy.mainView` is the
       * snapshot fact the list carries, used when the field is unavailable.
       */
      const showsInMainView = (sessionId) => {
        const main = uiWorkspace === undefined || uiWorkspace === null ? undefined : uiWorkspace.mainReference;
        if (main !== undefined && main !== null && typeof main.sessionId === 'string') return main.sessionId === sessionId;
        const row = sessions?.list?.getSnapshot?.()?.byId?.[sessionId];
        return row !== undefined && (row.retainedBy?.mainView ?? 0) > 0;
      };

      /** Back to the new-conversation window: drop the selection, release the retain. */
      const leaveMainView = () => {
        try {
          if (uiWorkspace && typeof uiWorkspace.clearMain === 'function') uiWorkspace.clearMain();
          else if (uiWorkspace && typeof uiWorkspace.startSession === 'function') uiWorkspace.startSession();
        } catch {
          /* Nothing left to clear if the workspace service is shutting down. */
        }
      };

      /**
       * A successful delete drops the row locally, re-reads the Host list, and —
       * when the deleted conversation was the one on screen — leaves the main
       * pane on the new-conversation window instead of the deleted transcript.
       */
      const removeSession = async (sessionId) => {
        // Captured first: the Host may already have published the removal by the
        // time the request resolves.
        const wasOnScreen = showsInMainView(sessionId);
        const result = await requestDelete(sessionId);
        try {
          if (sessions && typeof sessions.handleSessionRemoved === 'function') sessions.handleSessionRemoved(sessionId);
          if (sessions && typeof sessions.refresh === 'function') await sessions.refresh();
        } catch {
          /* The Host already stopped listing it; a failed refresh only delays the update. */
        }
        if (wasOnScreen) leaveMainView();
        return result;
      };

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'delete-session-dialog', order: 100, locale: NS }, (props) =>
          h(DeleteSessionDialog, Object.assign({}, props, { confirmStore, removeSession })),
        ),
      );

      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register({ name: 'sidebar.workspaces.session.menu.item', id: 'delete-session', order: 500, locale: NS }, (props) =>
          h(DeleteSessionMenuItem, Object.assign({}, props, { confirmStore })),
        ),
      );
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
