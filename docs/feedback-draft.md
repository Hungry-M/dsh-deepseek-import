# DSH 反馈草稿（待过目，未提交）

> 目的：报告「工作区沙箱授权失败」这一类问题。
> 约束：不含对话内容、不含文件路径、不含账号信息、不含日志。
> 状态：**未提交**，等你确认。

---

## 英文版（提交用）

**Title:** Sandbox workspace grant fails on folders that inherit only "Modify"

**Environment:** DSH Desktop on Windows 10 (build 19045); NTFS workspace on a secondary drive.

**Symptom:** The first sandboxed command in a workspace aborts before it runs:

```
Error: SetNamedSecurityInfoW failed (Win32 5): grantWrite(<workspace path>)
```

**Reproduction**

1. Create a folder under a parent whose inherited permissions give the signed-in user only `Authenticated Users: Modify` (a redirected user folder behaves this way).
2. Add that folder as a DSH workspace and open a session.
3. Run any command.

**Observation**

- The freshly created folder has no ACE for the signed-in user; `icacls` lists Administrators (F), SYSTEM (F), Authenticated Users (M), Users (RX).
- `Modify` does not include WRITE_DAC or WRITE_OWNER, so the grant call is denied.
- The user owns the folder, so WRITE_DAC is implicit; the right that appears to be missing is WRITE_OWNER.
- Adding an inheritable full-control ACE for the signed-in user **on the workspace folder itself** makes the next provisioning attempt succeed, and DSH then adds its per-run restricted-SID entry.

**Request**

1. Grant the ACE on the workspace folder itself instead of relying on rights inherited from its parent.
2. On failure, do not abort with a bare Win32 code — either fall back to full access for that session, or surface an actionable message with the exact command needed to grant write access.

**Not included:** no logs, no conversation content, no file paths, no account details.

---

## 中文对照（给你看，不提交）

**标题**：工作区沙箱授权在「只继承到修改权限」的目录上失败

**环境**：Windows 10（19045）上的 DSH 桌面版；工作区在第二块盘的 NTFS 目录。

**现象**：工作区里第一条沙箱命令还没开始执行就失败：

```
Error: SetNamedSecurityInfoW failed (Win32 5): grantWrite(<工作区路径>)
```

**复现**

1. 在一个「只通过 Authenticated Users 继承了修改权限」的父目录下新建文件夹（用户目录被重定向后就是这个状态）。
2. 把它添加为 DSH 工作区，打开会话。
3. 执行任意命令。

**观察**

- 新建的文件夹上**没有当前用户自己的权限条目**；`icacls` 只显示 Administrators(F)、SYSTEM(F)、Authenticated Users(M)、Users(RX)。
- 「修改」权限不包含「改权限」和「改所有者」，所以写授权被拒绝。
- 目录归用户所有，所以「改权限」是隐式具备的；缺的应该是「改所有者」。
- **在工作区目录本身上**补一条可继承的完全控制后，下一次授权就能成功，DSH 随后会写入它每次运行自己的受限 SID 条目。

**请求**

1. 把权限条目加在**工作区目录本身**，而不是依赖从上级目录继承。
2. 失败时不要只抛一个 Win32 错误码——要么该会话降级为完全权限，要么给出可操作的提示和需要执行的命令。

**未包含**：日志、对话内容、文件路径、账号信息。

---

## 提交方式（待你选）

DSH 应用内的反馈入口是「把会话作为反馈提交」，会把对话内容一起发出去，**不符合你的要求**。

可选：

1. 你把它贴到 DSH 的反馈表单/邮件/issue（内容已脱敏）
2. 你告诉我一个非会话的提交地址，我直接发
3. 你授权我在应用里提交，但只贴上面这段文字（如果那个入口支持纯文本）
