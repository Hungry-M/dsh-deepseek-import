# DSH 对话迁移

[English](README.md) | 中文

从 **Edge** 抓取 `chat.deepseek.com` 的对话（单个或多个），导出 JSON，再由本地脚本重建为 DeepSeek Harness 的可继续会话。

```
Edge 扩展  ──导出──▶  dsh-deepseek-*.json  ──dsh-import.cmd──▶  ~/.dsh/sessions + workspace.json
```

## 安装

需要 **Node.js 22+**（会话压缩用了内置 zstd）。

```powershell
# 从 npm（发布后）
npm i -g dsh-deepseek-import
dsh-import --list
# 或直接用源码，不装全局
git clone https://github.com/Hungry-M/dsh-deepseek-import.git
cd dsh-deepseek-import
node dsh-import.mjs --list
```

扩展必须单独加载（见下一节）——浏览器扩展没法随 npm 包一起装。

### 作为 DSH 插件安装（可选）

同一个包也是 DSH 的 Host 插件，装上后可以直接在对话里让模型导入：

```
dsh plugin add dsh-deepseek-import
```

它会注册工具 `import_deepseek_chat`，之后一句话就行：

> 把 `D:\Downloads\dsh-import\dsh-deepseek-20261103.json` 导入到当前工作区

插件只负责「导入」，**扩展仍需单独加载**。新会话在侧栏下次刷新时出现；若没出现，重启 DSH。

## 一、安装扩展（一次性）

1. Edge 地址栏打开 `edge://extensions/`
2. 打开左下角 **开发人员模式**
3. 点 **加载解压缩的扩展**，选择本目录下的 `edge-extension` 文件夹
4. 固定到工具栏（可选）

## 二、抓取对话

1. 在 Edge 打开 `chat.deepseek.com` 的任意对话，**等它加载完**（消息出现即可）。
2. 点扩展图标，列表里会出现这条对话（标题 + 消息条数）。
3. 想看多条：逐个打开对话，每次都会自动捕获，列表累积。
4. 勾选要导出的对话 → **导出选中** → 保存 JSON。

> 原理：扩展在页面主世界给 `fetch`/XHR 挂了只读嗅探，只读取 DeepSeek 自己的响应体，不发额外请求、不上传任何东西。
> 如果某条对话没被捕获，打开它然后点扩展的 **抓取对话**（会按「本地缓存 → 逐屏回溯 → 当前屏」依次尝试）。

### 超长对话怎么抓全

DeepSeek 的长对话是**分页加载**的，每次只能看到一屏。扩展做了两件事：

1. **按消息身份合并**：每页消息带 `message_id`，扩展把它当唯一键取并集，再按 id 排序。所以往上翻、往下翻、重复抓同一页，都只会**累加**，不会覆盖已经拿到的部分。
2. **抓取对话**：一个按钮搞定三种来源——先读浏览器本地缓存（IndexedDB 里有全量），读不到再逐屏向上回溯，最后退回只抓当前屏。

> 为什么 DOM 只抓到一屏也不怕：滚动时的分页请求会被扩展嗅探到，那份数据是带 id 的完整消息；DOM 抓取只是补充。

## 三、导入到 DSH

双击工作区里的 **`dsh-import.cmd`**，或把 JSON 拖到它上面。

- 会列出 DSH 里的工作区，选序号决定导入到哪个工作区
- 每个对话重建为一个会话，标题、顺序、正文（含代码块/表格等 Markdown）原样保留
- **附件**（图片、txt、pdf、docx…）：**仅当数据源带附件时**才落盘到 `<工作区>/.dsh-imported/<sessionId>/`，保留原文件名；下载不到时退化成 `[附件未下载：文件名（大小） 原链接]`，由你本机匹配。DeepSeek 的 IndexedDB 缓存副本通常不含附件
- **思考过程**写进同目录的 `thinking.md`（旁挂存档，不进入对话上下文）
- **编辑/重新生成留下的多个版本**：正文只保留当前分支，全部版本写进同目录的 `revisions.md`
- 改动 `workspace.json` 前自动备份为 `workspace.json.bak-<时间>`
- 所有输出同时写进 `import.log`，窗口一闪而过也能查原因

