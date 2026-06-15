# CrewUp 模式默认值

[English](./mode-picker.en.md) | 中文

CrewUp 仍然是显式启用：普通聊天不会自动进入 harness。只有用户要求使用 CrewUp、运行 `crewup run`，或继续已有 CrewUp run 时，才进入正式流程。

进入 CrewUp 后，如果 `run` / `continue` 没有传 `--mode` 或 `--profile`，CrewUp 会根据请求选择保守默认 profile。

## 默认选择

| 场景 | 默认 profile | 原因 |
| --- | --- | --- |
| 小范围低风险修复、UI/copy、单个 bug | `lite-v2` | 直接范围内实现比 native subagent 调度更轻 |
| 明确只规划/不写代码 | `plan_only` | 不应修改业务代码 |
| 完整功能、完整闭环、明确 strict | `standard` 或 `full` | 需要委派证据 |
| 安全、认证、数据库、部署等高风险 | `full` | 需要更强门禁 |

## 显式覆盖

想指定交付契约时使用：

```bash
npx crewup run --mode=plan "规划评论系统，不写代码"
npx crewup run --profile=lite-v2 "修复登录按钮文案"
npx crewup run --mode=lite "修复一个小 UI bug，并保留委派验证"
npx crewup run --mode=strict "实现评论系统"
```

延续 run：

```bash
npx crewup continue <run-id> "修复后续 runtime bug"
npx crewup continue <run-id> --mode=lite "用委派验证继续"
npx crewup continue <run-id> --mode=strict "用完整流程继续"
```

## 产品规则

没有 CrewUp 信号，就不创建正式 run。

没有显式 mode 不再阻止创建 run。CrewUp 会选择默认值，输出选中的 mode/profile；用户仍可用 `--mode` 或 `--profile` 覆盖。
