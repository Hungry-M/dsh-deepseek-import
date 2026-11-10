# Privacy policy / 隐私政策

**DSH 对话迁移（DeepSeek → DeepSeek Harness）浏览器扩展**
最后更新：2026-11-10

## 中文

这个扩展**不收集、不上传任何数据**。

- **读取什么**：仅在你打开 `chat.deepseek.com` 且主动点击「抓取对话」时，读取该页面已加载的对话内容（你与 DeepSeek 的问答文本、思考过程、附件链接）。
- **存到哪里**：全部保存在你本机浏览器的扩展存储（`chrome.storage.local`）里，用于列表、勾选和导出。
- **发到哪里**：点击「导出」时，通过浏览器自身的下载功能写成一个 JSON 文件到你本机。**没有任何服务器参与，我们也没有服务器。**
- **附件**：只有你勾选导出的消息里带图片/文件时，扩展才会向你已登录的 `files.deepseeksvc.com` 请求该文件本体，同样只写到本机。
- **第三方共享**：无。不接入统计、不接入广告、不接入任何远程脚本。
- **数据保留**：完全由你控制。清空扩展数据或卸载扩展即可删除。

如果你用的是本项目的命令行导入工具（`dsh-import`），它只读写你本机的 DeepSeek Harness 会话目录，同样不联网。

## English

This extension **collects and uploads nothing**.

- **What it reads**: only the conversation content already loaded in an open `chat.deepseek.com` tab, and only when you click "Capture chat" yourself.
- **Where it is stored**: in your own browser extension storage (`chrome.storage.local`), used for the list, selection and export.
- **Where it goes**: when you click "Export", the browser's own download mechanism writes a JSON file to your machine. **No server is involved; we do not operate one.**
- **Attachments**: only when the messages you selected contain images or files, the extension fetches those bytes from your already-signed-in `files.deepseeksvc.com`, again writing them locally.
- **Third parties**: none. No analytics, no ads, no remotely hosted code.
- **Retention**: entirely under your control — clear the extension's data or uninstall it.

The companion CLI (`dsh-import`) only reads and writes your local DeepSeek Harness session directory. It makes no network requests.

## Contact

- Issues: <https://github.com/Hungry-M/dsh-deepseek-import/issues>
- Security: see [SECURITY.md](SECURITY.md)
