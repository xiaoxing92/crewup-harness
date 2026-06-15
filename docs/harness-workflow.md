# Harness Workflow

中文 | [English](./harness-workflow.en.md)

CrewUp 是显式启用的严格 AI engineering harness。没有明确的 CrewUp / harness / run 信号时，普通聊天不会进入这套流程。一旦进入正式 run，主 agent 只负责创建 run、调度、登记结果、跑审计和汇总，不代写 owner artifact，也不代写业务代码。

## 入口

有效入口有两种：

- CLI：用户运行 `npx crewup run --mode=<lite|strict|plan|discovery> "..."`。
- 聊天：用户明确说“使用 CrewUp / 按 harness 流程 / 继续某个 run”。这时主 agent 应自己运行 `npx crewup run`，提取 runId，然后继续 `next-agent` 调度。

聊天入口不应该要求用户先手动生成 runId。

## 执行前置条件

CrewUp 可以在没有 API key 的情况下创建 run、任务、context pack、audit 和 gate。真实 AI 子 agent 执行需要你选择的 agent 环境已经配置好模型访问方式：

- `codex` native 模式需要 Codex 环境可以启动子 agent。Codex Desktop / CLI 可能使用自己的登录状态；SDK/API 路径和 `inspect --ai` 需要 `OPENAI_API_KEY`。
- `claude`、`cursor`、`trae` 当前使用 bridge 模式。这些工具使用自己的认证方式，并且必须把 CrewUp 兼容的 result JSON 写回 run。
- `manual` 模式不需要 AI key；人或外部工具执行 handoff，并写回 result JSON。

如果 native 工具或模型访问不可用，应记录 fallback 并停止正式委派工作。fallback 不授权主 agent 代写 owner artifact 或业务代码。

## 语言和契约

- 面向用户的状态、阻塞、交接、总结跟随用户主要语言。
- Harness 机器契约保持英文：artifact heading、JSON 字段、文件路径、命令、状态值和 schema label。
- 读取本地中文文件时使用显式 UTF-8，避免 Windows 终端编码导致误判。

## 核心流程

```text
intake -> requirements_plan -> requirements_confirm -> plan
  -> implement -> verify -> review -> release -> done
```

严格流程不靠跳过角色省 token，而是通过更窄的任务、更清晰的 result schema、更少重复返工来降低浪费。没有指定 mode 时，CrewUp 可以为小范围低风险任务选择文档化的直接轻量默认路径 `lite-v2`；显式 `--mode=lite` 仍是正式轻量工作流。

当需求里明确排除某个范围，例如 `no backend/database/auth/routing`，CrewUp 会避免误启动这些无关候选。但是否需要 backend、database、auth、routing，仍应主要由需求和 architect 的 `implementation-plan.md` 决定，而不是主 agent 主观接管。

## Requirements-Plan First

正式 run 的稳定入口是：

```text
requirements-plan first, always
```

开发 agent 不能因为需求看起来很小就直接启动。

`requirements-plan` 负责交互式澄清。它应先在 `requirement-plan.md` 里生成 Markdown 需求确认卡，用表格和短列表展示已确认事实、待决策项、非目标和验收预览；如果关键决策缺失，再返回 `needs_input` 和结构化 `clarificationQuestions`。

主 agent 只负责交互转交：优先展示紧凑确认卡或引导用户使用 `crewup clarify --interactive`，不要在聊天窗口粘贴长问卷。文本 fallback 使用 `A/B/C/D/E...` 字母选项，并保留 `其它` 让用户自行输入。主 agent 不替用户静默选择默认项，也不代写需求产物。

```bash
npx crewup clarify <run-id>
npx crewup clarify <run-id> --interactive
```

## Owner Artifacts

| Artifact | Owner |
| --- | --- |
| `artifacts/requirement-plan.md` | requirements-plan |
| `artifacts/requirement.md` | requirements |
| `artifacts/architecture.md` | architect |
| `artifacts/implementation-plan.md` | architect |
| implementation files | frontend/backend/database/devops/docs owner agents |
| `artifacts/test-report.md` | tester |
| `artifacts/review-report.md` | reviewer |
| `artifacts/release-summary.md` | release |

主 agent 不允许把子 agent 的文本复制进 owner artifact。如果 owner artifact 缺失、结构不合格或需要返修，优先恢复对应 owner agent 处理。

`repair-artifacts` 已移除。Owner artifact 必须优先由 owner agent 修复；生命周期或状态异常时使用 `repair-state` 做审计化修复。

