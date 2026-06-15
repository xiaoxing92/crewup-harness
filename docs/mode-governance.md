# CrewUp 模式治理说明

CrewUp 允许 CLI 为真实 run 选择文档化默认 profile，但不允许 AI 在聊天里发明隐藏模式语义。用户可以在 CLI 或聊天里明确指定模式；没有指定时，CLI 会打印自动选择的 mode/profile，因为不同模式会生成不同文件，也有不同完成标准。

## 公开模式

| 模式 | CLI | 聊天说法 | 内部 profile | 适合 |
| --- | --- | --- | --- | --- |
| 默认小任务 | `npx crewup run "..."` | `使用 CrewUp ...` 且未说明模式 | `lite-v2` | 低风险、小范围直接实现 |
| `lite` | `npx crewup run --mode=lite "..."` | `使用 CrewUp lite ...` | `lite` | 需要 delegated tester/reviewer/release 证据的正式轻量实现 |
| `strict` | `npx crewup run --mode=strict "..."` | `使用 CrewUp strict ...` | `standard` | 正式多 agent 交付 |
| `strict high risk` | `npx crewup run --mode=strict --risk=high "..."` | `使用 CrewUp strict，高风险 ...` | `full` | 权限、数据库、部署、安全、多模块大改 |
| `plan` | `npx crewup run --mode=plan "..."` | `使用 CrewUp plan，只规划，不写代码 ...` | `plan_only` | 只产出计划，不改业务代码 |
| `discovery` | `npx crewup run --mode=discovery "..."` | `使用 CrewUp discovery，盘点项目 ...` | `discovery` | 盘点结构、模块、技术栈、风险和后续 run |

`--profile` 只保留给旧脚本兼容。真实创建 run 时，普通 `npx crewup run "..."` 会按请求内容选择保守默认值并创建 run；`--dry-run` 可以不带 mode。

## 无模式时会发生什么

CrewUp 会根据请求内容选择保守默认值，并在输出里明确打印选中的 mode/profile。

```bash
npx crewup run "做一个博客中文化改造"
npx crewup continue <run-id> "继续实现"
```

这两类命令都会创建真实 run。小范围低风险实现通常默认走 `lite-v2`；宽范围、高风险或明确要求完整交付时默认走 strict/full。用户想强制某条路径时，再执行带 `--mode=...` 或 `--profile=...` 的命令。

从 `plan` run 继续时，选择含义是：

- `--mode=plan`：继续细化计划，不改代码。
- `--mode=lite`：只实现计划里一个小阶段。
- `--mode=strict`：按已批准计划做完整交付。

详细说明见 [模式选择器](./mode-picker.md)。

## 每种模式生成什么

| 模式 | 固定生成文件 | native subagent plan | knowledge/report |
| --- | --- | --- | --- |
| 默认 `lite-v2` | `spec.md`、`tasks.md`、`validation.md`、`summary.md`、`RUN_STATUS.md`、`RUN_SUMMARY.md` | 否 | finish/archive 时刷新 |
| `lite` | strict 风格 run 文件，但使用更短预算和 delegated tester/reviewer/release 证据 | 是 | finish/archive 时刷新 |
| `strict` | `input.md`、`state.json`、`tasks/`、`artifacts/`、`logs/native-subagents/`、`RUN_STATUS.md`、`RUN_SUMMARY.md` | 是 | finish/archive 时刷新 |
| `strict --risk=high` | 同 `strict`，但使用 full profile 和更强证据要求 | 是 | finish/archive 时刷新 |
| `plan` | `planning.md`、`acceptance.md`、`architecture-plan.md`、`implementation-plan.md`、`review.md`、`validation.md`、`summary.md` | 只用于规划/评审角色 | finish/archive 时刷新 |
| `discovery` | `discovery.md`、`module-map.md`、`tech-map.md`、`risk-map.md`、`next-runs.md`、`review.md`、`summary.md` | 只用于发现/评审角色 | finish/archive 时刷新 |

## 怎么算完成

默认 `lite-v2` 完成：

- 四个核心文件存在，`validation.md` 和 `summary.md` 不再是 pending。
- 验证记录包含真实命令、结果和证据。
- 没有发现必须升级 strict 的高风险范围。

`lite` 完成：

- requirements-plan、requirements、architect、implementation、tester、reviewer、release 按正式轻量契约完成。
- 文档和上下文预算比 strict 更短，但 delegated evidence 必须完整。
- audit、gate-check、report、finish 通过。

`strict` 完成：

- requirements-plan、requirements、architect 按顺序完成。
- `implementation-plan.md` 明确分配实际实现 owner。
- 只有被分配的实现 agent 需要完成，未分配候选不阻塞收口。
- tester 在实现完成后运行，reviewer 在 tester 完成后运行。
- required fixes 已回派 owner 并修复。
- audit、gate-check、report、finish 通过，主 agent 没有越权。

`plan` 完成：

- 固定规划文件全部存在并非 pending。
- 没有业务代码改动。
- acceptance、architecture、owner、风险和下一步 run 边界清晰。

`discovery` 完成：

- 固定盘点文件全部存在并非 pending。
- 没有业务代码改动。
- 项目地图和风险地图足够支持后续路由。
- `next-runs.md` 写清建议后续 run 和模式。

## 怎么查看状态

```bash
npx crewup status <run-id>
npx crewup explain <run-id>
npx crewup next-agent <run-id> --json
npx crewup drive <run-id>
```

| action | 含义 | 处理方式 |
| --- | --- | --- |
| `spawn` | 有下一个可启动 agent | 只启动 `next` 指定 agent |
| `wait` | active agent 最近有活动 | 等待，不重启 |
| `stale` | 没有 result，也没有最近 progress | 只追问一次 result-only closeout，然后 diagnose/reconcile |
| `repair` | tester/reviewer 要求修复 | 跑 `repair-plan`，回派 owner |
| `blocked` | 前置条件或状态缺失 | 先诊断，不盲目重启 |
| `done`/`closed` | 已关闭 | 后续使用 continuation |

## 卡住、失败、未归档怎么办

未达到完成标准就不能叫 done。

- 可恢复时保持 open，修复证据或 owner 结果后再 `finish`。
- 结果文件存在但状态没登记时，先 `native-state reconcile-results`。
- handle/result 异常时，先 `native-state diagnose`。
- 长时间无结果时，只追问同一个 agent 一次 result-only closeout；仍无结果就记录 blocked。
- 环境、登录、权限或 runner 不可用时，记录 blocked 并默认保持 open。
- 用户接受部分结果时，记录 partial 并默认保持 open。
- 用户明确放弃或要求关闭时，才使用 `--close`。

同一需求优先继续当前 open run。独立需求可以创建另一个 run；已关闭需求的后续工作使用 `continue`。

## strict 稳定策略

- 子 agent 应更新 `logs/native-subagents/<agent>.progress.md`。
- 有近期 progress 时保持 wait，不误判 stale。
- stale 后只追问一次，再 diagnose/reconcile，不无限等待或重启。
- 未分配的 implementation 候选不阻塞收口。
- tester/reviewer 只会在被分配的实现 owner 完成后变成 runnable。
