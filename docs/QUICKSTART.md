# iVX V4 → V5 用户快速入门

本工作流在用户本机运行，由 Codex 或 Claude Code 调用。它只会转换确认属于受支持 V4 格式的案例；已经是 V5、版本不明确或权限不足时会停止并给出原因。

## 推荐入口：从一开始交给 AI Agent

普通用户不需要先打开终端学习命令。把[AI Agent 首次安装与验收提示](templates/AI-AGENT-ACCEPTANCE-PROMPT.md)交给本机 Codex 或 Claude Code，并填写要处理的 `nid`。Agent 会自行安装 Launcher、初始化签名运行时、检查更新、完成权限预检与转换，再按受管 `v4-to-v5-workflow` Skill 进行诊断和验证。

用户只需在 Launcher 打开的可见 macOS 原生安全输入框中输入自己的 Token；不要把 Token、Cookie 或 Authorization 内容发到聊天。Agent 不得使用后台 PTY、终端 `read` 或临时脚本代替该输入框。第一阶段默认不保存，Agent 在没有获得具体 Job 的另存授权时不会创建 V5 案例。

首次安装成功后，可以直接对 Agent 说：

> 请使用 v4-to-v5-workflow，把 nid 12345678 转成 V5。先完成判版、权限预检、转换、诊断和验证；没有我针对具体 Job 的另存授权时不要创建 V5 案例。

下面的命令用于说明 Agent 实际执行的流程，也可作为故障排查时的人工参考；Agent-first 用户不需要逐条复制。

## 1. 命令行参考：安装

需要 Node.js 20 或更高版本。通过不可变 GitHub Release 安装稳定 Launcher：

```bash
npm install --global \
  https://github.com/VisualLogic-VLCode/ivx-v4-v5-migration/releases/download/v0.4.0/ivx-v4-v5-migration-0.4.0.tgz
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

个人案例只传 `nid`：

```bash
ivx-migrate platform preflight --nid 11064050
ivx-migrate migrate --nid 11064050
```

明确属于某个 Group 时可同时传 `gid`：

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

只有 Job 已到达 `READY_TO_SAVE`，且用户对这个具体 Job 明确授权创建新案例时，才临时打开写入门禁：

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

Workflow 会先对 V4/V5 的配置、设置、域名、路由和绑定做脱敏环境比较。只有 `ENVIRONMENT_EQUIVALENT` 或 `NORMALIZED_EQUIVALENT` 才开始浏览器对照；需用户绑定或环境阻塞时不会把差异归因给 Converter。预览 URL 来自平台当前元数据并与源/目标 `workId` 复核，不需要用户手填。

首次浏览器对照可能需要安装与 Workflow 锁定的 Chromium。登录必须由用户在可见浏览器完成，V4/V5 不同预览源使用彼此隔离的私有认证文件；Agent 不读取 Cookie 或 storage state。`READ_ONLY` 场景可无人值守，带副作用场景另行授权。

出现差异后，Agent 只能依据本 Review 的脱敏证据和锁定 Knowledge 卡片提交完整分类。`CONVERTER`、平台运行时、知识缺口、认证和未知根因停止自动修改并生成报告；只有 CLI 判定为高置信 `SOURCE_DATA` / `TARGET_CASE` 且修复目标为 `V5_ARTIFACT` 的问题簇可以进入自动修复。

初始授权最多允许每个问题簇 3 次本地 Repair Attempt，以及整个 Review 最多 10 个已读回确认的目标 revision。额外 `+2` 次尝试和 `+5` 个 revision 必须再次获得用户授权。重复 Patch、A→B→A 振荡、范围持续扩大、新高严重度问题、目标被外部修改或写入结果未知都会停止。每次目标更新都要先做 revision CAS、静态全量验证，再通过写后读回确认；未知写入结果只能对账，不能重放。

修复后必须重新检查环境并复测原场景及受影响场景。只有 Review 到达 `RUNTIME_PARITY_PASSED` 才能汇报运行时一致；没有稳定断言时只能汇报 `RUNTIME_NOT_TESTED`。用户后续手动定位出的信息通过 `review finding-add` 追加到同一个 Review，它是证据而不是新的写入授权。

## 9. 更新和回滚

```bash
ivx-migrate update check
ivx-migrate update apply
ivx-migrate update apply --kind converter
ivx-migrate rollback --kind workflow
ivx-migrate rollback --kind converter
```

工作流和转换器独立发布。转换器问题必须等待维护者发布新 Converter；普通用户和 Agent 不应修改已安装 Converter。

首次在维护者电脑之外验证公开安装、普通参与者权限与默认不保存边界时，先把 [Agent 启动提示](templates/AI-AGENT-ACCEPTANCE-PROMPT.md)交给测试用户，再严格按[外部普通用户验收清单](EXTERNAL-USER-ACCEPTANCE.md)核对 Agent 的执行结果，并为每个案例提交一份脱敏的[第一阶段结果模板](templates/EXTERNAL-USER-ACCEPTANCE-RESULT.md)。外部验收第一阶段禁止创建或保存 V5 案例；维护者另行指定具体 Job 并授权后，第二阶段使用独立的[另存结果模板](templates/EXTERNAL-USER-SAVE-AS-RESULT.md)。

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

需要更完整的安全、恢复、外部验收和发布说明，请参阅 [PLATFORM-INTEGRATION.md](PLATFORM-INTEGRATION.md)、[EXTERNAL-USER-ACCEPTANCE.md](EXTERNAL-USER-ACCEPTANCE.md) 和 [RELEASING.md](RELEASING.md)。
