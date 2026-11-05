# Changelog

版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)；`0.x` 阶段 API 与数据格式仍可能变化。

## [Unreleased]

- `dsh-session` 子命令集：`copy`（复制为新会话）、`branch`（从某条消息分叉）
- 可选：导入时预热侧栏标题缓存（`--seed-title-cache`）
- 上架 awesome-dsh-plugin 与 Edge Add-ons

## [0.3.0] - 2026-11-05

### Added

- `--doctor`：一条命令体检环境、工作区字段与路径、会话日志结构、投影缓存覆盖、Windows 工作区权限
- 回归测试 `verify/test-workspace-shape.mjs`，并接入 CI

## [0.2.7] - 2026-11-05

### Fixed

- 自动注册工作区时缺 `createdAt`，导致 `workspace.json` 校验失败、DSH 无法启动
- 写入 `workspace.json` 前新增 schema 自检，失败即从备份回滚

## [0.2.6] - 2026-11-05

### Added

- `-w` 指向不存在的目录时自动创建（等同于 `mkdir -p`）

## [0.2.5] - 2026-11-05

### Added

- `-w` 指向未注册但存在的目录时自动注册为工作区

## [0.2.4] - 2026-11-05

### Fixed

- 导入时确保目标工作区对当前用户可写，避免 DSH 沙箱授权失败（`grantWrite` / Win32 5）

## [0.2.3] / [0.2.2] / [0.2.1]

### Fixed

- 插件入口惰性解析 `@deepseek-ai/dsh-tools`，缺该包时不再加载失败
- 参数 schema 中只有 `file` 必填

## [0.2.0] - 2026-11-04

### Added

- DSH Host 插件入口：注册工具 `import_deepseek_chat`
- 市场元数据（`locale/`、`icon.svg`、`cordis.patch.yml`）

## [0.1.2] - 2026-11-04

### Fixed

- 合并同一消息的两份副本时保留附件（并集），不再因正文更长而丢图

## [0.1.1] - 2026-11-04

### Fixed

- 导入的会话写入受保护的 `system` 头，避免继续对话后日志被判损坏
- 新增 `repair-session.mjs`：体检并修复已导入的会话

## [0.1.0] - 2026-11-04

### Added

- 首个发布：Edge 扩展抓取 + CLI 导入，会话重建、旁挂文件、自动截断、多版本、中断输出
