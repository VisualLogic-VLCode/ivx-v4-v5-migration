# iVX V4 → V5 用户快速入门

本工作流在用户本机运行，由 Codex 或 Claude Code 调用。它只会转换确认属于受支持 V4 格式的案例；已经是 V5、版本不明确或权限不足时会停止并给出原因。

## 推荐入口：从一开始交给 AI Agent

普通用户不需要先打开终端学习命令。首次使用时，把[AI Agent 安装与初始化提示](templates/AI-AGENT-STARTER-PROMPT.md)交给本机 Codex 或 Claude Code；这一步不填写 `nid`，只安装或更新 Launcher、初始化签名运行时、检查 Token 和 Agent Skill，然后停在就绪状态。

用户只需在 Launcher 打开的可见 macOS 原生安全输入框中输入自己的 Token；不要把 Token、Cookie 或 Authorization 内容发到聊天。Agent 不得使用后台 PTY、终端 `read` 或临时脚本代替该输入框。现有 Token 状态正常时不应要求用户重复输入。

首次安装成功后，可以直接对 Agent 说：

> 请使用 v4-to-v5-workflow，把 nid 12345678 转成 V5。

这句话已经授权一次通过确定性门禁后的普通 V5 另存。如果只想检查而不创建案例，应明确说“完成诊断和验证，但不要创建 V5 案例”。如果还要 Playwright 运行时对照和受限自动修复，可以在同一句中增加“创建成功后进行无副作用运行时对照，并自动修复工作流允许的高置信非转换器问题”。完整自然语言示例见[通过 AI Agent 使用工作流](AI-USER-GUIDE.md)。

下面的命令用于说明 Agent 实际执行的流程，也可作为故障排查时的人工参考；Agent-first 用户不需要逐条复制。

## 1. 命令行参考：安装

需要 Node.js 20 或更高版本。通过不可变 GitHub Release 安装稳定 Launcher：

```bash
npm install --global \
  https://github.com/VisualLogic-VLCode/ivx-v4-v5-migration/releases/download/v0.8.3/ivx-v4-v5-migration-0.8.3.tgz
```

## 2. 命令行参考：安全录入 Token 并初始化

macOS 上，Agent 先通知用户即将打开 iVX 原生安全输入框，然后执行并等待：

```bash
ivx-migrate setup --prompt-token
```

Launcher 会打开用户可见的隐藏答案对话框，将 Token 原子写入 `~/.ivx-v4-v5/secrets/platform-token`，并继续初始化。目录权限为 `0700`、文件权限为 `0600`；配置只记录路径。不要让 Agent 打开、打印、复制或分析该文件。Token 缺失或失效时重新执行同一命令即可安全替换，不需要手工编辑文件。

用户取消会返回 `TOKEN_PROMPT_CANCELLED`，原生输入框不可用会返回 `VISIBLE_TOKEN_PROMPT_UNAVAILABLE`；Agent 必须停止，不得回退到后台 PTY、聊天或明文参数。其他平台暂使用已安全配置的受支持 Token 来源；在 Windows ACL 契约明确前，不把 Unix `0600` 规则类比成不可靠的权限检查。

## 3. 初始化

上一步的 `setup --prompt-token` 已经同时完成初始化，无需再次执行 `setup`。

`setup` 会：

- 默认配置平台地址 `https://dev.ivx.cn`；
- 配置签名 Workflow/Converter 稳定通道；
- 安装当前 Workflow 和 Converter；
- 安装 Codex 与 Claude Code 的受管 Agent 配置；
- 只把 Token 文件的绝对路径写入私有配置，不写入 Token 内容。

高级用户可覆盖平台地址：

```bash
ivx-migrate setup \
  --prompt-token \
  --platform-base-url https://other-origin.example.com
```

已自行安全准备 Token 文件的高级用户仍可改用 `setup --token-file /absolute/path/to/platform-token`；两个 Token 选项不能同时使用。

## 4. 健康检查

```bash
ivx-migrate doctor
```

开始平台转换前，应确认输出至少满足：

```json
{
  "platformConfigured": true,
  "platformBaseUrl": "https://dev.ivx.cn",
  "tokenAvailable": true,
  "tokenSource": "file",
  "tokenError": null
}
```