## Native Subagent Path

```bash
npx crewup context-pack <run-id> --agents=<agents>
npx crewup native-plan <run-id> --agents=<agents>
npx crewup next-agent <run-id>
npx crewup native-state <run-id> status
```

主 agent 启动 agent 前必须运行 `next-agent`，只启动 runnable 列表里的 agent。不能凭 native plan 猜测，也不能在上游结果没有 captured 前启动下游 agent。

必要顺序：

```text
requirements-plan -> requirements -> architect -> implementation agents -> tester -> reviewer -> release
```

`architect` 完成后，implementation candidates 只有在 `artifacts/implementation-plan.md` 存在，并且用精确 agent id 分配后，才能真正启动。缺少 `implementation-plan.md` 本身就是阻塞原因。

## Audit 和 Gate

```bash
npx crewup audit <run-id>
npx crewup gate-check <run-id>
npx crewup report <run-id>
```

`audit` 检查调度本身是否干净：下游提前启动、implementation 未经架构分配、owner artifact 缺 provenance、tester/reviewer 反馈未回派、保留 agent 过多、上下文压力过大等。

`gate-check` 判断当前 run 能否过质量门禁：artifact schema、owner provenance、native results、changed files、服务状态和归档状态。

默认关闭顺序是先 `audit`、`gate-check`、`report`，再关闭不需要保留的子 agent。只有保留容量不足时，才先用 `native-state recommend-close` 释放低价值 agent，并记录原因。

## 返修结果

当子 agent 的新结果是在修复旧结果时，result JSON 应保留 lineage：

```json
{
  "repairOf": ["RF-01", ".harness/runs/<run-id>/logs/native-subagents/frontend.result.json"],
  "repairReason": "tester reported a blocking issue",
  "previousResultPath": ".harness/runs/<run-id>/logs/native-subagents/frontend.result.json"
}
```

这样 report 能说明“这次结果修复了什么”，减少重复返工和上下文混乱。

## Run Lifecycle

CrewUp 的唯一默认工作单元是 `Run`。每个 run 都有：

- `.harness/runs/<run-id>/state.json`
- `.harness/runs/<run-id>/RUN_STATUS.md`
- `.harness/runs/<run-id>/RUN_SUMMARY.md`，归档后生成
- `.harness/reports/<run-id>.md`，report/归档后生成

run 状态包括：

| Status | Meaning |
| --- | --- |
| `active` | 正在执行 |
| `waiting_user` | 等用户确认 |
| `blocked` | 卡住但保留现场 |
| `partial` | 部分完成，可复用但未达 done |
| `done` | 完整完成 |
| `canceled` | 用户取消 |
| `failed` | 执行失败 |

阻塞不等于归档。`blocked` 默认表示当前 run 卡住但仍可继续，下一步应该回派 owner agent。`archive --close` 才表示用户明确关闭非成功现场。归档也不等于成功；只有 `success` 结局代表完整完成。

```bash
npx crewup status
npx crewup next-agent <run-id>
npx crewup archive <run-id> --outcome=blocked --reason="..." --close
npx crewup cancel <run-id> --reason="..."
npx crewup continue <run-id> "继续处理上次阻塞的问题"
```

## 发布前验证

```bash
npm run harness:check
npm run harness:test-flow
npm run release:preflight
```

这会覆盖配置完整性、临时项目安装、run 创建、任务顺序、owner artifact gate、implementation dispatch、repair-plan、archive closeout 和基础发布打包检查。

## Lite 轻量流程

`lite-v2` 是低风险、小范围实现任务的默认直接轻量路径，适合 native subagent provenance 比任务本身更重的场景。

```bash
npx crewup run "修复一个小 UI 问题并记录验证"
```

它的 run 结构是：

```text
input.md
spec.md
tasks.md
validation.md
summary.md
state.json
RUN_STATUS.md
```

`lite-v2` 不生成 native subagent tasks，不创建 `native-subagent-plan.json`，也不要求 `requirements-plan -> requirements -> architect -> tester -> reviewer -> release`。主 agent 可以在任务范围内直接实现。`finish` 会检查 `validation.md` 和 `summary.md` 不再是 pending 后才归档 success。

需要 delegated tester/reviewer/release 证据、但又比 strict 更轻的正式流程时，显式使用 `--mode=lite`。

数据库、auth、安全、部署、跨模块或需要审计证据的任务仍应使用 strict 或 `strict --risk=high`。

详细说明见 [Lite 轻量流程](./lite-v2.md)。
