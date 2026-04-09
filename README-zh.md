# Open Claude Code
<a href="README-zh.md"><img src="https://img.shields.io/badge/🇨🇳中文版-1a1a2e?style=for-the-badge"></a>
<a href="README.md"><img src="https://img.shields.io/badge/🇺🇸English-1a1a2e?style=for-the-badge"></a>

## 🎉 News
[2026.04.01]🎯📢 🚀 Open Claude Code 现已支持两种 LLM_PROVIDER 接入模式：anthropic (原生接口) 与 openai_compat (OpenAI 兼容接口)！
通过 openai_compat 模式，你可以轻松对接包括 OpenRouter、DeepSeek、Gemini 在内的几乎所有主流模型服务商。

## 快速开始
```
Copy `.env.example` to `.env` and fill in your api key

cd run
brew install bun
bun install
bun run dev
```

![](assets/run-claude-code.png)

## Claude Code 交流群
<table>
  <tr>
    <td align="center">
      <img src="assets/wechat-qr.png" width="220" alt="wechat"><br>
      <sub>wechat</sub>
    </td>
    <td align="center">
      <img src="assets/discord-qr.png" width="220" alt="discord"><br>
      <sub>discord</sub>
    </td>
  </tr>
</table>

## 目录树
```
src/
├─ assistant/ — assistant helpers.
├─ bootstrap/ — boot-time setup.
├─ bridge/ — IPC adapters.
├─ buddy/ — buddy features.
├─ cli/ — CLI shell code.
├─ commands/ — named command handlers.
├─ components/ — shared UI pieces.
├─ constants/ — shared constants.
├─ context/ — context stores.
├─ coordinator/ — task coordination.
├─ entrypoints/ — specialized builds.
├─ hooks/ — reusable hooks.
├─ ink/ — terminal UI.
├─ keybindings/ — key mapping rules.
├─ memdir/ — ephemeral storage.
├─ migrations/ — data migrations.
├─ moreright/ — moreright integrations.
├─ native-ts/ — native bindings.
├─ outputStyles/ — CLI styles.
├─ plugins/ — plugin registry.
├─ query/ — query helpers.
├─ remote/ — remote runtime.
├─ schemas/ — config schemas.
├─ screens/ — screen compositions.
├─ server/ — server adapters.
├─ services/ — service backends.
├─ skills/ — skill definitions.
├─ state/ — runtime state.
├─ tasks/ — task runners.
├─ tools/ — tool implementations.
├─ types/ — TypeScript types.
├─ upstreamproxy/ — upstream proxy.
├─ utils/ — utility belt.
├─ vim/ — Vim integration.
├─ voice/ — voice helpers.
├─ commands.ts — CLI registry wiring.
├─ context.ts — context helpers.
├─ cost-tracker.ts — usage tracker.
├─ costHook.ts — cost hooks.
├─ dialogLaunchers.tsx — modal helpers.
├─ history.ts — session history.
├─ ink.ts — Ink initializer.
├─ interactiveHelpers.tsx — prompt helpers.
├─ main.tsx — app bootstrap.
├─ projectOnboardingState.ts — onboarding state.
├─ query.ts — query utilities.
├─ QueryEngine.ts — planning orchestrator.
├─ replLauncher.tsx — REPL entry.
├─ setup.ts — environment prep.
├─ Task.ts — base task API.
├─ tasks.ts — task utilities.
├─ Tool.ts — tool interfaces.
└─ tools.ts — tool helpers.
```

## 入口与引导
- `src/main.tsx` 启动 React/Ink UI，并把命令执行器、渲染器及各项服务编排到 Claude Code 体验中。
- `src/bootstrap.ts` 在 GUI 或 CLI 入口之前初始化环境/配置，`src/entrypoints` 则收集专用的构建（比如 SDK 外壳）。
- `src/cli` 与 `src/commands` 承载命令行接口、传输适配器，以及数百个命名命令（如 `ctx_viz`、`tasks`、`voice`、`agent` 等），供用户在交互或脚本中调用。