`doctor` 会验证 Token 文件是否可安全读取，但绝不会输出 Token 内容。

## 5. 转换但不保存

个人案例与 Group 案例使用相同转换流程，通常只传 `nid`：

```bash
ivx-migrate platform preflight --nid 11064050
ivx-migrate migrate --nid 11064050
```

只有用户明确知道且平台上下文确实需要时，才同时传入可选的 `gid`；Agent 不得猜测：

```bash
ivx-migrate platform preflight --nid 12226286 --gid 25391
ivx-migrate migrate --nid 12226286 --gid 25391
```

不加 `--save` 时不会创建 V5 案例。常见结果：

- `READY_TO_SAVE`：判版、转换、诊断和验证通过，等待用户确认另存；
- `SKIPPED_ALREADY_V5`：源案例已经是 V5，没有调用转换器；
- `ISSUES_CLASSIFIED`：需要 Agent 判断问题归属；
- `BLOCKED_CONVERTER_DEFECT`：确认属于转换器问题，先停止并报告；工作流不修复转换器，但可在用户另行授权后创建带已知问题的诊断副本；
- `AI_REPAIR_REQUIRED`：源案例问题可由 AI 按策略修复，也可经用户另行授权创建诊断副本；
- `NEEDS_REVIEW`：包含未知或不可自动修复的问题，可人工审阅，也可经用户另行授权创建诊断副本；
- `AUTH_FAILED` / `SOURCE_PERMISSION_DENIED`：Token 无效或当前用户没有读取权限。

查看 Job：

```bash
ivx-migrate job list
ivx-migrate job status --job <jobId>
```

Job 默认位于 `~/.ivx-v4-v5/jobs/`，不放在当前项目目录。Token 内容不会写入 Job、转换诊断或 AI 分析文件。

## 6. 审核后另存 V5

只有 Job 已到达 `READY_TO_SAVE`，且当前任务包含普通另存授权时，才临时打开写入门禁。用户最初明确要求“转成/创建 V5”已经构成该 Job 的普通另存授权；只要求检查、测试或诊断的 Job 则需用户后来单独授权。

```bash
ivx-migrate config write-mode \
  --mode explicit \
  --confirm ENABLE_LIVE_WRITES
```

然后执行：

```bash
ivx-migrate job resume-save \
  --job <jobId> \
  --confirm-live-write SAVE_V5
```

无论命令成功、失败还是被中断，完成本次操作后都必须立即关闭写入门禁：

```bash
ivx-migrate config write-mode --mode disabled
```

不要在两个 Job 之间保持 `explicit`。只有 CLI 完成保存后读回验证并返回 `SUCCEEDED`，才算转换成功。网络结果不明确时不要重新创建；应保留同一 Job，按它的可恢复状态继续。

若命令返回目标 nid，再进行一次只读判版：

```bash
ivx-migrate migrate --nid <targetNid>
```

预期为 `SKIPPED_ALREADY_V5`。目标列表元数据可能为兼容旧链路继续显示 `edtVer: 4.1`；不得只凭这一字段判定为 V4。工作流会结合 `metadata.extra.ver` 与实际 JSON 中的 V5 AST/V4 结构信号进行判断。

## 7. 存在已知问题时创建诊断副本

如果 Agent 已经完成问题归属，用户可以选择先在编辑器里打开转换结果定位问题：

- `CONVERTER`：通常停在 `BLOCKED_CONVERTER_DEFECT`；转换器不会在工作流中修复；
- `SOURCE`：通常停在 `AI_REPAIR_REQUIRED`，用户可选择先由 AI 修复，也可先创建诊断副本；
- `UNKNOWN`：通常停在 `NEEDS_REVIEW`，可以保留未知风险创建诊断副本；
- `PLATFORM`、`AUTHORIZATION`：分类本身不禁止诊断副本，但当前另存所需的平台、认证和真实服务器权限必须已经恢复，不能靠确认文字绕过。

对这个具体 Job 再次明确授权：

```bash
ivx-migrate job resume-diagnostic-save \
  --job <jobId> \
  --confirm-live-write SAVE_V5_WITH_KNOWN_ISSUES
```

该命令仍要求 `platform.writeMode` 为 `explicit`，仍会重新检查当前用户的另存权限、源案例版本是否变化，并在保存后读回验证。所有受支持的问题分类都可独立评估；若问题涉及平台或授权，只有当前写入硬前提实际恢复后才能继续。

