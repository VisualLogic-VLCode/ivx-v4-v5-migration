# 所有用户交给 AI Agent 的安装与初始化提示

这是普通用户的统一入口，不是维护者验收脚本。首次使用时，把下面整段文字交给本机 Codex 或 Claude Code。不要在提示词中填写 Token、Cookie、案例 JSON 或 `nid`。

```text
请读取并严格按照下面这份不可变引导，在我的本机安装或更新 iVX V4→V5 工作流，并完成安全初始化：
https://raw.githubusercontent.com/VisualLogic-VLCode/ivx-v4-v5-migration/v0.7.2/docs/AI-AGENT-BOOTSTRAP.md

请由你完成环境检查、Launcher 安装或更新、工作流初始化、doctor、签名更新检查和 Agent Skill 状态检查，不要让我手动执行 ivx-migrate 命令，也不要从 Git 仓库安装或更新运行时。

如果尚未安全配置 Token，或者 doctor 判断 Token 已缺失或失效，请先明确告诉我即将打开 iVX 原生安全输入框，然后只使用 Launcher 自带的可见安全输入界面让我输入 Token。不要通过聊天、命令参数、后台 PTY、终端 read 或临时脚本收集 Token，也不要打开、读取、打印、复制、哈希或分析 Token 文件。如果现有 Token 状态正常，不要让我重复输入。

本次只完成安装、更新和初始化。不要处理任何 nid，不要创建迁移 Job、Runtime Review 或 V5 案例，也不要执行平台写入。

完成后，请完整读取本次 Agent 对应的已安装 v4-to-v5-workflow Skill，然后给我一份简短的脱敏就绪结论。告诉我现在可以在当前任务或一个全新任务中输入：
“请使用 v4-to-v5-workflow，把 nid <NID> 转成 V5。”
```

初始化成功后，普通用户不必再次粘贴这段提示。以后直接用自然语言给出 `nid` 和目标即可。可复制的任务示例、授权范围和结果含义见[通过 AI Agent 使用工作流](../AI-USER-GUIDE.md)。
