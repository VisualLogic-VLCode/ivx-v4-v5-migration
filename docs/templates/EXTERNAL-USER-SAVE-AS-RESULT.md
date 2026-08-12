# iVX V4 → V5 外部用户第二阶段另存结果

> 仅在维护者已经审阅第一阶段结果，并书面授权一个具体 Job 后填写。
>
> 只填写摘要。不要粘贴 Token、Cookie、Authorization、Token 文件路径、完整命令输出、案例 JSON、配置文件、公式、diagnostics records、workId 或用户目录。

## A. 授权与前置条件

- 验收编号：
- 时间与时区：
- 测试用户代号（不要写真名）：
- 第一阶段结果编号：
- 源 nid：
- 获得授权的 Job ID：
- 授权类型：普通已验证另存 / 带已知问题的诊断副本
- 授权明确写出本 Job ID：是 / 否
- 本次未复用其他 Job 的授权：是 / 否
- 执行前权限结论：ALLOWED / 其他
- 执行前源修订未变化：是 / 否
- 执行前 Job 状态：
- Workflow 版本：
- Converter 版本：
- Agent protocol 版本：

## B. 保存路径

- 仅在本次操作前临时启用 `platform.writeMode=explicit`：是 / 否
- 执行命令：`resume-save` / `resume-diagnostic-save`
- 使用确认串：`SAVE_V5` / `SAVE_V5_WITH_KNOWN_ISSUES`
- 命令与授权类型一致：是 / 否
- 未使用另一个 Job ID：是 / 否
- 未在结果未知时重新发起新建：是 / 否
- 命令退出结论：成功 / 可恢复停止 / 拒绝 / 失败
- 最终 Job 状态：

## C. 目标与平台回读

- 返回目标 nid：
- 目标 nid 与源 nid 不同：是 / 否
- 保存日志存在：是 / 否
- 保存日志 intent：`validated` / `known-issues-diagnostic` / 其他
- 保存日志最终 phase：`POST_SAVE_VERIFIED` / 其他
- 平台回读与本地待保存 V5 一致：是 / 否
- 源案例修订保持不变：是 / 否
- 未创建未知或重复目标：是 / 否 / 无法确认

## D. 目标 V5 复检

- 已运行只读 `ivx-migrate migrate --nid <TARGET_NID>`：是 / 否
- 复检 Job ID：
- 复检状态：`SKIPPED_ALREADY_V5` / 其他
- 判版 kind：`V5_0` / 其他
- 判版 reason：`ALREADY_V5` / 其他
- `metadata.extra.ver` 支持 V5 判定：是 / 否 / 未记录
- 实际结构中存在 V5 event AST：是 / 否 / 未记录
- 实际结构中 V4 event tree/formula 信号为 0：是 / 否 / 未记录
- 未仅凭兼容 `edtVer` 字段判断版本：是 / 否

## E. 已知问题专用项

- 本次是否为诊断副本：是 / 否
- 问题归属只包含 `CONVERTER` / `SOURCE` / `UNKNOWN`：是 / 否 / 不适用
- 不包含 `PLATFORM` 或 `AUTHORIZATION`：是 / 否 / 不适用
- `reports/diagnostic-save-authorization.json` 存在：是 / 否 / 不适用
- 按归属汇总的问题数量（只写数量，不贴内容）：
- 已明确标注“诊断副本带已知问题”：是 / 否 / 不适用
- 未把 `DIAGNOSTIC_COPY_CREATED` 汇报为转换成功：是 / 否 / 不适用

## F. 安全收尾

- 无论命令结果如何，`platform.writeMode` 已恢复为 `disabled`：是 / 否
- 配置未内联保存 Token：是 / 否
- Agent 未读取、打印、复制、哈希或分析 Token 文件：是 / 否
- Job/日志中未出现 Token、Cookie、Bearer 或 Authorization 凭据值：是 / 否
- Job 文件权限 `0600`、目录权限 `0700`：是 / 否 / 不适用
- Job 与保存日志已保留待维护者审阅：是 / 否

## G. 验收结论

- 授权边界：通过 / 失败
- 权限与源修订复检：通过 / 失败
- 保存与平台回读：通过 / 失败 / 可恢复停止
- 目标 V5 复检：通过 / 失败 / 未完成
- 写入开关恢复：通过 / 失败
- Token 安全边界：通过 / 失败
- 总结论：普通另存完整通过 / 诊断副本链通过但转换仍有已知问题 / 可恢复停止 / 失败
- 错误码（如有）：
- 一句话问题摘要（不得包含凭据或案例业务数据）：

普通另存只有在最终状态为 `SUCCEEDED`、日志 intent 为 `validated`、phase 为 `POST_SAVE_VERIFIED`、目标复检为 `SKIPPED_ALREADY_V5` 且写入开关已恢复时才算完整通过。

诊断副本只有在最终状态为 `DIAGNOSTIC_COPY_CREATED`、日志 intent 为 `known-issues-diagnostic`、平台回读通过且写入开关已恢复时才算“诊断副本链通过”；它永远不能记为转换正确性通过。
