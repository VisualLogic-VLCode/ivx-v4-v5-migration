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

若请求只到“转成 V5”且未提运行时测试，Agent 会询问一次是否在另存后继续测试；若用户已经要求测试、诊断或自动修复，则不重复询问，直接进入 Agent Native。

如果源案例已经是 V5、版本不明确、当前用户无权限或当前平台条件不满足，工作流会安全停止，而不是强行调用 Converter 或另存。

个人案例与 Group 案例使用完全相同的判版、转换、诊断、验证、另存和运行时测试流程，用户通常只需提供 `nid`。只有用户明确知道且平台上下文确实需要时才同时提供 `gid`；Agent 不得猜测。Group 的实际读取和另存能力以平台权限预检结果为准。

下面的 Additional V5 与 Existing Target Refresh 需要 Workflow `0.6.0`、Agent protocol 7 以及兼容的 Knowledge Runtime。旧运行时必须先通过签名更新完成整组兼容检查，不能只照抄新命令。

### 明确再创建一个独立 V5

```text
请使用 v4-to-v5-workflow，用当前 nid <NID> 再创建一个独立的 V5 案例；这是 Additional V5 Creation，不是继续或重试之前的 Job。
```

Agent 会创建带 `CREATE_ADDITIONAL_V5` 意图的新 Job，并执行一条新的普通 Save As 链；新旧 V5、Job 和 Review 都保留。只有用户明确表达“再创建一个”时才允许这样做。失败后的“继续、重试、恢复”只处理原 Job，绝不会暗中创建第二个 nid。

### 用当前 V4 内容刷新已有 V5

```text
请使用 v4-to-v5-workflow，用当前 V4 nid <SOURCE_NID> 的内容刷新已有 V5 nid <TARGET_NID>，保留目标 nid 和目标配置。先准备并向我汇报计划，等我确认后再写入。
```

Agent 先执行只读 Refresh prepare：证明该目标来自相同源案例的受管迁移历史，独立检查目标编辑权限，确认源仍是 V4、目标仍是 V5，并固定当前 revision、内容、目标配置摘要、转换候选、诊断和到期时间。目标域名、settings、路由、环境绑定与配置值默认保留，不会从源案例复制，私有 Refresh 产物中也不保存这些配置值。

用户确认的是这一份精确计划，而不是长期写权限。写入前 Workflow 会再次核对 runtime、权限、源/目标内容和配置摘要；任何变化都会让计划失效。响应不确定时只允许对账，不能自动重放。确认成功后旧写 Review 变为只读 `REVIEW_SUPERSEDED_BY_REFRESH`，新 Review 从 Environment Gate 重新开始，不继承旧 parity、修复预算或授权。

### 转换后自动进行运行时测试和受限修复

```text
请使用 v4-to-v5-workflow，把 nid <NID> 转成 V5；创建成功后由你自主完成 V4/V5 运行时测试，并对 Workflow 允许的高置信非转换器问题自动修复和复测，直至通过或命中安全停止条件。
```

这句话同时授权创建 WRITE Review 和初始修复预算。测试默认使用 `AGENT_NATIVE`：Workflow 只交付当前 V4/V5 地址、Job 文件根目录和环境差异，不创建测试授权或 Session，也不限制 Agent 选择浏览器、Playwright、脚本、会话、重试或测试动作；具体操作仍受用户要求和本机 Agent 自身安全规则约束。

这句话本身不授权真实业务数据写入。如果还希望测试保存、提交、审核等有副作用流程，可同时补充一句：“我明确授权你在本机 Agent 安全政策允许的范围内自主执行有副作用业务测试，并验证写入后的业务结果。”Agent 只确认一次范围；之后无需逐动作询问。授权不会允许支付、真实通知、不可逆删除或其他被 Agent 宿主安全政策禁止的操作。

Agent 不会把“首屏截图一致”直接当作测试完成。它会结合 V4/V5 JSON 与运行时证据建立页面、跳转、交互、服务、角色、状态、数据条件、异常分支和写入后置条件清单，把每项映射到自主归纳的候选流程，或明确记录排除/延期原因。流程数量、拆分方式、测试工具和顺序都由 Agent 决定，不由 Workflow 固定。

只读流程应继续深入；未授权写入时只能测试到 `PRE_SUBMIT`，不能据此证明保存后的业务闭环。授权后 Agent 会自主执行范围内的写流程，并对请求/响应、持久化回读、页面及业务状态、后续动作、权限和可观察外部影响进行适当对照。阻塞流程必须记录原因和安全解除尝试；发现一个差异后，Agent通常继续其他独立安全路径以判断影响范围。

Agent 同时提交“观察结果”和“覆盖状态”。`OBSERVED_EQUIVALENT` 可表示已执行流程一致，但覆盖仍可能是 `PARTIAL`；`OBSERVED_MISMATCH` 表示已执行流程存在差异；`INCONCLUSIVE` 表示已执行观察本身无法判断。覆盖状态另分 `COMPLETE`、`PARTIAL`、`BLOCKED`，只有 `OBSERVED_EQUIVALENT + COMPLETE` 才能报告整案观察等价，仍不是严格 parity。发现差异后由当前 Agent/LLM 分类；只有高置信 `SOURCE_DATA` / `TARGET_CASE` 且目标为 `V5_ARTIFACT` 时，Workflow 才允许受管修复与复测。

