# 维护者外部验收索引

这里组织的是发布方和维护者 QA，不是普通用户的必经操作。普通用户从[通过 AI Agent 使用工作流](../AI-USER-GUIDE.md)开始即可。

## 推荐三阶段

1. **安装与就绪**：测试用户把[安装与初始化提示](../templates/AI-AGENT-STARTER-PROMPT.md)交给全新 Codex/Claude Code 任务，只完成 Launcher、Token、setup、doctor、更新和 Skill 就绪；不提供 `nid`，不创建 Job。
2. **普通完整转换**：重新打开一个全新 Agent 任务，只说“请使用 v4-to-v5-workflow，把 nid `<NID>` 转成 V5。”验证 Skill 自动发现、V4/V5 判版、权限、转换、诊断、普通 Save As、目标回读和写入门禁恢复。
3. **高级能力**：使用独立 Job/Review 验证无副作用 Playwright 对照、证据分类、可复现的受限自动修复，以及 Group 普通参与者的真实读取和另存权限。具体安全边界见[外部普通用户验收清单的第三阶段](../EXTERNAL-USER-ACCEPTANCE.md#11-可选第三阶段运行时自动修复与-group-完整权限)。

第一阶段通过只证明安装与身份就绪；第二阶段到达 `SUCCEEDED` 才证明普通转换闭环；第三阶段的运行时和 Group 两项分别结论，不能互相替代。没有制造运行时差异时，不能声称自动修复分支已经被真实触发。

## 严格无保存与权限回归

发布前若需要先证明默认不写入、个人/Group 只传 `nid` 的只读对象预检和脱敏报告，应使用单独的[验收专用 Agent 提示](../templates/AI-AGENT-ACCEPTANCE-PROMPT.md)与[外部普通用户验收清单](../EXTERNAL-USER-ACCEPTANCE.md)。该预检不证明成员另存权限；真实 Group 另存能力只在单独授权的写入阶段由平台接口验证。第一阶段故意停在 `READY_TO_SAVE` 或安全停止，不代表普通用户说“转成 V5”时也必须二次确认普通另存。

结果分别使用：

- [无保存结果模板](../templates/EXTERNAL-USER-ACCEPTANCE-RESULT.md)；
- [普通/诊断另存结果模板](../templates/EXTERNAL-USER-SAVE-AS-RESULT.md)。