### 重要：导入后要重启 DSH

侧边栏列表读自 `~/.dsh/storages/workspace.json`，DSH **只在启动时加载**。导入完成后请**完全退出并重新打开** DeepSeek Harness，否则新会话不会出现。

如果重启后还是看不到，顺序改成：**先完全退出 DSH → 再双击 `dsh-import.cmd` → 再启动 DSH**。因为 DSH 运行时可能用内存里的旧列表覆盖 `workspace.json`。

### 配置（CLI / TUI / 扩展共用一套约定）

`import.config.json`（与本文件同目录）：

```json
{ "downloadDir": "D:\\Downloads", "subdir": "dsh-import", "lang": "zh" }
```

| 字段 | 作用 |
|---|---|
| `downloadDir` | 去哪个目录找导出文件（默认读系统真实下载目录） |
| `subdir` | 下载子目录约定：扩展存到 `<下载目录>/<subdir>/`，CLI/TUI 也扫这里 |
| `lang` | `zh` / `en`，影响 TUI 与扩展界面 |
| `autoTrim` | 默认 `true`：超过阈值的长对话自动截断 |
| `autoTrimChars` | 触发阈值，默认 `120000` 字 |
| `autoTrimTurns` | 最多保留轮数，默认 `20` |
| `autoTrimBudget` | 保留部分的字符预算，默认 `60000` 字（从最后一条往前累加到超预算） |

`--no-auto-trim` 可单次关闭；`--tail N` 显式指定保留轮数。

旁挂文件默认写在 `<工作区>/.dsh-imported/`，可以改位置：`--no-sidecar`（写到 `~/.dsh/import-archive/`）或 `--sidecar-dir <路径>`。

旁挂文件的位置也能在设置里选：勾 **旁挂文件写到 DSH 目录** 就不往工作区写 .dsh-imported（等价于 CLI 的 `--no-sidecar`）。

这四个参数也可以在**扩展的 ⚙ 设置**里改：勾选框控制开关，下面的「高级参数」是默认折叠的，里面是三个数字。扩展会把它们写进导出 JSON 的 `options`，导入时按这个优先级生效：

```
命令行参数  >  导出文件里的 options（扩展设置）  >  import.config.json  >  内置默认值
```

```powershell
node dsh-import.mjs --set-dir "E:\chat"   # 写入配置
node dsh-import.mjs --dir "E:\chat"       # 只本次生效，不改配置
```

扩展侧：面板右上 ⚙ → **保存子目录**（留空=直接存下载目录）。浏览器不允许扩展写任意绝对路径，所以「共享」靠的是这个子目录约定，而不是写死某个盘符。

### 命令行接口（给 AI / 脚本用）

```powershell
node dsh-import.mjs --list                     # 只列工作区
node dsh-import.mjs                            # 自动用下载目录里最新的导出
node dsh-import.mjs 导出.json -w "D:\proj"      # 直接指定工作区
node dsh-import.mjs 导出.json --dry-run         # 只解析不写盘
node dsh-import.mjs 导出.json --thinking        # 另外把思考塞进正文（默认只写 thinking.md）
node dsh-import.mjs 导出.json --json            # 机器可读输出：{ok, workspace, created[]}
node dsh-import.mjs 导出.json --keep-versions   # 保留编辑前的旧版本（默认只留当前分支）
node dsh-import.mjs 导出.json --keep-interrupted # 保留不完整的中断输出（默认只留编号占位符）
node dsh-import.mjs 导出.json --only "<对话 id>"       # 只导指定对话（逗号分隔可多个）
node dsh-import.mjs 导出.json --from-match "某句话"     # 从匹配到的用户消息开始分支
node dsh-import.mjs 导出.json --from-index 157         # 按消息序号分支
node dsh-import.mjs --audit                            # 体检已导入会话（system 头是否完好）
node dsh-import.mjs --repair                           # 批量修掉有隐患的会话

> --tail 与 --from-index/--from-match 互斥（一个是取最后 N 轮，一个是从指定位置开始），同时给出会直接报错退出；--from-* 只能用于单个对话。
```

### 中断输出怎么处理

被手动中止的回答，默认在会话里只留一行带编号的占位符：

