# CrewUp lite-v2 直接轻量流程

[English](./lite-v2.en.md) | 中文

`lite-v2` 是 CrewUp 的直接轻量 profile。现在当 `run` 或 `continue` 没有显式 mode/profile，且请求属于小范围低风险工作时，会默认使用它。

需要强制走这条直接轻量路径时，可以使用 `--profile=lite-v2`。

## 适用场景

适合：

- UI 样式、布局、文案、空状态、移动端适配。
- 单模块 bug 修复。
- 范围明确、native subagent provenance 成本高于收益的小改动。

如果你希望保留委派式 tester/reviewer/release 证据，但不想走完整 strict 规划链，用 `--mode=lite`。

数据库、认证、安全、部署、跨模块或审计要求高的任务，使用 `--mode=strict` 或 `--mode=strict --risk=high`。

## 启用方式

小任务默认路径：

```bash
npx crewup run "修复 Admin 文章列表移动端横向溢出，并发现/运行验证"
```

显式指定直接轻量：

```bash
npx crewup run --profile=lite-v2 "修复一个小 UI 问题"
npx crewup run --profile=lite_v2 "修复一个小 UI 问题"
```

聊天中：

```text
使用 CrewUp。修复这个小 runtime bug，并运行必要验证。
```

## 生成文件

`lite-v2` run 会创建根级轻量文件：

```text
.harness/runs/<run-id>/
  input.md
  spec.md
  tasks.md
  validation.md
  summary.md
  state.json
  RUN_STATUS.md
```

它不会创建 native subagent task，也不会创建 `logs/native-subagents/native-subagent-plan.json`。

## 收口规则

`finish` 会检查：

- `spec.md` 存在。
- `tasks.md` 存在。
- `validation.md` 存在且不再是 pending。
- `summary.md` 存在且不再是 pending。

验证失败时不要强制 success。记录失败，继续修复，或归档为 blocked/partial。

## 与 formal lite / strict 的区别

| 能力 | lite-v2 | `--mode=lite` | strict |
| --- | --- | --- | --- |
| 小任务默认 | 是 | 否 | 否 |
| 主 agent 范围内写代码 | 允许 | 不允许，交给 owner agent | 不允许，必须 owner agent |
| Native subagents | 无 | 有，较短正式链 | 有，完整链 |
| tester/reviewer/release | 无 | 有 | 有 |
| 适合 | 低风险直接改动 | 小任务但需要委派证据 | 审计/完整交付 |

## 维护规则

- 不要把 `lite-v2` success 描述成 strict audit success。
- 不要跳过验证证据。
- 需要委派证据时升级到 `--mode=lite` 或 `--mode=strict`。
