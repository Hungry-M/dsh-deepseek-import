# 项目交接：dsh-deepseek-import

## 一句话

把 DeepSeek 网页对话（chat.deepseek.com）抓取导出，再重建为 DeepSeek Harness 的会话。
由三部分组成：Edge 扩展（抓取）、CLI（导入）、DSH Host 插件（在对话里调用导入）。

## 当前状态（2026-11-11）

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/Hungry-M/dsh-deepseek-import （公开，main = 70f0c00） |
| npm | `dsh-deepseek-import@0.3.2`（latest，CI 可信发布） |
| DSH 市场 | 已收录（PR #13814 已合并，维护者改写过渡描述） |
| Edge 商店 | 已上架：https://microsoftedge.microsoft.com/addons/detail/klboneoglpkdhefejpnhbkjbjpiklfmn |
| 本地工作区 | `D:\Desktop\dsh-web-chat-migration` |

## 模块与职责

```
edge-extension/        MV3 扩展：抓取对话，导出 JSON
  inject.js            MAIN world，只读嗅探 fetch/XHR
  stream-parser.js     解析 DeepSeek 的 SSE 补丁流
  merge.js             按 messageId / 内容重叠合并多次抓取
  content.js           归一化、IndexedDB 缓存读取、DOM 兜底、自动回溯
  background.js        捕获存储、附件下载
  popup.html/js/css    勾选与导出

dsh-import.mjs         导出 JSON → DSH 会话（核心）
dsh-import-tui.mjs     问答式导入
move-session.mjs       会话跨工作区迁移
remove-session.mjs     永久删除会话
repair-session.mjs     补 system 头 / 重排序号
doctor.mjs             只读体检（环境/工作区/会话/权限/缓存）
index.js               Host 插件入口，注册工具 import_deepseek_chat
```

## DSH 数据面：一个会话有四份状态

```
sessions/--<cwd>--/session-<uuid>/session.v4.jsonl.zstd   会话本体（多帧 zstd，每帧一条 JSON）
storages/workspace.json 的 tables.workspaces[id].sessionIds   归属登记
storages/session_projcache/sessions/<id>.json                 侧栏标题与统计（冷列表只读它）
<工作区>/.dsh-imported/<id>/                                   旁挂文件：thinking/transcript/references/附件
```

任何操作都要同时维护这四份，只改一份就会出现「会话能打开但列表不显示」这类问题。

## 踩过的坑（不要再犯）

1. **system 头**：v4 要求 surface 第一个节点是 `system/message`。早期导入器没写，会话能打开，但一继续对话运行时追加 system/message 就会被判损坏。现在导入器固定写一条。
2. **workspace.json 字段**：`path/title/sessionIds/createdAt/updatedAt` 缺一不可。0.2.6 少写 `createdAt`，DSH 直接起不来。现在写入前自检，失败从备份回滚。
3. **工作区权限**：DSH 沙箱每次运行要往工作区写一条受限 SID 授权，需要目录本身有「改权限/改所有者」。导入时会自动补 `icacls <dir> /grant "<user>:(OI)(CI)F"`（0.2.4+）。
4. **侧栏「未命名」**：DSH 列表只读 header + 投影缓存，不打开冷会话。导入的会话没有缓存，打开一次就正常。这是设计，不是 bug。
5. **沙箱内执行命令**：受限进程打不开命名管道，`execFileSync` 默认管道会 EPERM。要用临时文件捕获 stdout（0.3.2+）。
6. **npm 版本不可复用**：一个版本被 unpublish 后不能重发同号，只能发新版本；坏版本用 `npm deprecate` 标记。
7. **provenance**：私有仓不能带 `--provenance`（422），公开后才有。
8. **peer 依赖**：官方 `@deepseek-ai/*` 要用 `>=0.0.0-0` 这类含预发布分支的范围，否则 ERESOLVE。
9. **推送**：沙箱读不到 Windows 凭据（`SEC_E_NO_CREDENTIALS`），git push 需要用户批准一次不受限执行。

## DSH 原生能力边界（2026-11 实测）

| 能力 | 宿主 API | 备注 |
|---|---|---|
| 新建 / 分叉会话 | `session.create` / `fork`（按 `atSeq` 复制前缀） | UI 里已有「分叉会话」 |
| 工作区 创建/重命名/删除/排序 | `ctx.workspaceController` | **没有改路径的能力** |
| 会话归档 | `archiveSession` | 有 |
| 会话永久删除 | 无 API | 只能磁盘操作 |
| 会话改归属工作区 | 无 API | 只能磁盘操作 |

结论：分叉、复制会话已被原生覆盖；我们只做 move / delete / workspace-move / doctor。

## 0.4.0 范围（收缩后）

1. `dsh-session` 命令集（同一个包的新 bin），先收编已有脚本：`move`、`delete`、`repair`、`doctor`
2. `move` 支持多会话：`dsh-session move id1 id2 --to <工作区>`
3. `workspace-move`：迁移工作区路径，同步所有会话 cwd，清投影缓存
4. 破坏性操作统一：默认 dry-run、`--json`、写 workspace.json 前自检回滚
5. 测试：move / workspace-move 各一条端到端（临时 DSH_HOME → 造会话 → 迁移 → 校验）
6. **不做**：branch / copy（原生已有）、会话文件位置迁移（改 cwd 后 DSH 自己会找）

## 待验证

**能否不重启 DSH 热加载新会话**：
- 静态：`session.list` 只读 header + 投影缓存，理论上加目录就出现
- 动态：DSH 运行时用工具造会话 → GUI 切工作区再切回 → 看是否出现
- 出现 → 插件可以纯磁盘操作；不出现 → 插件必须走原生 create

## 关键文档

- `README.md` / `README.zh.md`：安装与使用
- `docs/ROADMAP.md`：路线图与决策
- `CHANGELOG.md`：版本历史
- `CONTRIBUTING.md`：DCO + 再许可条款 + 发布前必查
- `SECURITY.md` / `PRIVACY.md`

## 工作约定

- 改 `workspace.json` 或会话日志结构的提交，发布前必须在真实 DSH 上启动验证一次
- 破坏性命令默认 dry-run，显式 `--apply` 才写
- 提交带 `Signed-off-by`（`git commit -s`），CI 会检查
- 中文注释解释「为什么」，用户可见文案中英双语