完成时状态是 `DIAGNOSTIC_COPY_CREATED`，返回的 `target.nid` 可用于打开新案例。这个状态只证明“平台上的诊断副本与本地转换产物一致”，不证明转换语义正确，也不能汇报为转换成功。Job 中会保留各问题归属数量、`reports/diagnostic-save-authorization.json` 和带诊断意图的保存日志。问题修复后，应重新转换源案例获得正式结果。

诊断副本命令完成、失败或中断后，同样必须立即把 `platform.writeMode` 恢复为 `"disabled"`。如返回目标 nid，也可按上一节执行只读判版；`SKIPPED_ALREADY_V5` 只确认目标格式是 V5，不会消除已知问题，也不会把 `DIAGNOSTIC_COPY_CREATED` 提升为正常成功。

普通 `resume-save ... SAVE_V5` 不能绕过 `BLOCKED_CONVERTER_DEFECT`；诊断命令也不能用于普通 `READY_TO_SAVE` Job。

## 8. 对已创建目标进行运行时对照和受限修复

当用户要求“自动测试并修复”，受管 Agent 会在同一 Job 的 V5 目标上建立独立 Review；Migration Job 的终态不会被重写：

```bash
ivx-migrate review create-platform \
  --job <jobId> \
  --capability WRITE

ivx-migrate review environment-check --review <reviewId>
ivx-migrate review scenario-add --review <reviewId> --file <scenario.json>
ivx-migrate review runtime-run-platform \
  --review <reviewId> \
  --scenario <scenarioId> \
  --environment-id <comparisonId>
```

Agent protocol 9 默认使用 Agent Native 测试。Workflow 只返回当前 V4/V5 地址与 workId/origin、完整 Job 根目录、Agent 私有工作区和环境差异提示；它不创建测试授权、Session、过期时间、revision/origin lease、浏览器驱动、动作规划器、认证规则或副作用范围。Agent 依据用户要求和自身安全政策自主选择浏览器、Playwright/CDP、JavaScript、CSS/XPath、循环、动态点击、截图/像素比较、业务动作与重试：

```bash
ivx-migrate review agent-native-handoff-platform --review <reviewId>
# Agent 在返回的 workspace 中自主测试并生成 observation bundle
ivx-migrate review agent-native-submit --review <reviewId> --file <agent-native-observation-bundle.json>
```

Agent 可复用当前会话、浏览器状态、缓存和用户直接提供的运行时认证信息，但必须遵循所在 Agent 的安全规则；Workflow 不接收这些值，观察包、证据、文件与输出中也不得包含 Token、Cookie、session 或浏览器存储内容。工具切换、初始化时机、页面就绪等待和重试均由 Agent 自主决定。

提交结果只能是 `OBSERVED_EQUIVALENT`、`OBSERVED_MISMATCH` 或 `INCONCLUSIVE`，不是严格 parity。两端实际 revision/origin、环境差异和发生过的副作用都作为事实记录，不用于阻止测试。用户要求复测时直接生成带 `previousRunId` 的新 run；修复后的复测还要带 `REPAIR_REGRESSION` 与 `repairBatchId`。Agent Native 是当前唯一的运行时测试接口。

另存成功后平台可能只推进源案例的 `workId`。`create-platform` 会在创建 Review 前读取当前完整源 JSON，并与 Job 中不可变的转换输入做规范化摘要比较；内容完全相同时，自动把 Review 固定到新 revision 并留下私有审计记录。对于 Workflow 0.5.1 已创建但尚未产生环境证据的 Review，首次 `environment-check` 会执行相同协调。若内容确实变化，则返回 `REVIEW_SOURCE_CONTENT_CHANGED` 并保留已有 V5；不要重新迁移或再次 Save As。已有环境或运行时证据后不会自动改写 source baseline。

