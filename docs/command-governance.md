# CrewUp 命令与完成状态治理

中文 | [English](./command-governance.en.md)

这份文档回答三个问题：哪些命令是日常入口，哪些命令普通使用者可以忽略；每个模式怎么定义完成与未完成；成功、部分完成、阻塞、取消、失败之后应该怎么处理。

治理原则：流程稳定来自更少的模糊入口、更明确的状态转换和可解释的默认 profile，而不是跳过证据、绕过规则或让 AI 隐式改变契约。

## 日常入口

| 命令 | 用途 | 治理规则 |
| --- | --- | --- |
| `npx crewup doctor` | 检查环境、编码和可选能力 | 只读，不改变 run 状态 |
| `npx crewup init --agent codex --yes` | 初始化项目适配层 | 安装或适配层变化后使用 |
| `npx crewup check` | 校验 harness 配置和核心契约 | `.harness/` 变化后必须运行 |
| `npx crewup run --mode=lite "..."` | 创建轻量实现 run | 只用于低风险、小范围任务 |
| `npx crewup run --mode=strict "..."` | 创建正式多 agent 交付 run | 正常严格流程 |
| `npx crewup run --mode=strict --risk=high "..."` | 创建高风险 full profile run | 权限、数据库、安全、部署、大范围改动 |
| `npx crewup run --mode=plan "..."` | 创建只规划、不改业务代码的 run | 产出计划证据 |
| `npx crewup run --mode=discovery "..."` | 创建项目或模块盘点 run | 产出发现和后续 run 建议 |
| `npx crewup run --dry-run "..."` | 只预览命名和路由 | 不创建 run，可以省略 mode |
| `npx crewup status` / `npx crewup runs` | 查看 run 列表 | 只读 |
| `npx crewup explain <run-id>` | 诊断卡住或状态混乱的 run | 第一诊断入口 |
| `npx crewup drive <run-id>` | 确定性推进可脚本化步骤 | 能关就关，不能关就输出下一步安全动作 |
| `npx crewup finish <run-id>` | 证据齐全后尝试 success 收口 | 证据不足会拒绝成功 |
| `npx crewup archive <run-id> --outcome=...` | 记录非成功结果 | 非成功默认保持 open，除非显式 `--close` |
| `npx crewup continue <run-id> --mode=lite "..."` | 从历史 run 创建小范围正式轻量实现 run | 复用来源证据，并强制 formal lite |
| `npx crewup continue <run-id> --mode=strict "..."` | 从历史 run 创建完整延续交付 run | 复用来源证据，并强制 strict |
| `npx crewup continue <run-id> --mode=plan "..."` | 从历史 run 创建延续规划 run | 复用来源证据，并强制 plan |

真实创建 run 时，普通 `npx crewup run "..."` 会按请求内容选择保守默认 profile，并打印选中的 mode/profile。普通 `npx crewup continue <run-id> "..."` 会结合新请求和来源 run 证据选择 continuation 默认值。用户仍可显式选择 `--mode=plan|lite|strict|discovery`，或让旧自动化显式传入 `--profile`。`--profile` 只保留给旧脚本兼容。

## 命令分层

- Tier 1 日常主路径：`doctor`、`init`、`check`、`run --mode=...`、`status`、`explain`、`drive`、`finish`、`archive`、`cancel`、`continue`。
- Tier 2 strict 操作命令：`next-agent`、`clarify`、`native-state diagnose`、`native-state reconcile-results`、`audit`、`gate-check`、`report`、`preview-smoke`、`dev-service`。
- Tier 3 内部流水线：`prepare-run`、`spec-freeze`、`context-pack`、`agent-plan/native-plan`、`transition`、`changed-files`、`archive-commit`、`token-ledger`、`knowledge-select`。
- Tier 4 可选能力：`tool-fallback`、`knowledge`、`dashboard`、`product-sync`、`learn`、`learn-promote`。
- Tier 5 兼容和维护：`repair-plan`、`repair-state`。

普通使用者可以把 Tier 3 到 Tier 5 从日常心智里拿掉。它们不应该作为开始工作的入口，也不应该用来绕过 owner agent、验证或 gate。

## 模式与固定产物

