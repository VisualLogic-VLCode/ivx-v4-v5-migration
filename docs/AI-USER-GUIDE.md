# 通过 AI Agent 使用 iVX V4→V5 工作流

本指南面向所有使用 Codex 或 Claude Code 的普通用户。安装、更新、平台访问、转换、验证、另存、运行时测试和受限修复都由本机 Agent 通过受管 `v4-to-v5-workflow` 完成；用户不需要逐条复制命令。

## 1. 首次安装

把[安装与初始化提示](templates/AI-AGENT-STARTER-PROMPT.md)整段交给本机 Agent。用户只在 Launcher 打开的可见原生安全输入框中输入自己的 Token，不要把 Token、Cookie 或 Authorization 内容发到聊天。

初始化完成后，Agent 应报告 Workflow、Converter、Knowledge 和 Agent 配置均已就绪。以后通常不需要重新安装；Agent 会在新 Job 前检查签名更新。Token 状态正常时也不会要求重复输入。

刚安装完成时可以在当前任务继续。若要同时验证 Codex/Claude Code 能否自动发现新安装的 Skill，重新打开一个全新任务再提交 `nid`。

## 2. 选择要完成的任务

### 只检查和转换，不创建 V5 案例

```text
请使用 v4-to-v5-workflow，检查并转换 nid <NID>，完成判版、权限预检、诊断和验证，但不要创建 V5 案例。
```

这类请求没有平台写入授权。转换通过时停在 `READY_TO_SAVE`。

### 转换并创建 V5 案例

```text
请使用 v4-to-v5-workflow，把 nid <NID> 转成 V5。
```

“转成 V5”已经授权当前任务中一次通过确定性门禁后的普通 Save As。Agent 不应再要求同一个 Job 的第二次普通另存确认；保存期间仍必须临时开启写入门禁，并在成功、失败或中断后恢复为 `disabled`。

如果源案例已经是 V5、版本不明确、当前用户无权限或当前平台条件不满足，工作流会安全停止，而不是强行调用 Converter 或另存。

个人案例与 Group 案例使用完全相同的判版、转换、诊断、验证、另存和运行时测试流程，用户通常只需提供 `nid`。只有用户明确知道且平台上下文确实需要时才同时提供 `gid`；Agent 不得猜测。Group 的实际读取和另存能力以平台权限预检结果为准。

### 转换后自动进行运行时测试和受限修复

```text
请使用 v4-to-v5-workflow，把 nid <NID> 转成 V5。创建成功后进行无副作用的 V4/V5 运行时对照；对工作流允许自动修复的高置信非转换器问题自动修复并复测。
```

这同时授权一个 WRITE Runtime Review 和初始修复预算。默认优先使用无人值守的 `READ_ONLY` Playwright 场景；需要登录时，Agent 会打开可见浏览器让用户完成登录，并且不会读取 Cookie 或浏览器认证文件。

只有工作流判定为高置信、修复目标为 V5 产物的 `SOURCE_DATA` / `TARGET_CASE` 问题才允许自动修复。`CONVERTER`、`PLATFORM_RUNTIME`、`KNOWLEDGE_GAP`、`AUTHORIZATION` 和 `UNKNOWN` 只报告，不自动修改。只有 `RUNTIME_PARITY_PASSED` 才表示运行时一致。

## 3. 需要单独确认的操作

下面这些操作不会从“转成 V5”或“自动测试并修复”中自动推导：

- 为带已知问题的指定 Job 创建诊断副本；
- 执行会造成业务副作用的运行时场景；
- 在初始预算之外增加每问题簇 `+2` 次尝试或整个 Review `+5` 个目标 revision；
- 接受用户手工修改后的目标 revision 作为新基线。

普通 Agent 不会修改 Converter。确定为 Converter 问题时，它会生成给维护者的诊断结论；用户可以另行决定是否创建编辑器可打开的已知问题诊断副本。

## 4. 继续已有任务

Agent 返回 `jobId` 或 `reviewId` 后应保留它。以后可以在同一任务或新任务中说：

```text
请使用 v4-to-v5-workflow，恢复并继续 Job <JOB_ID>。
```

```text
请使用 v4-to-v5-workflow，继续 Review <REVIEW_ID>。我手动定位到的问题是：<发现内容>。
```

手工发现会作为 Human Finding 加入既有 Review，它只是新证据，不会自动扩大写入或修复授权。

## 5. 常见结果

| 结果 | 含义 |
|---|---|
| `SUCCEEDED` | 已创建 V5 案例并完成平台回读验证 |
| `READY_TO_SAVE` | 转换和静态验证通过，但本次请求没有创建 V5 案例 |
| `SKIPPED_ALREADY_V5` | 源案例已经是 V5，没有调用 Converter |
| `DIAGNOSTIC_COPY_CREATED` | 创建了带已知问题的诊断副本，不代表转换正确 |
| `RUNTIME_PARITY_PASSED` | 声明式运行时对照已通过 |
| `RUNTIME_NOT_TESTED` | 没有稳定断言或运行条件，不能声称运行时一致 |
| 安全停止状态 | Agent 应说明权限、平台、版本、Converter 或未知问题以及下一步 |

Job 和 Review 默认保存在用户私有的 `~/.ivx-v4-v5/` 下，不写入用户当前项目。Agent 不应输出 Token、完整案例 JSON、业务公式、浏览器认证数据或用户绝对路径。

## 6. 维护者验收不是普通使用步骤

外部无保存测试、Group 普通参与者权限矩阵、运行时/自动修复实测、结果模板和发布验收属于维护者 QA，见[维护者外部验收索引](acceptance/README.md)。普通用户无需按验收阶段操作；安装完成后可以直接选择本指南中的任意任务。
