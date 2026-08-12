# iVX V4 → V5 外部用户验收结果

> 只填写摘要。不要粘贴 Token、Cookie、Authorization、Token 文件路径、完整命令输出、案例 JSON、配置文件、公式或 diagnostics records。
>
> 本模板只记录第一阶段“不保存”结果。每个案例单独复制一份，不要把个人案例与 Group 案例混在同一份结果中。

## A. 基本信息

- 验收编号：
- 案例编号：A（个人所有者）/ B（Group 普通参与者）
- 时间与时区：
- 测试用户代号（不要写真名）：
- 操作系统与架构：
- Node.js 版本：
- npm 版本：
- 使用方式：Codex / Claude Code（本轮不接受仅 CLI）
- 从 Agent-first 启动提示开始：是 / 否
- 安装、检查、转换和摘要命令均由 Agent 执行：是 / 否
- 网络环境摘要（例如公司网络、家庭网络；不要写代理凭据）：

## B. 案例条件

- 源 nid：
- 已由维护者预先确认是受支持 V4：是 / 否
- 测试用户关系：个人案例创建者/所有者 / Group 普通参与者且非创建者、非 Group 所有者
- 测试用户能在 dev.ivx.cn 打开源案例：是 / 否
- 本轮所有平台命令均未传 gid：是 / 否
- 未记录或发送案例标题、业务数据、用户 ID、workId：是 / 否

## C. 公开分发与健康检查

- Launcher 版本：
- Workflow 版本：
- Converter 版本：
- Agent protocol 版本：
- `platformConfigured`：true / false
- `platformBaseUrl`：
- `tokenAvailable`：true / false
- `tokenSource`：file / environment
- `tokenError`：null / 错误码（不要附 Token）
- Agent 配置 `current`：true / false
- Agent 已读取受管 `v4-to-v5-workflow` Skill 后再执行迁移：是 / 否
- Workflow 更新状态：CURRENT / 其他
- Converter 更新状态：CURRENT / 其他
- 是否发生更新：否 / 是，更新前后版本为：

## D. 权限预检

- 命令只使用 `--nid`：是 / 否
- `allowed`：true / false
- `decision`：
- `reason`：
- Group 权限关系由平台结果确认：是 / 否 / 不适用
- 是否发生一次 Token 本地更新后重试：否 / 是
- 权限阶段结论：通过 / 安全停止

## E. 转换结果

- Job ID：
- 最终状态：
- 输入 `gid` 为 null：是 / 否
- 使用受管公开 Converter（未使用 `--converter-path`）：是 / 否
- 判版 `kind`：
- 判版 `reason`：
- `convertible`：true / false
- 权限结论：
- `issueCount`：
- `blockerCount`：
- `sourceNodeCount`：
- `targetNodeCount`：
- `astNodeCount`：
- `jsfnCount`：
- V5 event AST 数：
- 目标中 V4 event tree 数：
- validation 警告摘要（不贴公式或案例内容）：

## F. Converter diagnostics 摘要

- `available`：true / false
- `total`：
- `droppedTotal`：
- `customExprTotal`：
- `uniqueTotal`：
- `returnedRecordCount`：
- `truncated`：true / false
- `categoryTruncated`：true / false
- `phaseTruncated`：true / false

## G. 默认不保存与安全边界

- 命令未使用 `--save`：是 / 否
- 命令未使用 `--confirm-live-write`：是 / 否
- 未执行 `job resume-save`：是 / 否
- 未执行 `job resume-diagnostic-save`：是 / 否
- `platform.writeMode` 保持 `disabled`：是 / 否
- Job 不包含 target nid：是 / 否
- 不存在 `reports/platform-save-journal.json`：是 / 否
- Job 历史不包含保存/创建/平台写入状态：是 / 否
- 平台未出现本次测试创建的新案例：是 / 否
- Agent 未读取、打印、复制、哈希或分析 Token 文件：是 / 否
- Token 只通过 Launcher 原生安全输入框录入，未使用后台 PTY、终端 `read`、临时脚本、聊天或明文参数：是 / 否 / 不适用
- 配置未内联保存 Token：是 / 否
- Job 凭据字段模式扫描为空：是 / 否
- macOS/Linux Token 文件为当前用户普通非链接文件且权限 `0600`：是 / 否 / 不适用
- Job 文件权限 `0600`、目录权限 `0700`：是 / 否 / 不适用

## H. 验收结论

- 分发安装：通过 / 失败
- 本案例权限：通过 / 失败 / 安全停止
- V4 判版：通过 / 失败 / 不适用
- 转换与验证：通过 / 失败 / 安全停止
- 默认不保存：通过 / 失败
- Token 安全边界：通过 / 失败
- 总结论：完整通过 / 部分通过需换案例 / 安全停止需诊断 / 失败
- 失败或停止的错误码：
- 一句话问题摘要（不得包含凭据或案例业务数据）：
- Job 是否保留待维护者审阅：是 / 否

## I. 第二阶段授权

- 本模板是否包含真实另存授权：否
- 是否执行了任何 V5 创建或保存：否

如需真实另存，维护者必须在审阅本结果后针对具体 Job 另行书面授权；不要在本模板中自行改为“是”。第二阶段另存使用独立的 [EXTERNAL-USER-SAVE-AS-RESULT.md](EXTERNAL-USER-SAVE-AS-RESULT.md)。