| 模式 | 内部 profile | 固定产物 | native plan | knowledge/report |
| --- | --- | --- | --- | --- |
| 默认 `lite-v2` | `lite-v2` | `spec.md`、`tasks.md`、`validation.md`、`summary.md`、`RUN_STATUS.md`、`RUN_SUMMARY.md` | 否 | finish/archive 时刷新 |
| `lite` | `lite` | strict 风格 run 文件，但使用更短预算和 delegated tester/reviewer/release 证据 | 是 | finish/archive 时刷新 |
| `strict` | `standard` | `input.md`、`state.json`、`tasks/`、`artifacts/`、`logs/native-subagents/`、`RUN_STATUS.md`、`RUN_SUMMARY.md` | 是 | finish/archive 时刷新 |
| `strict --risk=high` | `full` | 同 `strict`，但使用更强证据要求 | 是 | finish/archive 时刷新 |
| `plan` | `plan_only` | `planning.md`、`acceptance.md`、`architecture-plan.md`、`implementation-plan.md`、`review.md`、`validation.md`、`summary.md` | 只用于规划/评审角色 | finish/archive 时刷新 |
| `discovery` | `discovery` | `discovery.md`、`module-map.md`、`tech-map.md`、`risk-map.md`、`next-runs.md`、`review.md`、`summary.md` | 只用于发现/评审角色 | finish/archive 时刷新 |

所有 CrewUp run 都应该进入报告和知识索引，包括 blocked、partial、failed、canceled。模式差异是固定产物和完成标准不同；无 mode 时的默认选择必须由 CLI 打印出来，避免 AI 隐式改变路径。

## 聊天怎么说

- `使用 CrewUp lite，修复这个低风险 UI 问题，完成验证和 summary。`
- `使用 CrewUp strict，新增评论系统，走完整多 agent 工作流。`
- `使用 CrewUp strict，高风险，新增权限系统。`
- `使用 CrewUp plan，只规划，不写代码。`
- `使用 CrewUp discovery，盘点项目结构和后续 run。`
- `继续这个 run，使用 CrewUp lite，只修复这个运行时 bug。`
- `继续这个 plan run，使用 CrewUp strict，按已批准计划完整实现。`

主 agent 不应该在聊天里发明隐藏模式语义。用户明确进入 CrewUp 但没有指定模式时，可以让 CLI 选择文档化默认值，并把选中的 mode/profile 汇报给用户。如果用户只是说“帮我改一下”，且没有 CrewUp 信号，就按普通对话或普通代码任务处理，不创建 run。

## 完成标准

`lite` 完成：

- 四个根文件都存在：`spec.md`、`tasks.md`、`validation.md`、`summary.md`。
- `validation.md` 写清验证发现依据、真实执行的命令/检查、结果和证据。
- `summary.md` 写清改动、验证结论、剩余风险和可检查路径。
- `validation.md` 和 `summary.md` 不再是 pending 占位。
- 没有发现必须升级 strict 的高风险范围。

`strict` 完成：

- requirements-plan、requirements、architect 按顺序完成。
- `implementation-plan.md` 明确分配实际 implementation owner。
- 只有被分配的 implementation owner 必须完成，未分配候选不阻塞收口。
- tester 在被分配的实现 owner 完成后运行。
- reviewer 在 tester 完成后运行。
- tester/reviewer 的 required fixes 已回派 owner 并解决。
- audit、gate-check、report、finish 通过。
- 主 agent 没有越权写业务代码或 owner artifact。

`plan` 完成：

- 固定规划文件全部存在且不再 pending。
- 没有业务代码改动。
- acceptance、architecture、implementation owner、风险和下一步 run 边界清晰。
- review 已检查计划缺口。

`discovery` 完成：

- 固定盘点文件全部存在且不再 pending。
- 没有业务代码改动。
- module-map、tech-map、risk-map 足够支持后续路由。
- `next-runs.md` 写清建议后续 run 和模式。

## 卡住与失败

```bash
npx crewup explain <run-id>
npx crewup next-agent <run-id> --json
npx crewup drive <run-id>
```

| action | 含义 | 处理 |
| --- | --- | --- |
| `spawn` | 有且只有一个安全 next agent | 只启动 `next` 指定 agent |
| `wait` | 有 active agent 且仍有近期进度 | 等待，不重启 |
| `stale` | 无 result 且无近期 progress | 只追问一次 result-only closeout，然后 diagnose/reconcile |
| `repair` | tester/reviewer 要求修复 | 跑 `repair-plan`，回派 owner |
| `blocked` | 前置条件或状态证据缺失 | 先诊断，不强行 finish |
| `done`/`closed` | 已关闭 | 不继续改这个 run，后续用 continuation |

未达到完成标准就不能叫 done。可恢复时保持 open，修复证据或 owner 结果后再 `finish`。如果用户接受部分结果，记录 `partial`。如果环境、登录、权限或 runner 阻塞，记录 `blocked`。非 success 默认不 close，除非用户明确要求 `--close`。

## 未完整归档怎么办

未完整归档但仍 open 的 run，可以继续迭代同一个需求。也可以开始另一个独立需求，但如果两个需求范围重叠，会造成 owner、knowledge 和后续报告不清晰。

相同需求优先修当前 run。已关闭后再用 `continue` 创建 continuation。未归档的代价是 dashboard 仍显示 active，knowledge 可能没有最终经验，后续 run 缺少干净的前置证据。
