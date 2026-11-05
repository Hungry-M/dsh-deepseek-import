# 发布清单

> 目的：把「登录 → 发布 → 上架」的每一步固定下来，避免每次靠记忆。
> 最后一次核对：2026-11-05

## 零、发版前必查（血的教训）

改动 **`workspace.json` 结构** 或 **会话日志结构** 的提交，发布前必须：

1. **在真实 DSH 上完整启动一次**——不是只跑单元测试，也不是只看文件写没写出来
2. 确认：主窗口能起来、工作区列表正常、目标会话能打开、能跑一条命令
3. 恢复现场：那次测试留下的工作区/会话，该删的删

> 反例（0.2.6）：自动注册工作区时少写了 `createdAt`。我的测试只检查了「文件写出来了」，
> 没有启动 DSH，于是带病的版本发到了 npm，用户更新后 DSH 直接起不来。

对应的自动化守卫（已有，别删）：

- `verify/test-workspace-shape.mjs` —— 工作区条目五个字段齐全
- `commitWorkspaceStore()` —— 写入前 schema 自检 + 自动回滚
- `verify/test-system-head.mjs` / `verify/smoke.mjs` —— 会话格式不变量

## 一、发版（npm）

```powershell
# 1. 改版本号（三处保持一致：package.json / git tag / CHANGELOG）
# 2. 提交
git add -A
git commit -m "chore: 0.2.7"

# 3. 打 tag 并推送 —— CI 会用 OIDC 可信发布，不需要验证码
git tag -a v0.2.7 -m "0.2.7: <一句话>"
git push origin main
git push origin v0.2.7
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
| 打开会话报 `grantWrite` | 工作区目录没有给当前用户「改权限/改所有者」，DSH 写不进自己的沙箱授权 | 0.2.4 起导入时自动在工作区目录上补一条可继承的完全控制；旧目录手动 `icacls <工作区目录> /grant "<用户>:(OI)(CI)F"` |

## 五、开源约定对照（`D:\Documents\dev-notes`）

约定：**MIT + DCO 1.1 + 轻量再许可授权**。当前状态：

| 项 | 状态 |
|---|---|
| `LICENSE`（MIT，版权人与年份正确） | ✅ |
| `CONTRIBUTING.md` 写明 DCO 与再许可条款 | ✅ |
| `SECURITY.md` 提供私密报告渠道 | ✅（GitHub 私密报告入口需仓库公开后可用） |
| `THIRD_PARTY_NOTICES.md` | ✅（当前不打包任何第三方代码） |
| `CHANGELOG.md` 记录版本 | ✅ |
| README 写项目状态与「非官方」 | ✅ |
| DCO 检查在 PR 上生效 | ✅ `.github/workflows/dco.yml` |
| 版本号各处一致 | ✅ |
| 工作树与 git 历史无敏感串 | ✅ `node verify/privacy-scan.mjs` |
| 示例配置用占位符 | ✅ |
| 测试使用临时 `DSH_HOME` | ✅ |
| GitHub secret scanning / Dependabot | ✅ 漏洞告警与自动修复已开启；secret scanning 需仓库公开 |
| 分支保护 / issue 与 PR 模板 | ⬜ 公开前补 |

