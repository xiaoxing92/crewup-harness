# Harness Workflow

CrewUp keeps the reusable workflow core under `.harness/` and generates project-specific adaptation under `.harness/project/`.

## Core flow

```text
doctor -> install -> inspect -> init -> check -> run -> verify -> review -> finish
```

## What the core owns

- orchestration rules
- agent roles
- policies
- validation
- templates
- runtime scripts

## What the project owns

- detected package manager
- repo shape and module map
- language-specific rules
- testing rules
- domain rules

## What a run should produce

- input
- state
- tasks
- artifacts
- logs
- summary report

## Lite-v2 default run shape

`lite-v2` is the default direct lightweight profile for low-risk scoped tasks when no mode/profile is provided:

```bash
npx crewup run "Fix a small UI issue and discover/run the necessary project validation"
```

It produces root-level lightweight evidence instead of strict owner artifacts:

- `spec.md`
- `tasks.md`
- `validation.md`
- `summary.md`

It does not create native subagent tasks or `native-subagent-plan.json`. The strict workflow remains unchanged for standard and full runs. Use explicit `--mode=lite` when you want formal lightweight delegation with tester/reviewer/release evidence.

## Close rule

Do not call a run complete until the workflow has a report, verification, review, and archive decision.

For `lite-v2`, closeout means `validation.md` and `summary.md` are updated from pending template state and `crewup finish <run-id>` archives `outcome=success`.
