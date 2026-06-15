# 快速开始

[English](./getting-started.en.md) | 中文

这份文档面向第一次使用 CrewUp 的开发者。CrewUp 是工作流 harness，不是模型服务本身。它负责创建 run、生成任务、约束主 agent 和子 agent 的边界、检查门禁、生成报告；真正执行子 agent 的能力来自你选择的 agent 环境。

## 前置条件

- Node.js 20 或更高版本
- npm / pnpm / yarn 其中一种包管理器
- 一个 Git 仓库，真实项目建议先 `git init` 并创建初始提交
- 一个可执行的 agent 环境：Codex、Claude、Cursor、Trae 或 Manual
- 如果要运行真实 AI 子 agent，需要先配置对应工具的登录状态或 API key

## 安装

```bash
npm install -D crewup-harness
npx crewup install
npx crewup init --agent codex --yes
npx crewup check
```

已有项目或 monorepo 建议先扫描：

```bash
npx crewup inspect --no-ai
npx crewup init --agent codex --yes
```

只有在已经配置 API key，并希望模型基于真实项目证据补充适配层时，才运行：

```bash
npx crewup inspect --ai
```

## API Key 和子 Agent

CrewUp 不会自带 OpenAI API key，也不会替用户创建模型账号。

如果选择 `codex`：

- Codex Desktop / Codex CLI 已登录并支持 native subagent 时，可以走 native 子 agent 工作流。
- SDK/API 编排、`inspect --ai` 或需要 OpenAI API 的自动化路径，需要设置 `OPENAI_API_KEY`。

PowerShell：

```powershell
$env:OPENAI_API_KEY="sk-..."
```

macOS / Linux：

```bash
export OPENAI_API_KEY="sk-..."
```

如果选择 `claude`、`cursor`、`trae`：

- 当前是 bridge 模式。
- CrewUp 生成 handoff 和 result JSON 契约。
- 外部工具使用自己的登录状态、API key 或订阅。
- 完成后必须把结果写回 `.harness/runs/<run-id>/logs/agent-bridge/<agent>.result.json`。

如果选择 `manual`，不需要 AI API key。CrewUp 只生成任务、上下文、门禁和报告，由人或外部工具执行并写回 result JSON。

## 检查环境

```bash
npx crewup doctor
```

重点看：

- `.harness/` 是否存在
- `.harness/project/profile.yaml` 是否已生成
- selected agent 是否是你想要的环境
- SDK/API 模式或 `inspect --ai` 是否已设置 `OPENAI_API_KEY`
- Windows terminal encoding 是否可能导致中文显示乱码

如果看到中文乱码：

```bash
npx crewup doctor --encoding-help
```

## 启动一个 Run

CLI：

```bash
npx crewup run --mode=strict "使用 CrewUp 做一个最小 counter web app，跑完整 workflow。验收标准：页面显示 counter，初始值为 0；可以 +1、-1、reset；刷新后数值保留。范围：只做一个很小的前端实现。完成后请根据项目配置自行发现并执行必要验证。"
```

聊天窗口：

```text
使用 CrewUp strict 做一个最小 counter web app，跑完整 workflow。验收标准：页面显示 counter，初始值为 0；可以 +1、-1、reset；刷新后数值保留。范围：只做一个很小的前端实现。完成后请根据项目配置自行发现并执行必要验证。
```

当你在聊天里明确说“使用 CrewUp”时，可以同时说明模式，例如 `lite`、`strict`、`plan` 或 `discovery`。如果没有说明模式，主 agent 可以运行 `npx crewup run "<需求>"`，让 CrewUp 打印自动选择的 mode/profile。提取 runId 后，再使用 `next-agent` 或 `drive` 调度。用户不需要为了拿 runId 先手动跑命令。

如果你没有说明模式，CrewUp 会按请求内容选择保守默认值并创建 run。小范围低风险实现默认走直接轻量 `lite-v2`；完整功能、跨模块、高风险或明确 strict 的请求默认走 strict/full。想强制某条路径时，仍可显式传入 `--mode` 或 `--profile`。

## 观察调度

```bash
npx crewup status
npx crewup status <run-id>
npx crewup next-agent <run-id>
npx crewup audit <run-id>
npx crewup gate-check <run-id>
npx crewup report <run-id>
```

