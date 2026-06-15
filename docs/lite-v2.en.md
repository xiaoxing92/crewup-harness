# CrewUp Lite-v2 Direct Lightweight Flow

English | [中文](./lite-v2.md)

`lite-v2` is the direct lightweight CrewUp profile. It is now the default for small low-risk work when `run` or `continue` has no explicit mode/profile.

Use `--profile=lite-v2` when you want to force this direct path.

## When To Use It

Good fits:

- UI styling, layout, copy, empty states, and mobile responsiveness.
- Single-module bug fixes.
- Small scoped changes where native subagent provenance would cost more than the task.

Use `--mode=lite` instead when you want delegated tester/reviewer/release evidence without the full strict planning chain.

Use `--mode=strict` or `--mode=strict --risk=high` for database, auth, security, deploy, broad cross-module, or audit-heavy work.

## How To Enable

Default small-work path:

```bash
npx crewup run "Fix the Admin article list mobile overflow and discover/run validation"
```

Explicit direct-lightweight override:

```bash
npx crewup run --profile=lite-v2 "Fix a small UI issue"
npx crewup run --profile=lite_v2 "Fix a small UI issue"
```

In chat:

```text
Use CrewUp. Fix this small runtime bug and run the necessary validation.
```

## What It Generates

A `lite-v2` run creates root-level lightweight files:

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

It does not create native subagent task files or `logs/native-subagents/native-subagent-plan.json`.

## Closeout Rules

`finish` checks that:

- `spec.md` exists.
- `tasks.md` exists.
- `validation.md` exists and is no longer pending.
- `summary.md` exists and is no longer pending.

If validation fails, do not force success. Record the failure, repair, or archive as blocked/partial.

## Difference From Formal Lite And Strict

| Capability | lite-v2 | `--mode=lite` | strict |
| --- | --- | --- | --- |
| Default for small work | Yes | No | No |
| Main agent writes scoped code | Allowed | No; owner agents do implementation | No; owner agents required |
| Native subagents | No | Yes, reduced formal chain | Yes, full chain |
| Tester/reviewer/release | No | Yes | Yes |
| Best for | Low-risk direct changes | Small work needing delegated evidence | Audited/full delivery |

## Maintenance Rules

- Do not describe `lite-v2` success as strict audit success.
- Do not skip validation evidence.
- Escalate to `--mode=lite` or `--mode=strict` when delegated evidence is required.