```
[中断输出 #2：未产生完整正文，思考过程见 thinking.md]
```

- 编号来自 `message_id`，用来证明「这里确实有过一次中断输出」
- 思考照常进 `thinking.md`
- 加 `--keep-interrupted` 才保留原始的不完整正文；正文本来就空的仍然用占位符
- 识别依据：消息的 `status` 不是 `FINISHED`、或 `incomplete_message` 为真、或正文为空；老数据没有 `status` 时只能靠「正文为空」判断

### 从某条消息开始分支

想把会话“截断”在某个位置重新开始，而不是只用最后 N 轮：

```powershell
node dsh-import.mjs 导出.json --from-match "照你的顺序来吧"
node dsh-import.mjs 导出.json --from-index 157
```

- `--from-match` 在**用户消息**里做不区分大小写的全文匹配，命中第一条
- 同一句话被编辑过、出现多次时，TUI 会把它们按时间顺序编号列出来让你选：
  ```
   1  #158  照你的顺序来吧，只要你不忘记清单。…
   2  #160  照你的顺序来吧，只要你不忘记清单。…
  选择序号（回车=1，共 2 条匹配）：
  ```
- 选了分支点就不再自动截断（尊重你的选择），完整原文照样写进 `transcript.md`

### 超长对话别整段导入

一份 227 条、52 万字符的对话大约 25–35 万 tokens，直接导入必然超过上下文窗口。DSH 会自动压缩（`dsh-compaction-basic`），但压缩后只逐字保留约 16% 的近期内容，其余变成摘要——等于白导。

```powershell
node dsh-import.mjs 导出.json --tail 20
```

- 只导入**最后 20 轮**，全文另存 `.dsh-imported/<sessionId>/transcript.md`
- 第一条消息里会附一行说明 + 旁挂文件索引，模型需要早期细节时可以自己 grep 那个文件
- 超过 15 万字符的对话即使不加 `--tail` 也会自动留一份 `transcript.md`

`dsh-import.mjs` 同时是模块，可被引用：```js
import { runImport, getWorkspaces, listExports, peekExport } from './dsh-import.mjs';
await runImport({ files: ['x.json'], workspacePath: 'D:\\proj', only: ['<对话 id>'] });
```

### 交互界面

```powershell
node dsh-import-tui.mjs
```

菜单流程：选导出文件（带大小/时间）→ 预览对话（条数/字数/思考段数/附件数）→ 多选（`all`、`1,3`、`1-2`）→ 选工作区 → 确认导入。

### 旁挂文件怎么被读到

导入时会在**第一条用户消息末尾**附一行索引：

```
[导入存档（需要时可直接读取）：思考 2 段 → .dsh-imported/<sessionId>/thinking.md；附件 → .dsh-imported/<sessionId>/]
```

这些文件都在工作区目录内，后续对话里模型可以随时用文件工具按需读取（不会自动塞进上下文）。

## 常见问题

**复制工作区后 DSH 列表全空？**
DSH 要求 **Session ID 全局唯一**，同一个 ID 出现在两个项目目录会让整个会话列表加载失败（`duplicate JSONL session id`）。`copy-workspace.mjs` 现在会为每条复制出的会话**重新生成 UUID**，并同步改写 header 与事件里的引用。改完先体检再启动：

```powershell
node check-sessions.mjs
```

它会检查重复 ID、目录名与 header.id 是否一致、每帧能否解压、seq 是否连续、workspace.json 与磁盘是否对账。退出码 0 才启动 DSH。

如果已经出了重复，把冲突的项目目录整体移出 `~/.dsh/sessions`（DSH 只扫这一层），再从 workspace.json 移除对应条目，重启即可恢复——原会话文件不会损坏。

**双击 cmd 提示「找不到 Node.js」？**
脚本按这个顺序找：`node-path.txt`（同目录，可手写一行路径）→ PATH → `Program Files\nodejs` → `Program Files (x86)\nodejs` → `%LOCALAPPDATA%\Programs\nodejs` → `%APPDATA%\npm` → 同目录的 `node.exe`。都没命中就装一个 Node 22+，或把 `node.exe` 放到脚本旁边。

