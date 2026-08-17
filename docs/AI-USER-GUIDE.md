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
请使用 v4-to-v5-workflow，把 nid <NID> 转成 V5。创建成功后进行无副作用的 V4/V5 运行时对照；对工作流允许自动修复的高置信非转换器问题自动修复并复测。
```

这同时授权一个 WRITE Runtime Review 和初始修复预算，但运行时测试仍需要一次精确的 Agent Direct 只读授权。Workflow 会先完成 Environment Gate，并展示当前 Review/Job、源/目标 revision 与预览 origin、完整 Job 读取范围、到期时间、本地认证使用规则，以及“不产生副作用、不修改 V5、不执行平台写入”的边界；用户确认后才把测试上下文交给 Agent。

若希望 Agent 在一次确认后自主遍历无副作用路径，可明确说：

```text
请在 Review <REVIEW_ID> 上进行 Agent Direct 无副作用运行时测试。先向我展示精确授权范围；我确认后，你可以读取该 Job 的全部文件，并用你自己的浏览器和测试工具自主规划、编写脚本、执行和判断，不需要逐个点击询问，但不得产生业务副作用、修改 V5 或执行任何平台写入。
```

Workflow 不提供浏览器驱动、爬虫、动作规划器、就绪判断或测试程序。确认后，Agent 可以读取命令返回的精确 Job 根目录，包括原始 V4 JSON、转换后 V5 JSON、验证与诊断，并直接使用自己的浏览器工具、JavaScript、语义定位、CSS/XPath、循环、动态点击/填写、网络与控制台观察、截图/像素比较和业务状态断言。Agent 优先使用本机已有授权会话。当返回的 Context 声明 `credentialPolicy.userDirectInput: EPHEMERAL_BROWSER_USE_ALLOWED` 与 `agentToolTransport: MINIMUM_BROWSER_OPERATION_ONLY` 时，若用户在当前任务中明确直接输入只供当前受权 V4/V5 预览页使用的 Token/Cookie/session，Agent 可以在一次最小浏览器认证调用中临时使用，包括加载前初始化浏览器存储；这是唯一允许包含该值的 Agent 工具传输。Workflow 不接收该值，Agent 不得重复、回显、跨任务复用，或把它写入 shell/CLI 参数、环境变量、独立或落盘脚本、文件、截图、报告、证据与证明。测试记录只能说明认证初始化是否成功。

在 `AGENT_DIRECT_READ_ONLY` 下，没有 Workflow 驱动代替 Agent 阻止操作，因此 Agent 自己负责避免提交、保存、创建、更新、删除、支付、发布、上传、发送消息或调用变更接口；无法安全继续时停止该路径。测试结论只能是 Agent 证明的“观察到一致”“观察到差异”或“无法确定”，不是 Workflow 验证的严格 Runtime Parity。Agent 把脱敏证据放在私有工作区，Workflow 在归档前复核 Job、revision、环境、授权与证据哈希。

若 Agent 观察到差异，它会先形成证据和问题归属。直接测试证明本身不等于修复授权，也不会直接提升旧 Review parity；进入诊断/自动修复前仍需走既有的闭合分类、允许修复原因、初始预算、静态全量验证、目标 CAS、写后回读和复测门禁。`AGENT_DIRECT_SIDE_EFFECT` 已在协议中预留独立范围，但 Workflow 0.8.1 尚未开放；普通测试授权不能模拟或绕过它。

如果 Save As 后平台只推进了源案例 revision，而完整源 JSON 与本次转换输入一致，Workflow 会在创建 Review 或首次环境检查时自动协调并记录审计证据，不需要再迁移或再创建一个 V5。若源内容确实变化，工作流会保留已创建的 V5 并以 `REVIEW_SOURCE_CONTENT_CHANGED` 停止；用户应审阅源变化，不能通过重复 Save As 绕过。

只有工作流判定为高置信、修复目标为 V5 产物的 `SOURCE_DATA` / `TARGET_CASE` 问题才允许自动修复。`CONVERTER`、`PLATFORM_RUNTIME`、`KNOWLEDGE_GAP`、`AUTHORIZATION` 和 `UNKNOWN` 只报告，不自动修改。环境严格或经用户声明语义等价时，运行结果才能作为归因和修复证据。

如果环境检查仍有差异，默认会停止浏览器。用户可以先解决绑定并声明其业务语义等价；也可以在 Agent 列出全部未解决路径和将要执行的场景后，明确接受这些差异带来的风险，仅继续一次有时限、精确范围的诊断运行。后者不会把环境改写为“等价”，不会归因 Converter，也不会自动修复目标；它只是帮助用户打开运行态继续观察。

## 3. 需要单独确认的操作

下面这些操作不会从“转成 V5”或“自动测试并修复”中自动推导：

- 为带已知问题的指定 Job 创建诊断副本；
- 在仍有环境差异时，仅为已列出的 revision、字段路径和运行场景接受诊断运行风险；
- 执行会造成业务副作用的运行时测试（Workflow 0.8.1 尚未开放 Agent Direct Side Effect）；
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
| `AGENT_ATTESTED_PARITY_OBSERVED` | 本地 Agent 在已声明覆盖中观察到 V4/V5 一致；不是 Workflow 严格 parity |
| `AGENT_ATTESTED_MISMATCH` | 本地 Agent 观察到差异并提交了脱敏证据；尚未自动等同于 Converter 缺陷或修复授权 |
| `AGENT_ATTESTED_INCONCLUSIVE` | Agent 无法在当前授权、环境或运行条件下得出确定结论 |
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
