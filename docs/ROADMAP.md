# 路线图

> 最后更新：2026-11-05（v0.3.0）

## 已完成

| 版本 | 内容 |
|---|---|
| 0.1.x | 导入器：会话重建、旁挂文件、自动截断、多版本、中断输出 |
| 0.2.1–0.2.4 | system 头修复（否则继续对话即损坏）、`--audit/--repair`、附件并集、工作区权限预检 |
| 0.2.5–0.2.7 | `-w` 自动注册/建目录；`createdAt` 修复 + 写入前 schema 自检与回滚 |
| 0.3.0 | `--doctor` 体检；插件入口 `import_deepseek_chat`；CI + 可信发布 |

## 下一步（按优先级）

### 1. 会话一致性工具 `dsh-session`（并入本包，不新开项目）

做的是**四份状态一起处理**，不是又一个面板：

```
session.v4.jsonl.zstd        会话本体
workspace.json 的 sessionIds  归属登记
session_projcache/<id>.json   侧栏标题与统计
.dsh-imported/<id>/           侧挂文件与附件
```

规划的子命令：

| 命令 | 作用 | 现状 |
|---|---|---|
| `dsh-session doctor` | 体检（已实现为 `dsh-import --doctor`） | ✅ 已有 |
| `dsh-session delete <id>` | 永久删除，四份状态一起清 | ✅ 已有（remove-session.mjs） |
| `dsh-session move <id> --to <ws>` | 跨工作区迁移 | ✅ 已有（move-session.mjs） |
| `dsh-session copy <id> --to <ws>` | 复制为新会话（新 UUID，避免 ID 冲突） | ⬜ 待做 |
| `dsh-session branch <id> --from <msg>` | 从某条消息分叉成新会话 | ⬜ 待做 |
| `dsh-session create-thread` | 新建空会话（可带标题/工作区/初始提示词） | ⬜ 待做 |
| `dsh-session repair` | 补 system 头 / 重排序号 | ✅ 已有（repair-session.mjs） |

## 模块与客户端

核心逻辑只有一份，客户端只负责「选目标 + 展示结果」：

```
session-core.mjs               计划：四份状态的 plan/apply（唯一真源）
  ├─ CLI      dsh-import.mjs          命令行参数 → 调用核心
  ├─ TUI      dsh-import-tui.mjs      问答式选择 → 调用核心
  ├─ 辅助脚本 move/remove/repair/doctor 逐步并入核心
  └─ Host 插件 index.js               工具 schema + UI 按钮/热键 → 调用核心
```

约定：

- 核心只返回 `{ ok, changes[], warnings[] }`，不打印、不读 `process.argv`
- 所有破坏性操作默认 `dry-run`，必须显式 `--apply` 才写盘
- 写 `workspace.json` 前先 schema 自检，失败自动回滚（已有 `commitWorkspaceStore`）
- 新功能只写一次核心，各客户端只加适配层，不复制逻辑

## 与 DSH 原生能力的边界

当前安装的 DSH 是 `0.2.2-rc.1`，**已经有原生 fork**：`Fork copies the exact inclusive event
prefix selected by atSeq … into an independent Session`。所以：

- 插件里优先调用原生 fork（如果宿主暴露该 RPC），失败再回退到我们自己的实现
- CLI 场景没有宿主进程，只能自己实现
- **按能力探测，不按版本号硬编码**；版本号只用于日志与告警
- 将来若 DSH 提供 `session.create`，`create-thread` 也优先走原生

## 插件交互计划（Hotkeys）

| 热键 | 动作 |
|---|---|
| `Ctrl/Cmd+K` | 新建会话（create-thread） |
| `Ctrl/Cmd+B` | 从当前消息分叉（branch） |
| `Ctrl/Cmd+Shift+C` | 复制当前会话到别的工作区 |
| `Delete` | 删除会话（二次确认，走 dry-run 预览） |

热键属于「易变层」，等 Host 插件能实际安装、且确认新会话可即时出现在列表后再排期。

**为什么值得做**：插件市场 1000 个条目里，名字带 session 的 29 个，但都是 UI 快捷方式，
几乎不维护后三份状态。这两天的故障（登记丢失、`createdAt` 缺失、system 头、ACL）
全部出在这条缝里。

**为什么不做「管理面板」**：市场已有 `dsh-session-rewind`（回退+文件还原）、
`dsh-workspace-menu`（fork/copy/归档）、两个 `dsh-session-delete`、`dsh-session-copy`。
再做一个面板是第 30 个重复品。定位成库 + CLI，让 UI 插件来调用。

### 2. 侧栏标题预热

导入的会话在侧栏先显示「未命名」，因为 DSH 冷列表只读 header + 投影缓存。
可选的过渡方案：导入时写一条最小投影缓存（`version: 7`，含 `identity` + `rows.title`）。
风险是复刻内部格式，做成 `--seed-title-cache` 可选参数，先小范围验证。
根治要等 DSH 官方把标题放进 session header。

### 3. 分发

| 渠道 | 状态 |
|---|---|
| npm | ✅ 已发布（`dsh-deepseek-import`） |
| 私有仓库内测 | ✅ 现在的方式 |
| awesome-dsh-plugin 收录 | ⬜ 卡在仓库转公开 |
| Edge Add-ons 上架 | ⬜ 未开始 |

### 4. 保真度（低优先级）

- 引用链接还原：缓存里没有 URL，DOM 角标对号不可靠 → 暂不做
- 附件全量回捞：虚拟列表只能拿可视区 → 暂不做
- 自动截断改按 token 估算：现在按字符数，阈值与 DSH 压缩触发不对齐

## 明确不做

- `--split` 分片导入（会切断因果，判断为无意义）
- 另一个插件市场管理面板
