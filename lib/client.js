/**
 * Client half of dsh-plugin-delete-session.
 *
 * Two slot occupants share one confirmation state:
 *   - `sidebar.workspaces.session.menu.item` adds the red "Delete session" row
 *     under the shipped pin/rename/fork/archive rows;
 *   - `shell.overlay` renders the confirmation dialog.
 *
 * Everything is plain React plus `--dsw-alias-*` theme tokens: the plugin
 * imports no Harness Client package, so a host refactor can at worst change the
 * look of these two surfaces, never blank them out.
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
      'dialog.description': '"{name}" will be deleted permanently.',
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
      'dialog.description': '「{name}」删除后不可恢复。',
      'dialog.cancel': '取消',
      'dialog.confirm': '删除',
      'dialog.deleting': '正在删除…',
      'error.active': '该会话仍在回复中，请先停止后再删除。',
      'error.invalid': '这个会话 id 无效。',
      'error.undeletable': '无法删除会话文件，请检查会话目录的访问权限。',
      'error.failed': '删除会话失败',
    };

    /*
     * Geometry copied from the shipped conversation-menu rows and the shipped
     * confirmation modal; the colors are theme tokens, so light and dark both
     * follow the host theme.
     */
    const CSS = `
      .dshds-row {
        display: flex; align-items: center; gap: 8px; width: 100%;
        min-height: 32px; padding: 6px 10px; border: none; border-radius: 8px;
        background: transparent; color: var(--dsw-alias-state-error-primary);
        font: inherit; font-size: 13px; line-height: 20px; text-align: left; cursor: pointer;
      }
      .dshds-row:hover { background: var(--dsw-alias-bg-layer-2); }
      .dshds-row:focus-visible { outline: 2px solid var(--dsw-alias-state-error-primary); outline-offset: 1px; }
      .dshds-row-icon { flex: none; width: 14px; height: 14px; color: currentColor; }
      .dshds-row-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .dshds-backdrop {
        position: fixed; inset: 0; z-index: 2147483000; display: flex;
        align-items: center; justify-content: center; padding: 24px;
        background: rgba(0, 0, 0, 0.36); pointer-events: auto;
      }
      .dshds-dialog {
        box-sizing: border-box; width: min(420px, 100%);
        padding: 20px; border-radius: 14px;
        background: var(--dsw-alias-bg-overlay); border: 0.5px solid var(--dsw-alias-border-l1);
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.28); color: var(--dsw-alias-label-primary);
      }
      .dshds-dialog-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 22px; }
      .dshds-dialog-description { margin: 8px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
      .dshds-status { margin-top: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
      .dshds-error { margin-top: 8px; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
      .dshds-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
      .dshds-btn {
        box-sizing: border-box; height: 30px; padding: 0 12px; border-radius: 8px;
        border: 0.5px solid var(--dsw-alias-border-l2); background: transparent;
        color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer;
      }
      .dshds-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
      .dshds-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .dshds-btn:disabled { opacity: 0.5; cursor: default; }
      .dshds-btn-danger:not(:disabled) { color: var(--dsw-alias-state-error-primary); }
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

    function TrashIcon() {
      return h(
        'svg',
        {
          className: 'dshds-row-icon',
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', {
          d: 'M2.5 4.5h11M6.5 4.5V3.2c0-.4.3-.7.7-.7h1.6c.4 0 .7.3.7.7v1.3M5 4.5l.6 8.1c0 .4.3.7.7.7h3.4c.4 0 .7-.3.7-.7l.6-8.1',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M6.9 7.1v4.2M9.1 7.1v4.2',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
        }),
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
          className: 'dshds-row',
          'data-dsh-delete-session': '',
          onClick: onSelect,
        },
        h(TrashIcon, null),
        h('span', { className: 'dshds-row-label' }, t('menu.delete')),
      );
    }

    function DeleteSessionDialog({ t, confirmStore, removeSession }) {
      const pending = React.useSyncExternalStore(confirmStore.subscribe, confirmStore.get, confirmStore.get);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const cancelRef = React.useRef(null);
      const open = pending !== null;
      const sessionId = pending === null ? null : pending.sessionId;
      const targetTitle = pending === null ? '' : pending.displayTitle;

      React.useEffect(() => {
        if (!open) return undefined;
        setBusy(false);
        setError(null);
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            confirmStore.close();
          }
        };
        document.addEventListener('keydown', onKeyDown, true);
        if (cancelRef.current !== null && typeof cancelRef.current.focus === 'function') cancelRef.current.focus();
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
      const closeOnBackdrop = (event) => {
        if (event.target === event.currentTarget && !busy) cancel();
      };

      return h(
        'div',
        { className: 'dshds-backdrop', onMouseDown: closeOnBackdrop },
        h(
          'div',
          {
            className: 'dshds-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'dshds-delete-title',
            'aria-describedby': 'dshds-delete-description',
          },
          h('h2', { id: 'dshds-delete-title', className: 'dshds-dialog-title' }, t('dialog.title')),
          h(
            'p',
            { id: 'dshds-delete-description', className: 'dshds-dialog-description' },
            t('dialog.description', { name: targetTitle }),
          ),
          busy ? h('div', { className: 'dshds-status', role: 'status' }, t('dialog.deleting')) : null,
          error === null ? null : h('div', { className: 'dshds-error', role: 'alert' }, error),
          h(
            'div',
            { className: 'dshds-actions' },
            h(
              'button',
              { type: 'button', className: 'dshds-btn', disabled: busy, onClick: cancel, ref: cancelRef },
              t('dialog.cancel'),
            ),
            h(
              'button',
              { type: 'button', className: 'dshds-btn dshds-btn-danger', disabled: busy, onClick: confirm },
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
