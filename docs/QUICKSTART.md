# iVX V4 → V5 用户快速入门

本工作流在用户本机运行，由 Codex 或 Claude Code 调用。它只会转换确认属于受支持 V4 格式的案例；已经是 V5、版本不明确或权限不足时会停止并给出原因。

## 1. 安装

需要 Node.js 20 或更高版本。通过不可变 GitHub Release 安装稳定 Launcher：

```bash
npm install --global \
  https://github.com/VisualLogic-VLCode/ivx-v4-v5-migration/releases/download/v0.3.5/ivx-v4-v5-migration-0.3.5.tgz
```

## 2. 安全创建 Token 文件

推荐将 Token 放在用户全局私有目录，而不是当前项目目录。以下命令适用于 macOS/zsh；输入内容不会显示在终端，也不会出现在命令历史中：

```bash
token_file="$HOME/.ivx-v4-v5/secrets/platform-token"
install -d -m 700 "$(dirname "$token_file")"
install -m 600 /dev/null "$token_file"
read -rs "platform_token?请输入当前用户 Token: "
printf '\n'
printf '%s\n' "$platform_token" > "$token_file"
unset platform_token
chmod 600 "$token_file"
```

文件必须由当前用户拥有、是普通文件且权限恰好为 `0600`。不要把它放进 Git 仓库，不要让 Agent 打开、打印、复制或分析它。Token 失效时直接安全覆盖该文件，不需要重新安装工作流。

Windows 暂时建议使用 `IVX_MIGRATION_TOKEN` 环境变量；在 Windows ACL 契约明确前，不把 Unix `0600` 规则类比成不可靠的权限检查。

## 3. 初始化

```bash
ivx-migrate setup \
  --token-file "$HOME/.ivx-v4-v5/secrets/platform-token"
```

`setup` 会：

- 默认配置平台地址 `https://dev.ivx.cn`；
- 配置签名 Workflow/Converter 稳定通道；
- 安装当前 Workflow 和 Converter；
- 安装 Codex 与 Claude Code 的受管 Agent 配置；
- 只把 Token 文件的绝对路径写入私有配置，不写入 Token 内容。

高级用户可覆盖平台地址：

```bash
ivx-migrate setup \
  --platform-base-url https://other-origin.example.com \
  --token-file /absolute/path/to/platform-token
```

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

只有 Job 已到达 `READY_TO_SAVE`，且用户对这个具体 Job 明确授权创建新案例时，才编辑已有的 `~/.ivx-v4-v5/config.json`。保留其他全部配置，只把已有 `platform.writeMode` 临时改为：

```json
{
  "platform": {
    "writeMode": "explicit"
  }
}
```

然后执行：

```bash
ivx-migrate job resume-save \
  --job <jobId> \
  --confirm-live-write SAVE_V5
```

无论命令成功、失败还是被中断，完成本次操作后都必须立即把同一字段恢复为：

```json
{
  "platform": {
    "writeMode": "disabled"
  }
}
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
- `PLATFORM`、`AUTHORIZATION`：不允许通过诊断另存绕过，必须先解决。

对这个具体 Job 再次明确授权：

```bash
ivx-migrate job resume-diagnostic-save \
  --job <jobId> \
  --confirm-live-write SAVE_V5_WITH_KNOWN_ISSUES
```

该命令仍要求 `platform.writeMode` 为 `explicit`，仍会重新检查当前用户的另存权限、源案例版本是否变化，并在保存后读回验证。分类可以包含 `CONVERTER`、`SOURCE`、`UNKNOWN` 的任意组合，但不能包含 `PLATFORM` 或 `AUTHORIZATION`。

完成时状态是 `DIAGNOSTIC_COPY_CREATED`，返回的 `target.nid` 可用于打开新案例。这个状态只证明“平台上的诊断副本与本地转换产物一致”，不证明转换语义正确，也不能汇报为转换成功。Job 中会保留各问题归属数量、`reports/diagnostic-save-authorization.json` 和带诊断意图的保存日志。问题修复后，应重新转换源案例获得正式结果。

诊断副本命令完成、失败或中断后，同样必须立即把 `platform.writeMode` 恢复为 `"disabled"`。如返回目标 nid，也可按上一节执行只读判版；`SKIPPED_ALREADY_V5` 只确认目标格式是 V5，不会消除已知问题，也不会把 `DIAGNOSTIC_COPY_CREATED` 提升为正常成功。

普通 `resume-save ... SAVE_V5` 不能绕过 `BLOCKED_CONVERTER_DEFECT`；诊断命令也不能用于普通 `READY_TO_SAVE` Job。

## 8. 更新和回滚

```bash
ivx-migrate update check
ivx-migrate update apply
ivx-migrate update apply --kind converter
ivx-migrate rollback --kind workflow
ivx-migrate rollback --kind converter
```

工作流和转换器独立发布。转换器问题必须等待维护者发布新 Converter；普通用户和 Agent 不应修改已安装 Converter。

首次在维护者电脑之外验证公开安装、普通参与者权限与默认不保存边界时，请严格按 [外部普通用户验收清单](EXTERNAL-USER-ACCEPTANCE.md) 执行，并为每个案例提交一份脱敏的[第一阶段结果模板](templates/EXTERNAL-USER-ACCEPTANCE-RESULT.md)。外部验收第一阶段禁止创建或保存 V5 案例；维护者另行指定具体 Job 并授权后，第二阶段使用独立的[另存结果模板](templates/EXTERNAL-USER-SAVE-AS-RESULT.md)。

## 9. 常见 Token 文件错误

| 错误码 | 处理方式 |
|---|---|
| `TOKEN_FILE_NOT_FOUND` | 检查配置中的绝对路径，重新执行 `setup --token-file ...` |
| `TOKEN_FILE_PERMISSIONS_INVALID` | 在 macOS/Linux 执行 `chmod 600 <file>` |
| `TOKEN_FILE_SYMLINK_FORBIDDEN` | 改用真实普通文件，不使用符号链接 |
| `TOKEN_FILE_CONTENT_INVALID` | 文件只保留一个裸 Token，可有一个末尾换行 |
| `PLATFORM_TOKEN_REQUIRED` | 配置安全 Token 文件，或临时设置 `IVX_MIGRATION_TOKEN` |

需要更完整的安全、恢复、外部验收和发布说明，请参阅 [PLATFORM-INTEGRATION.md](PLATFORM-INTEGRATION.md)、[EXTERNAL-USER-ACCEPTANCE.md](EXTERNAL-USER-ACCEPTANCE.md) 和 [RELEASING.md](RELEASING.md)。