**cmd 到底会导入哪个文件？**
不带参数：`~/Downloads` 里**最新**的 `dsh-deepseek-*.json`。也可以把文件（或整个文件夹）拖到 cmd 上，或自己传多个路径。工作区是运行时从 `workspace.json` 列出来让你选序号的。

**测试时要不要删掉 Downloads 里的旧 json？**
不用。脚本只取最新一份，旧的不会混进来。想批量导入就拖多个文件上去，或传一个目录（目录里所有 `.json` 都会被读）。

**双击 cmd，窗口一闪而过什么都没发生？**
旧版本的文件用了 LF 换行，`cmd.exe` 解析失败，脚本根本没执行。现在的版本改用 CRLF，并且无论成败都会停在 `pause`，输出同时写入 `import.log`。如果仍然闪退，直接看 `import.log`。

**导入成功但侧边栏没有？**
先按上面「重要」那段重启；还不行就按「先退出 → 再导入 → 再启动」的顺序来。

**正文只抓到一小段？**
说明命中的不是完整历史接口。打开 DeepSeek 页面 → 点扩展的 **诊断** → 会导出 `dsh-debug-*.json`（含页面请求的 URL、content-type、非 JSON 响应样本）。把它发给我即可定位真实接口。注意：文件里有会话 id 和 URL，介意可自行打码。

## 已知限制

- **引用与附件取决于数据源**：DeepSeek 的 IndexedDB 缓存副本只保留正文和思考，`references` 表与 `files` 字段通常不在里面。因此 `references.md` 和附件目录**只在数据源带这两类数据时才会生成**，没有生成是正常结果，不是失败。想找回图片只能回原网页另存。

- **思考过程旁挂**：写进 `thinking.md`，不进上下文。DSH 的 reasoning 块带 provider 签名，硬塞正文会污染后续请求；想看时直接翻文件，或加 `--thinking` 强制内联。
- **附件不进 DSH 附件库**：DSH 的图片是内容寻址附件（`~/.dsh/attachments/v1/objects/...`），伪造引用有损坏历史的风险；这里改为落盘 + 路径引用，模型可以用工具读。拿不到下载地址时只留文件名与大小。
- **正文完整性**：历史接口 `/api/v0/chat/history_messages` 返回的正文可能偏短；回答生成时的 `/api/v0/chat/completion` 是 `text/event-stream` 补丁流（`THINK` 片段=思考，其余片段=正文），扩展会边读边拼，生成完即写入捕获。所以**新回答**是完整的；很久以前的老回答以历史接口返回的内容为准。
- **只迁移文本与附件**：DeepSeek 工具调用、联网搜索的结果没有结构化导出，只能作为正文的一部分。
- **会话格式是 DSH 内部实现**（v4 JSONL + zstd，多帧拼接）。DSH 升级若改格式，本工具需要跟着改；导入前建议确认版本。
- 扩展依赖 DeepSeek 页面自己的接口响应；页面大改版导致捕获不到时，用 **抓取对话** 兜底。

## 四、把导入的会话换到别的工作区

```powershell
node move-session.mjs --list                                     # 看每个工作区有哪些会话
node move-session.mjs <session-id> --to "D:\某个工作区"            # 换过去
node move-session.mjs <session-id> --to "D:\某个工作区" --dry-run   # 先看要动什么
```

同时改四处：会话日志里的 `cwd`、会话目录所在的项目文件夹、`workspace.json` 的 `sessionIds`、`.dsh-imported/<id>` 里的附件。改完重启 DSH 生效。

## 回滚

- 删除会话目录：`~/.dsh/sessions/--<工作区>--/session-<uuid>/`
- 恢复列表：用同名的 `workspace.json.bak-*` 覆盖 `workspace.json`
- 单个会话：`node remove-session.mjs <session-id>`

## 目录结构

```
edge-extension/
  manifest.json      MV3 清单
  inject.js          主世界：只读嗅探 fetch/XHR 响应
  content.js         隔离世界：归一化、DOM 兜底、图片转 dataURL
  background.js      存储捕获结果
  popup.html/js/css  选择与导出界面
dsh-import.mjs       导出 JSON → DSH 会话
dsh-import.cmd        双击入口
```