- `status` 不带 runId 时会列出所有 run，可用来查 runId。
- `status <run-id>` 会展示 `RUN_STATUS.md`，说明当前状态、stage、owner、下一步命令、阻塞和可复用产物。
- `next-agent` 告诉你现在真正能启动哪个子 agent；正式 run 初始应只允许 `requirements-plan`。
- `audit` 检查流程有没有乱：提前启动、主 agent 越界、owner artifact 缺 provenance、上下文压力、重复返工等。
- `gate-check` 判断当前阶段能否通过质量门禁。
- `report` 汇总 agent 结果、artifact、token/context budget、返修 lineage 和归档状态。

## 正常启动顺序

```text
requirements-plan
  -> requirements
  -> architect
  -> implementation agents selected by implementation-plan.md
  -> tester
  -> reviewer
  -> release
```

实现类 agent 在 run 创建时只是候选。真正启动哪些实现 agent，应由 `architect` 写出的 `artifacts/implementation-plan.md` 决定。

`lite` 只表示需求/架构产物更短、上下文预算更小，不表示可以跳过 `requirements-plan -> requirements -> architect`。缺少 `implementation-plan.md` 时，开发 agent 必须保持 blocked/skipped。

## 工具降级

如果 Context7、MCP、插件或其他可选工具不可用，不要只在聊天里说明，应记录到 run：

```bash
npx crewup tool-fallback <run-id> --tool Context7 --reason "not available in this session" --fallback "use checked-in docs and architect synthesis"
```

这只是证据日志，不会授权主 agent 接管 architect、tester、reviewer 或 implementation owner 的职责。

## 完成与归档

成功完成：

```bash
npx crewup audit <run-id>
npx crewup gate-check <run-id>
npx crewup report <run-id>
npx crewup finish <run-id>
```

卡住或部分完成时，默认先保持当前 run open，并继续回派 owner agent：

```bash
npx crewup native-state <run-id> diagnose
npx crewup native-state <run-id> reconcile-results
npx crewup next-agent <run-id>
```

只有用户明确关闭非成功现场时才归档：

```bash
npx crewup archive <run-id> --outcome=blocked --reason="local database is unavailable" --close
npx crewup archive <run-id> --outcome=partial --reason="frontend done, backend blocked" --close
npx crewup cancel <run-id> --reason="scope changed"
```

归档会生成或刷新：

- `.harness/runs/<run-id>/RUN_STATUS.md`
- `.harness/runs/<run-id>/RUN_SUMMARY.md`
- `.harness/runs/<run-id>/logs/archive/archive-summary.md`
- `.harness/reports/<run-id>.md`

如果目标项目只有 `git init` 但没有初始提交，archive commit 会写审计并跳过 git commit，不会把成功 run 卡死。建议真实项目先创建一个初始 setup commit。

## 继续上一轮 Run

```bash
npx crewup continue <source-run-id> --mode=lite "继续处理上次未完成的小范围问题，复用已有需求和架构"
```

新的 run 会读取来源 run 的 `RUN_STATUS.md`、`RUN_SUMMARY.md`、需求和架构产物。旧 run 不会被覆盖。`continue` 不带 `--mode` 时，会结合新请求和来源 run 证据选择 continuation 默认值；想强制某条路径时，仍可显式传入 `--mode` 或 `--profile`。

## Lite 轻量 Run

低风险、小范围任务可以直接省略 mode，让默认路径走直接轻量 `lite-v2`：

```bash
npx crewup run "修复一个小前端布局问题，并根据项目配置自行发现和执行必要验证"
```

`lite-v2` 会在 run 目录下直接生成 `spec.md`、`tasks.md`、`validation.md` 和 `summary.md`。它不会创建 native subagent tasks，也不会生成 native subagent plan。主 agent 可以在任务范围内直接实现，但必须先更新 `validation.md` 和 `summary.md`，再运行：

```bash
npx crewup finish <run-id>
```

需要 tester/reviewer/release 委派证据的轻量正式流程，可以显式使用 `--mode=lite`。数据库、auth、安全、部署、跨模块或需要审计证据的任务仍应使用 `strict` 或 `strict --risk=high`。

详细说明见 [Lite 轻量流程](./lite-v2.md)。