如果 Save As 后平台只推进了源案例 revision，而完整源 JSON 与本次转换输入一致，Workflow 会在创建 Review 或首次环境检查时自动协调并记录审计证据，不需要再迁移或再创建一个 V5。若源内容确实变化，工作流会保留已创建的 V5 并以 `REVIEW_SOURCE_CONTENT_CHANGED` 停止；用户应审阅源变化，不能通过重复 Save As 绕过。

环境差异会被如实告知，并影响诊断置信度及能否执行受管修复，但不会阻止 Agent Native 测试。用户可继续补充手工定位结果，Agent 会把它作为 Human Finding 接入同一 Review。

## 3. 需要单独确认的操作

下面这些操作不会从“转成 V5”或“自动测试并修复”中自动推导：

- 为带已知问题的指定 Job 创建诊断副本；
- 超出当前用户请求范围的业务副作用操作；Workflow 不提供独立测试授权替代用户与 Agent 的确认；
- 在初始预算之外增加每问题簇 `+2` 次尝试或整个 Review `+5` 个目标 revision；
- 接受用户手工修改后的目标 revision 作为新基线。
- 应用一份精确的 Existing Target Refresh 计划；该授权不能复用普通 Save As 或局部 Repair 授权。

普通 Agent 不会修改 Converter。确定为 Converter 问题时，它会生成给维护者的诊断结论；用户可以另行决定是否创建编辑器可打开的已知问题诊断副本。

## 4. 继续已有任务

Agent 返回 `jobId`、`refreshId` 或 `reviewId` 后应保留它。以后可以在同一任务或新任务中说：

```text
请使用 v4-to-v5-workflow，恢复并继续 Job <JOB_ID>。
```

```text
请使用 v4-to-v5-workflow，继续 Review <REVIEW_ID>。我手动定位到的问题是：<发现内容>。
```

```text
请使用 v4-to-v5-workflow，检查并继续 Refresh <REFRESH_ID>；若写入结果未知，只做 reconcile，不要重放 apply。
```

手工发现会作为 Human Finding 加入既有 Review，它只是新证据，不会自动扩大写入或修复授权。

## 5. 常见结果

| 结果 | 含义 |
|---|---|
| `SUCCEEDED` | 已创建 V5 案例并完成平台回读验证 |
| `READY_TO_SAVE` | 转换和静态验证通过，但本次请求没有创建 V5 案例 |
| `SKIPPED_ALREADY_V5` | 源案例已经是 V5，没有调用 Converter |
| `DIAGNOSTIC_COPY_CREATED` | 创建了带已知问题的诊断副本，不代表转换正确 |
| `TARGET_REFRESHED` | 已用当前 V4 内容更新既有 V5 nid，完成候选读回与 Review 继任 |
| `REVIEW_SUPERSEDED_BY_REFRESH` | 旧 Review 作为只读证据保留，写权限已移交到刷新后的新 Review |
| `REFRESH_PLAN_STALE` | 源、目标、配置、权限或 runtime 与授权计划不再一致；必须重新 prepare |
| `REFRESH_OUTCOME_UNKNOWN` | 只读对账仍显示旧基线，但写入结果不能安全证明；不能重放旧授权 |
| `OBSERVED_EQUIVALENT` | Agent Native 在实际覆盖中观察到 V4/V5 一致；不是 Workflow 严格 parity |
| `OBSERVED_MISMATCH` | Agent Native 观察到差异并提交脱敏证据；由当前 Agent/LLM 继续归因 |
| `INCONCLUSIVE` | Agent Native 暂时无法得到确定结论，可直接调整策略并创建关联复测 run |
| `COMPLETE` | 已发现业务面全部对账且无剩余覆盖缺口；与观察结果组合解读 |
| `PARTIAL` | 已得到部分运行时观察，但仍有阻塞、延期、未知或未验证的写入后置条件 |
| `BLOCKED` | 尚未获得足以覆盖任何业务单元的可比较观察 |
| `RUNTIME_PARITY_PASSED` | 声明式运行时对照已通过 |
| `RUNTIME_PARITY_PASSED_WITH_USER_DECLARED_ENVIRONMENT` | 用户已声明列出的目标绑定在业务语义上等价，运行时对照通过 |
| `DIAGNOSTIC_RUNTIME_PASSED_WITH_ENVIRONMENT_RISK` | 在用户接受的未解决环境风险下，所选断言通过；不代表严格运行时等价 |
| `MISMATCH_UNDER_ENVIRONMENT_RISK` | 在未解决环境风险下观察到差异；不能据此归因 Converter 或自动修复 |
| `DIAGNOSTIC_RUNTIME_INCONCLUSIVE_WITH_ENVIRONMENT_RISK` | 风险诊断运行未得到确定结果 |
| `RUNTIME_NOT_TESTED` | 没有稳定断言或运行条件，不能声称运行时一致 |
| 安全停止状态 | Agent 应说明权限、平台、版本、Converter 或未知问题以及下一步 |

Job 和 Review 默认保存在用户私有的 `~/.ivx-v4-v5/` 下，不写入用户当前项目。Agent 不应输出 Token、完整案例 JSON、业务公式、浏览器认证数据或用户绝对路径。

## 6. 维护者验收不是普通使用步骤

外部无保存测试、Group 普通参与者权限矩阵、运行时/自动修复实测、结果模板和发布验收属于维护者 QA，见[维护者外部验收索引](acceptance/README.md)。普通用户无需按验收阶段操作；安装完成后可以直接选择本指南中的任意任务。
