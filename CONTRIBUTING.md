# Contributing

感谢参与。这个项目采用：

- **许可证**：MIT（见 [LICENSE](LICENSE)）
- **贡献协议**：DCO 1.1 + 轻量再许可授权（见下）

## 开发环境

需要 Node.js 22+。没有构建步骤，也没有运行时依赖。

```powershell
git clone https://github.com/Hungry-M/dsh-deepseek-import.git
cd dsh-deepseek-import
node verify/test-parser.mjs
node verify/test-merge.mjs
node verify/test-plugin.mjs
node verify/test-workspace-shape.mjs
node verify/smoke.mjs
```

改动 **`workspace.json` 结构**或**会话日志结构**时，除了跑上面的测试，还必须：

1. 在真实 DSH 上完整启动一次，确认主窗口能起来、会话能打开、能跑命令；
2. 恢复测试留下的工作区与会话。

理由：0.2.6 曾因自动注册工作区时漏写 `createdAt`，让 `workspace.json` 校验失败、DSH 连主窗口都起不来。
单元测试只验证了「文件写出来了」，没有验证「应用还能启动」。

## 提交

每个 commit 必须带 DCO 签名：

```powershell
git commit -s -m "fix: ..."
```

生成：

```text
Signed-off-by: Your Name <you@example.com>
```

CI 会检查每个 PR 的 commit 是否带这个 trailer。

## 许可证授权（轻量再许可）

By submitting a contribution, you grant the maintainer a perpetual,
worldwide, non-exclusive, royalty-free, irrevocable license to reproduce,
modify, distribute, and relicense your contribution, alone or as part of this
project, under any OSI-approved license, including future versions of this
project's license. You retain copyright in your contribution.

中文要点：非独占、全球、免版税、不可撤销、允许随项目整体重新许可；**你保留著作权**。
这不是版权转让。目的是给将来切换 Apache-2.0 或做双许可留出空间，同时避免签署式 CLA 的摩擦。

如果你不能接受这条，请不要提交；可以先开 issue 讨论。

## 代码风格

- 没有格式化工具，保持一致即可：2 空格缩进、单引号、分号
- 注释写“为什么”，不写“做了什么”
- 用户可见文案同时提供中英文
- 新增 CLI 参数时，同步更新 `README.md` 与 `README.zh.md`

## 报告问题

安全问题请走 [SECURITY.md](SECURITY.md)，不要开公开 issue。
