# dsh-plugin-delete-session

给 [DeepSeek Harness](https://github.com/deepseek-ai) 侧边栏里的每个会话加一个**删除**入口：在会话行的 `…`（更多选项）菜单里点「删除会话」，确认后把该会话从本机彻底删掉。

不需要命令行，也不需要手动清理 `~/.dsh`。

## 功能

- **菜单行**：位于会话菜单里 *置顶 / 重命名 / 复制 / 归档 / 会话 ID* 下方，红色垃圾桶图标，默认就是危险色，一眼能认出是删除。
- **确认弹框**：标题「删除会话」，正文一句话 `「<会话标题>」删除后不可恢复。`，*取消* / *删除* 两个按钮，删除按钮用危险色；支持 Esc 关闭、打开时焦点落在“取消”上。
- **真删除**：确认后侧边栏行立即消失、再点也打不开、会话日志从磁盘删掉；如果删的正是当前在看的会话，主视图会自动回到新会话窗口，而不是继续显示已删除的内容。
- **不打扰正在回复的会话**：只有真正在回复中（`running`）的会话会被拒绝，暂停、空闲、打开着的会话都能正常删除。

## 安装

需要 DeepSeek Harness（0.2.x）桌面端或 `dsh web`。

**方式一：插件管理器直接装 GitHub 版本**（推荐）

在 Harness 的「设置 → 插件」里安装，npm 规格填：

```
github:climbh/dsh-plugin-delete-session
```

**方式二：本地目录安装**

```sh
git clone https://github.com/climbh/dsh-plugin-delete-session.git
```

然后在插件管理器里选择「从本地目录安装」，目标填克隆下来的目录，例如
`~/dsh-plugin-delete-session`。安装完成后刷新一次 Harness 窗口，菜单里就有新行了。

**卸载**：插件管理器里移除 `dsh-plugin-delete-session`。

## 使用

1. 鼠标移到侧边栏的会话行，点右侧的 `…`；
2. 点「删除会话」；
3. 在弹框里确认「删除」。

删除是永久的，没有回收站。

## 删除到底做了什么

| 步骤 | 动作 | 为什么必须 |
| --- | --- | --- |
| 1 | 仅当 `agent.status === 'running'` 时拒绝 | 正在回复的轮次还会继续写日志；暂停的会话可以安全删除 |
| 2 | 从 Host 的会话/代理存储中释放（`sessions.detachEntered`、`agents.detachEntered`） | 这是唯一会发布 `session/disposed` → `api-session/removed` 的入口，列表行靠它消失，会话也由此变成不可打开。少了这一步，删完文件列表里仍然有、还能点开——因为列表是「磁盘记录 ∪ 运行中会话」的并集 |
| 3 | 删除 `~/.dsh/sessions/<项目>/<会话 ID>/` 整个目录 | 包括 `session.v4.jsonl.zstd`（或 v3/v1 日志）、`session.lock` 与暂存文件；带有限重试，避免仍在收尾的写入方把目录重建出来 |
| 4 | 从所有工作区里摘掉该会话 ID | 避免工作区里留下悬空引用 |
| 5 | 清理归档/置顶记录 | 两个操作都是幂等的 |
| 6 | 删除投影缓存 `~/.dsh/storages/session_projcache/sessions/<会话 ID>.json` | 里面存着会话标题和最早的几条用户消息 |

第 1–2 步在动文件之前完成，所以被拒绝或释放失败时，会话完全不受影响。

## 与官方界面的一致性

- 弹框和菜单行都是插件自己写的 React 组件，只引用 `--dsw-alias-*` 主题 token，浅色/深色主题都跟随 Harness；
- **不依赖任何 Harness Client 内部包**（例如 `@deepseek-ai/dsh-client-ui-primitives`）。官方规范要求插件自绘控件：内部包改版最多让外观有点偏差，不会让插槽整块空白；
- 文案全部走 Client 的 locale 服务，自带中英字典，界面语言跟随 Harness。

## 限制

- **只删本机文件**：文件已不存在的会话只会报告 *not found* 并清理记录。
- **正在回复的会话会被拒绝**，请先点「停止」再删：从外部强行中断一个正在说话的轮次不是受支持的操作。
- **暂停 / 空闲 / 正在看的会话可以正常删除**，正在看的那个删完会切到新会话窗口。
- **旧版内联投影记录**：当前版本每个会话一条投影缓存文件（已清理）。更老的 `session_projcache.json` 里可能有很早以前迁移留下的内联副本，插件不改写该文件（它是存储服务的私有状态）。
- **HTTP 路由同源且不鉴权**，和官方上传路由一致，仅监听本机 Harness Web 服务。

## 开发与测试

```sh
node --check lib/index.js
node --check lib/client.js
npm test        # test/host.test.mjs + test/client.test.mjs
```

- `test/host.test.mjs`：在临时目录里跑一个假 Host，覆盖释放顺序、运行中拒绝、找不到目录、归档失败回滚、非法 ID 等场景；
- `test/client.test.mjs`：在 `vm` 沙箱里用桩 `react`/`document` 执行 `lib/client.js`，驱动「菜单行 → 弹框 → 确认」全流程，并断言当前在屏的会话删完后会 `clearMain`。

Host 侧不依赖 Harness 运行时：`deleteSession(ctx, sessionId)` 接受任何提供 `get(key)` 的对象（`webServer`、`sessionPersistence`、`workspaceRegistry`、`sessions`、`agents`）。

## 目录

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | Host：`POST /delete-session/delete`、`GET /delete-session/status`、`GET /delete-session/diag` |
| `lib/client.js` | Client：菜单行（`sidebar.workspaces.session.menu.item`）与弹框（`shell.overlay`） |
| `cordis.patch.yml` | bundle 层：插入一个 `delete-session` 条目 |
| `locale/*.json` | 插件管理器里的名称与描述 |
| `icon.svg` | 插件图标 |

## License

MIT
