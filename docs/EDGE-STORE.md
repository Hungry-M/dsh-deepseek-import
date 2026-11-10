# Edge Add-ons 上架材料

> 用途：把 Partner Center 每个输入框要填的东西先写好，照着粘贴。
> 提交入口：<https://partner.microsoft.com/dashboard/microsoftedge/public/login>

## 一、提交前要准备的文件

| 项 | 要求 | 我们有什么 |
|---|---|---|
| 扩展包 | `.zip`，含 manifest | ✅ `dist/edge-extension-<version>.zip` |
| 扩展 logo | 1:1 位图，推荐 300×300，最小 128×128 | ✅ [assets/icon-300.png](../assets/icon-300.png) |
| 小宣传图 | 440×280（可选） | ⬜ 可不填 |
| 大宣传图 | 1400×560（可选） | ⬜ 可不填 |
| 截图 | 640×480 或 1280×800，最多 6 张（可选） | ⬜ 建议至少 1 张 |
| 隐私政策 URL | 收集个人信息时必填 | ✅ 用 https://github.com/Hungry-M/dsh-deepseek-import/blob/main/PRIVACY.md |

## 二、Availability

- **Visibility**：`Public`
- **Markets**：全部

## 三、Properties

| 字段 | 填什么 |
|---|---|
| Category | `Developer tools`（若无则选 `Productivity`） |
| Website | https://github.com/Hungry-M/dsh-deepseek-import |
| Support contact | https://github.com/Hungry-M/dsh-deepseek-import/issues |
| Mature content | 不勾 |

## 四、Privacy（这是评审重点）

**Single purpose**

> Capture conversations from chat.deepseek.com and export them as local JSON files for offline archival and for rebuilding them as DeepSeek Harness sessions with a companion CLI.

**Permission justification**

| 权限 | 理由 |
|---|---|
| `storage` | 在本机保存已抓取的对话，供列表、勾选与导出使用 |
| `unlimitedStorage` | 一份完整对话可能包含数十万字符（多次编辑、长回答），默认配额不够 |
| `downloads` | 把选中的对话写成 JSON 文件到用户本机 |
| `activeTab` | 只在用户点击扩展按钮时访问当前标签页 |
| `scripting` | 在页面上下文中读取已渲染的消息与附件链接 |
| host `chat.deepseek.com` | 这是扩展唯一作用的站点 |
| host `files.deepseeksvc.com` | 下载用户勾选消息中的图片/附件本体 |
| host `cdn.deepseek.com` | 页面资源与附件缩略图 |

**Remote code**：`No`（全部代码随包分发，无远程脚本）

**Data usage**：全部**不勾选**（不收集任何用户数据），并勾选 "不向第三方出售/传输" 等认证项。

**Privacy policy URL**：见上表。

## 五、Store listing（语言：中文 + 英文）

**Short description**（来自 manifest，改动需重传包）

- zh: 从 chat.deepseek.com 抓取对话并导出 JSON，用于归档或重建为 DeepSeek Harness 会话。
- en: Capture DeepSeek web chats and export them as JSON for archival or for rebuilding as DeepSeek Harness sessions.

**Long description**（≥250 字符，可直接粘贴）

> 中文：
> 这个扩展把 DeepSeek 网页版（chat.deepseek.com）的对话抓取下来，导出成 JSON 文件，配合同项目的命令行工具 `dsh-import`，可以把导出的对话重建为 DeepSeek Harness 的会话，从而在你自己的本地环境里继续对话、检索和归档。
>
> 支持的场景：
> - 单个或多个对话批量抓取，按仓库累积，不会重复
> - 超长对话自动向上回溯加载（也可以直接读浏览器本地缓存，通常无需滚动）
> - 保留思考过程、代码块、表格、多版本回答
> - 附件（图片、文本）会尽量一并导出
> - 导出文件可人工阅读，也可以只用于备份
>
> 所有数据只保存在你的本机：扩展不收集、不上传任何内容，也没有任何服务器参与。卸载扩展或清空数据即可删除。
>
> 本扩展与 DeepSeek 官方无关，未获其背书。

**Search terms**：`deepseek`, `chat export`, `backup`, `json`, `harness`, `archive`

## 六、Notes for certification（给审核员的说明）

> The extension works only on https://chat.deepseek.com and requires a signed-in DeepSeek account.
>
> 1. Sign in to https://chat.deepseek.com with your own DeepSeek account and open any conversation.
> 2. Click the extension icon, then click "Capture chat" (抓取对话).
> 3. The conversation appears in the list; tick it and click "Export selected" (导出选中).
> 4. A JSON file is downloaded. That exercises every permission: the page read, the attachment fetch (only if the conversation contains images) and the download.
>
> There is no server and no account for this extension itself. Nothing is uploaded. The privacy policy link describes this in detail.
>
> The companion CLI mentioned in the description is not part of this package and does not run inside the browser.

## 七、审核时长

提交后最长 7 个工作日。中途可能要求补充说明，注意 Partner Center 的通知邮件。
