# 发布清单

> 目的：把「登录 → 发布 → 上架」的每一步固定下来，避免每次靠记忆。
> 最后一次核对：2026-11-05

## 一、发版（npm）

```powershell
# 1. 改版本号（三处保持一致：package.json / git tag / CHANGELOG）
# 2. 提交
git add -A
git commit -m "chore: 0.2.1"

# 3. 打 tag 并推送 —— CI 会用 OIDC 可信发布，不需要验证码
git tag -a v0.2.1 -m "0.2.1: <一句话>"
git push origin main
git push origin v0.2.1
```

GitHub Actions 会依次跑：测试 → `npm publish --access public`。

**注意**：私有仓库不能带 `--provenance`（npm 会 422 拒绝）。仓库转公开后可以加回来。

发布后核对：

```powershell
npm view dsh-deepseek-import version
npm view dsh-deepseek-import dist-tags
```

## 二、上架插件市场（awesome-dsh-plugin）

前置条件（缺一不可）：

| 条件 | 检查方式 |
|---|---|
| `package.json` 里有 `dsh.bundle.patch` | `npm pkg get dsh` |
| 仓库公开 | GitHub → Settings → 最下方 Danger Zone |
| 仓库满 1 天 | GitHub API `created_at` |
| 加了 `dsh-plugin` topic | 仓库首页 About 旁的齿轮 |

提交：

1. fork `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`
2. 新建 `data/plugins/Hungry-M__dsh-deepseek-import.yml`，内容见 [awesome-entry.yml](awesome-entry.yml)
3. 只改这一个文件，**不要手改 README**
4. 提 PR，等 CI（entry 数 ≤3、dsh.bundle、仓库年龄、awesome-lint）
5. 通过后由维护者阅读仓库、合并；网站自动重建

## 三、Edge 扩展（可选）

目前是「加载解压缩的扩展」。上架 Microsoft Edge Add-ons 需要：

1. 注册开发者账号（免费）
2. 打包 zip（`edge-extension/` 整个目录）
3. 提交审核，1–3 天

## 四、常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| `EOTP` | 账号只配了 passkey，CLI 要 TOTP | 走 tag + CI 可信发布，或用网页 |
| `422 ... provenance` | 私有仓不支持 provenance | 去掉 `--provenance`，或公开仓库 |
| `ERE SOLVE` 装不上 | peer 范围排除了预发布版本 | 用 `>=0.0.0-0` 这类带预发布分支的范围 |
| 测试在 CI 挂、本地过 | 依赖了未提交的私有样本 | 样本缺失时 SKIP |
| 新会话侧栏不出现 | `workspace.json` 启动时读取 | 重启 DSH |
