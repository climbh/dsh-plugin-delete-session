# dsh-plugin-delete-session

Adds a **Delete** row to every session's `…` (more options) menu in the
[DeepSeek Harness](https://github.com/deepseek-ai) sidebar, and removes that
session from this machine for good.

No shell work, no hand-cleaning `~/.dsh`.

## What it does

- **Menu row** — sits below the shipped *Pin*, *Rename*, *Fork*, *Archive* and
  *Session ID* rows, with the red trash glyph and the error tone by default, so
  it reads as destructive before you click it.
- **Confirm dialog** — title “Delete session”, one sentence carrying the
  session title: `"<title>" will be deleted permanently.`, *Cancel* / *Delete*
  buttons with the danger tone on *Delete*; Esc closes it and focus starts on
  *Cancel*.
- **Real deletion** — after confirming, the sidebar row disappears immediately,
  the old row can no longer be opened, and the session log is gone from disk. If
  you deleted the session you were reading, the main pane switches to the
  new-session window instead of showing a deleted transcript.
- **Sessions that are replying are left alone** — only `running` sessions are
  refused; paused, idle and open sessions delete normally.

## Install

Requires DeepSeek Harness 0.2.x (desktop app or `dsh web`).

**Through the plugin manager (recommended)** — Settings → Plugins, and give the
npm spec:

```
github:climbh/dsh-plugin-delete-session
```

**From a local checkout**

```sh
git clone https://github.com/climbh/dsh-plugin-delete-session.git
```

Then install the bundle from that directory with the plugin manager. Refresh the
Harness window once and the menu row is there.

**Uninstall**: remove `dsh-plugin-delete-session` in the plugin manager.

## Usage

1. Hover a session row in the sidebar and click `…`.
2. Click **Delete session**.
3. Confirm with **Delete**.

Deletion is permanent; there is no trash bin.

## What "delete" removes

| Step | Action | Why it is required |
| --- | --- | --- |
| 1 | Refuse only while `agent.status === 'running'` | A running turn keeps appending to the log; a paused session is safe to delete |
| 2 | Release the session from the Host stores (`sessions.detachEntered`, `agents.detachEntered`) | This is the only hook that publishes `session/disposed` → `api-session/removed`. The sidebar row disappears because of it, and the session becomes unopenable. Without it a deleted conversation stays listed and still opens: the list is the union of the records on disk and the live sessions |
| 3 | Remove `~/.dsh/sessions/<project>/<session-id>/` | The whole directory: `session.v4.jsonl.zstd` (or a v3/v1 log), `session.lock`, staging files. Bounded retry, so a still-flushing writer cannot recreate it |
| 4 | Detach the id from every workspace | Leaves no dangling id behind |
| 5 | Drop the archived/pinned bookkeeping | Both operations are idempotent |
| 6 | Remove the projection record `~/.dsh/storages/session_projcache/sessions/<session-id>.json` | It holds the derived title and the first user messages |

Steps 1–2 run before any file is touched, so a refused or failed release leaves
the session untouched.

## Matching the host UI

- The row and the dialog are plain React components styled only with
  `--dsw-alias-*` theme tokens, so light and dark themes follow the Harness.
- **No Harness Client package is imported** (not even
  `@deepseek-ai/dsh-client-ui-primitives`). The plugin-development rules ask
  plugins to draw their own controls: at worst a host refactor changes the
  appearance slightly instead of blanking the whole slot.
- All copy goes through the Client locale service, with built-in English and
  Chinese dictionaries.

## Limitations

- **Local files only** — a session whose files are already gone reports
  *not found* and only clears the bookkeeping.
- **Replying sessions are refused** — stop the turn first: interrupting a live
  reply from the outside is not a supported operation.
- **Paused, idle and on-screen sessions delete normally**; deleting the
  on-screen one switches the main pane to a new session.
- **Legacy inline projection records** — current builds store one projection
  record per session as a file (purged above). Older `session_projcache.json`
  files may still carry inline copies migrated long ago; this plugin does not
  rewrite that file, because the storage service owns it.
- The HTTP route is same-origin and unauthenticated, like the shipped upload
  route. It only listens on the local Harness web server.

## Development

```sh
node --check lib/index.js
node --check lib/client.js
npm test        # test/host.test.mjs + test/client.test.mjs
```

- `test/host.test.mjs` runs a fake Host in a temporary directory: release order,
  running refusal, missing directory, archive failure rollback, invalid ids.
- `test/client.test.mjs` runs `lib/client.js` in a `vm` sandbox with stubbed
  `react`/`document`, drives row → dialog → confirm, and asserts that deleting
  the on-screen session calls `clearMain`.

The Host half has no dependency on the Harness runtime: `deleteSession(ctx,
sessionId)` accepts any object exposing `get(key)` for `webServer`,
`sessionPersistence`, `workspaceRegistry`, `sessions` and `agents`.

## Layout

| File | Role |
| --- | --- |
| `lib/index.js` | Host: `POST /delete-session/delete`, `GET /delete-session/status`, `GET /delete-session/diag` |
| `lib/client.js` | Client: the menu row (`sidebar.workspaces.session.menu.item`) and the dialog (`shell.overlay`) |
| `cordis.patch.yml` | Bundle layer: inserts one `delete-session` entry |
| `locale/*.json` | Plugin name and description in the plugin manager |
| `icon.svg` | Plugin icon |

## License

MIT