Workflow 0.7.2 起，普通另存、Additional V5 和诊断副本都会在创建目标后执行同一个域名配置检查点：从 revision-pinned V4 settings 继承 `domain`、`customDomain`、`previewDomain`，同时保留平台为新 V5 生成的 `path`、`previewPath`、`pubRoot`、`preRoot`。因此不会让 V4/V5 共用发布路径，也不会覆盖 V5 的唯一预览地址。写入前后都要读取目标设置并精确对账；响应丢失时只允许以读回结果确认，结果不一致会进入 `DOMAIN_ROUTING_RECONCILIATION_REQUIRED`，不得重复另存、重放 `/work/modify` 或由 Agent 手工修改配置。已经由旧版 Workflow 开始最终保存的历史 journal 只记录 `LEGACY_SKIPPED` 并按旧语义恢复，避免升级后在恢复途中插入新平台写入。

Workflow 0.7.3 修复平台默认值省略导致的误报：当平台没有返回默认的 `pubRoot:false` / `preRoot:false` 时，根据对应非根路径推断为 `false`；根路径的 `""` 与 `"/"` 也按同一语义比较。域名、预览域名、非根路径、`customDomain` 或互相矛盾的显式根标志仍必须一致，否则继续安全阻断。错误报告只列出不一致字段名，不保存或显示实际域名、路径值。已有 `SAVE_INCOMPLETE` Job 会先读回确认；状态已经等价时不重复创建目标或重放域名路由写入。

Workflow 0.7.4 修复旧 Job 创建 Runtime Review 时缺少 Workflow SHA-256 的兼容缺口。只有已安装的精确 Workflow 版本、包名和摘要证据一致时，才把真实摘要派生到新 Review；缺失、无效或互相矛盾的证据会在访问平台前安全停止，不修改旧 Job。新建 Job 会直接持久化完整的 Workflow 版本、包名和摘要，避免升级后再次丢失谱系。

Workflow 0.8.0–0.8.3 曾引入并逐步完善 Agent Direct。Workflow 0.9.0 将普通运行时测试移出 Workflow 控制面，改为 Agent Native handoff + observation bundle + Agent/LLM diagnosis。Workflow 0.10.0 从当前运行时中删除 Agent Direct 命令、Schema 和兼容读取；重新安装后的测试只使用 Agent Native。Protocol-8 Exploration/Scenario 仍作为独立的声明式历史能力保留。

Workflow 会对 V4/V5 的配置、设置、域名、路由和绑定做脱敏环境比较。Agent Native 把差异作为提示与诊断置信度输入，不再因此阻止浏览器测试；受管 V5 修复仍要求满足独立的环境、CAS 和权限门禁。`/config/name` 按 `IGNORE_FOR_PARITY` 处理，其他未知字段如实保留。预览 URL 来自平台当前元数据，不需要用户手填。

仅当用户明确要求运行旧版声明式 Runtime Scenario 时，若无法消除环境差异，才使用最长 8 小时的 `ACCEPT_ENVIRONMENT_RISK` 兼容流程：

```bash
ivx-migrate review runtime-run-platform \
  --review <reviewId> \
  --scenario <scenarioId> \
  --environment-id <comparisonId> \
  --environment-risk-acceptance-file <USER-acceptance.json>
```

这条路径只允许诊断运行。Environment Comparison 仍保留 `REQUIRES_USER_BINDING` / `BLOCKED_ENVIRONMENT`；结果只能是风险下通过、不一致或不确定，不能声称严格等价、不能进入 Converter 归因或自动修复。认证、平台/revision 安全、场景副作用授权和所有写入门禁仍独立生效。修复后的正式复测不接受该风险文件，必须先恢复环境等价。

平台场景的首个 `OPEN_PAGE` 使用 `"input": "$SUBJECT_URL"`，表示分别打开当前 V4 与 V5 的完整、revision-pinned 预览 URL。只有确实要访问同源固定路径时才填写 `/path`；不要用 `/` 代替案例预览地址。

旧 Runtime Scenario 仍使用 Workflow 锁定的 Chromium、隔离认证文件和原有副作用授权。Agent Native 不继承这些执行限制，由本地 Agent 根据用户要求和宿主安全策略管理浏览器与认证。

出现差异后，Agent 只能依据本 Review 的脱敏证据和锁定 Knowledge 卡片提交完整分类。`CONVERTER`、平台、环境、测试工具、`FLAKY_RUNTIME`、知识缺口、认证和未知根因停止自动修改并生成报告；只有 CLI 判定为高置信 `SOURCE_DATA` / `TARGET_CASE` 且修复目标为 `V5_ARTIFACT` 的问题簇可以进入自动修复。

