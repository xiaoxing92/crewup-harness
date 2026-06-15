# CrewUp Mode Defaults

[中文](./mode-picker.md) | English

CrewUp is still explicit opt-in: normal chat does not enter the harness unless the user asks for CrewUp, runs `crewup run`, or continues an existing CrewUp run.

Once CrewUp is active, `run` and `continue` may infer a conservative default profile when `--mode` or `--profile` is omitted.

## Defaults

| Case | Default profile | Why |
| --- | --- | --- |
| Small low-risk fix, UI/copy tweak, single bug | `lite-v2` | Direct scoped implementation is cheaper than native subagent orchestration |
| Plan/no-code wording | `plan_only` | Business code should not change |
| Broad feature, full loop, explicit strict wording | `standard` or `full` | Needs delegated evidence |
| High-risk security/auth/database/deploy wording | `full` | Needs stronger gates |

## Overrides

Use these when you want a specific contract:

```bash
npx crewup run --mode=plan "Plan a comment system; do not write code"
npx crewup run --profile=lite-v2 "Fix the login button copy"
npx crewup run --mode=lite "Fix a small UI bug with delegated verification"
npx crewup run --mode=strict "Build a comment system"
```

For continuations:

```bash
npx crewup continue <run-id> "Fix the follow-up runtime bug"
npx crewup continue <run-id> --mode=lite "Continue with delegated verification"
npx crewup continue <run-id> --mode=strict "Continue with the full workflow"
```

## Product Rule

No CrewUp signal means no formal run.

No explicit mode no longer blocks run creation. CrewUp chooses a default, prints the selected mode/profile, and still lets users override with `--mode` or `--profile`.