## UI 与交互层
- `src/components` 及其子目录（`ui`、`tasks`、`memory`、`teams`、`settings`、`design-system` 等）实现共享的 React/Ink 组件、对话框和组成体验的多个屏幕。
- `src/screens` 定义更高层的页面，把组件组合成入职、上下文视图、技能等流程。
- `src/hooks`、`src/hooks/notifs` 与 `src/hooks/toolPermission` 封装与通知、工具权限以及通用 React 状态派生相关的可重用逻辑。
- `src/ink` 是 Ink 原生的控制台 UI 层（布局、组件、hooks、事件、终端 I/O），用于终端渲染器。
- `src/keybindings` 将按键映射到 GUI 与终端模式下可识别的命令，而 `src/context` 与 `src/state` 存放 UI 消费的可变上下文片段。

## 功能子系统
- `src/tasks` 与其子目录（如本地 shell agent、远端 agent、dream task 等）编排任务运行器，并提供协调工具、工作区与 agent 的可插拔任务基础设施。
- `src/tools`（连同 `shared`、`testing` 目录及 `WebSearchTool`、`FileWriteTool`、`SkillTool` 等众多命名工具）注册 agent 可使用的工具集，包括计划/技能创作、工作区洞察与自动化助手。
- `src/services`（例如 `plugins`、`oauth`、`mcp`、`teamMemorySync`、`PromptSuggestion`）暴露长生命周期的后端抽象：API 客户端、遥测、插件编排、策略执行与与上游系统的同步。
- `src/skills` 与 `src/plugins` 提供捆绑与第三方智能工具的注册/定义，扩充 agent 的能力。
- `src/query`、`src/QueryEngine.ts`（以及如果存在的 `src/queries`）协同规划/执行引擎，调度任务并解析结果。

## 支撑性基础设施
- `src/server` 与 `src/bridge` 容纳服务器端适配器和 CLI、桌面或 Web 客户端访问 Claude Code 核心的 IPC 层。
- `src/context.ts`、`src/history.ts`、`src/memdir` 与 `src/projectOnboardingState.ts` 包含会话、记忆状态和入职进度的持久化/元数据助手。
- `src/utils` 是庞大的工具带（子目录如 `background`、`settings`、`memory`、`mcp`、`permissions`、`telemetry`、`git`、`sandbox` 等），维系平台一致性：存储助手、权限检查、遥测助手、沙箱控制、Git 助手、CLI 助手等。
- `src/constants`、`src/schemas`、`src/types` 与生成的类型包定义共享契约、配置 schema 和 TypeScript 类型。

## 原生与平台特定模块
- `src/native-ts` 收纳原生模块（yoga 布局、文件索引、色差）的 TypeScript 绑定供渲染器或 CLI 格式化与比较使用。
- `src/vim` 包含 Vim 集成胶水层。
- `src/voice`、`src/bridge` 与 `src/remote` 管理音频/语音辅助、远程桥接连接和远程运行时协同。

## 迁移与后端辅助
- `src/migrations` 编码数据迁移以保持存储的向后兼容。
- `src/services/autoDream`、`src/services/toolUseSummary` 与 `src/services/tips` 让自动化功能、分析与提示与系统其余部分保持同步。

## 可观测性与支持宏
- `src/cost-tracker.ts`、`src/costHook.ts` 与（如存在的）`src/monitoring` 跟踪使用成本并整合遥测/分析。
- `src/remote`、`src/coordinator`、`src/state` 与 `src/outputStyles` 准备远程协调、CLI 输出格式化和共享状态机的运行时。

此布局让 Claude Code 运行时在保持工具、服务与插件模块化的同时，混合 React UI、Ink 终端、agent 命令、线程任务与原生扩展。

## 免责声明
- 本仓库内所有源代码的版权归 Anthropic 所有。
- 本仓库仅供技术研究、学习和参考之用，严禁任何商业用途。
- 如有侵权，请联系删除。