初始授权最多允许每个问题簇 3 次本地 Repair Attempt，以及整个 Review 最多 10 个已读回确认的目标 revision。额外 `+2` 次尝试和 `+5` 个 revision 必须再次获得用户授权。重复 Patch、A→B→A 振荡、范围持续扩大、新高严重度问题、目标被外部修改或写入结果未知都会停止。每次目标更新都要先做 revision CAS、静态全量验证，再通过写后读回确认；未知写入结果只能对账，不能重放。

修复后必须提交关联原 Native run 与 Repair Batch 的 `REPAIR_REGRESSION` 观察。`OBSERVED_EQUIVALENT` 只代表 Agent 实际覆盖内观察一致，不能升级为严格 parity；差异、不确定或波动继续进入诊断或安全停止。用户后续手动定位的信息通过 `review finding-add` 追加到同一 Review，它是证据而不是新的写入授权。

## 9. 更新和回滚

```bash
ivx-migrate update check
ivx-migrate update apply
ivx-migrate update apply --kind converter
ivx-migrate rollback --kind workflow
ivx-migrate rollback --kind converter
```

工作流和转换器独立发布。转换器问题必须等待维护者发布新 Converter；普通用户和 Agent 不应修改已安装 Converter。

若旧版运行时在更新 Workflow 时返回 `RUNTIME_DOWNLOAD_FAILED`，Agent 可执行一次受限恢复，不需要用户重新输入 Token：先从上面的不可变 `0.8.3` Release 重新安装 Launcher，再执行 `ivx-migrate setup --force --launcher-recovery RECOVER_SIGNED_RUNTIME`。协调式 setup 会保留现有 Token 路径，并一次补齐 Workflow、Converter、Knowledge 和 Agent 配置；不要只更新 Workflow，因为旧环境可能尚未安装所需 Knowledge Runtime。该确认只允许新版或同版 Launcher 接管 setup/update/rollback/Agent 同步，旧 Launcher 不能借此覆盖更高版本。成功后恢复正常的 `update apply` 流程。

维护者首次在其他用户电脑上验证公开安装、普通参与者权限与默认不保存边界时，才使用单独的[验收专用 Agent 提示](templates/AI-AGENT-ACCEPTANCE-PROMPT.md)和[外部普通用户验收清单](EXTERNAL-USER-ACCEPTANCE.md)。该流程不是普通用户快速入门；它的第一阶段故意禁止保存，并使用独立的[无保存结果模板](templates/EXTERNAL-USER-ACCEPTANCE-RESULT.md)和[另存结果模板](templates/EXTERNAL-USER-SAVE-AS-RESULT.md)。

## 10. 常见 Token 文件错误

| 错误码 | 处理方式 |
|---|---|
| `TOKEN_FILE_NOT_FOUND` | 检查配置中的绝对路径，重新执行 `setup --token-file ...` |
| `TOKEN_FILE_PERMISSIONS_INVALID` | 在 macOS/Linux 执行 `chmod 600 <file>` |
| `TOKEN_FILE_SYMLINK_FORBIDDEN` | 改用真实普通文件，不使用符号链接 |
| `TOKEN_FILE_CONTENT_INVALID` | 文件只保留一个裸 Token，可有一个末尾换行 |
| `PLATFORM_TOKEN_REQUIRED` | 配置安全 Token 文件，或临时设置 `IVX_MIGRATION_TOKEN` |
| `TOKEN_PROMPT_CANCELLED` | 用户已取消；停止并在用户准备好后重新执行 `setup --prompt-token` |
| `VISIBLE_TOKEN_PROMPT_UNAVAILABLE` | 当前系统或图形界面不支持内置输入框；停止，不要降级到后台 PTY 或聊天输入 |

普通用户的完整 AI 用法见 [AI-USER-GUIDE.md](AI-USER-GUIDE.md)。需要更完整的安全、恢复、维护者外部验收和发布说明，请参阅 [PLATFORM-INTEGRATION.md](PLATFORM-INTEGRATION.md)、[EXTERNAL-USER-ACCEPTANCE.md](EXTERNAL-USER-ACCEPTANCE.md) 和 [RELEASING.md](RELEASING.md)。
