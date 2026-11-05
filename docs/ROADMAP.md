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
| `dsh-session repair` | 补 system 头 / 重排序号 | ✅ 已有（repair-session.mjs） |

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
