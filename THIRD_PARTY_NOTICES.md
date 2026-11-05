# Third-party notices

本项目自身代码采用 MIT（见 [LICENSE](LICENSE)）。这个文件列出分发时涉及的第三方组件。

## 分发的产物里**不含**第三方代码

npm 包（`dsh-deepseek-import-*.tgz`）与 Edge 扩展（`edge-extension/`）都是本项目原创代码，
没有打包任何第三方库，也没有 `dependencies`。

`package.json` 里唯一的 peer 依赖是 `@deepseek-ai/dsh-tools`：它由 DSH 宿主在运行时提供，
**不随本包分发**，也不复制其代码。

## 运行时依赖（不随包分发）

| 组件 | 许可证 | 说明 |
|---|---|---|
| Node.js 22+ | MIT | 用户自行安装；用到内置的 `zlib`（zstd 解压）、`fs`、`crypto`、`child_process` |
| DeepSeek Harness | 见其自身许可 | 本工具读写它的会话数据，但不包含它的代码 |

## 开发期工具（不进产物）

| 组件 | 许可证 | 用途 |
|---|---|---|
| Pillow | HPND | 生成市场图标（`tools/make-icon.py`） |

## 分发二进制时（尚未提供）

如果将来发布单文件可执行（Node SEA / PyInstaller 等），必须附带：

- Node.js 的完整许可证文本
- 任何被一并打包的库的许可证

这条尚未适用：目前只分发源码包与扩展。
