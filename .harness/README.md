# Harness Template

`.harness/` is the reusable CrewUp workflow layer. It can be installed into any target project and then adapted with `crewup init`.

## Boundaries

- `.harness/config/`, `.harness/agents/`, `.harness/rules/`, `.harness/contracts/`, `.harness/templates/`, and `.harness/scripts/` are reusable workflow core.
- `.harness/project/` is generated target-project adaptation.
- `.harness/runs/`, `.harness/reports/`, `.harness/knowledge/`, and `.harness/dashboard/` are runtime/state directories.
- Project source code, product docs, application directories, package directories, and historical run output are not part of the reusable template.

## Initialize In A Target Project

Prefer the CLI in installed projects:

```bash
npx crewup doctor
npx crewup inspect --no-ai
npx crewup init --agent codex --yes
npx crewup check
```

Inside this source repository, package scripts are also available:

```bash
npm run harness:inspect -- --no-ai
npm run harness:init -- --agent codex --yes
npm run harness:check
```

## Core Workflow

```text
intake -> requirements-plan -> requirements -> architect
  -> implementation agents -> tester -> reviewer -> release -> done
```

The main agent coordinates, registers results, runs gates, and summarizes. Formal artifacts and business code are written by owner agents.

## Modes And Defaults

CrewUp runs may use an explicit public mode, or they may let the CLI choose a documented default profile. The selected mode/profile is printed during run creation so file layout, completion rules, and archive expectations stay visible.

```bash
npx crewup run "Fix a small UI issue and discover/run the necessary project validation"
npx crewup run --mode=lite "Fix a small UI issue and discover/run the necessary project validation"
npx crewup run --mode=strict "Add a feature through formal multi-agent delivery"
npx crewup run --mode=strict --risk=high "Add a high-risk permission system"
npx crewup run --mode=plan "Plan the comments feature; do not write code"
npx crewup run --mode=discovery "Map this project and propose next runs"
```

`--profile` remains a compatibility alias for existing automation, but user-facing docs and chat prompts should use `--mode`.

## Lite Lightweight Paths

`lite-v2` is the default direct lightweight path for low-risk, scoped implementation tasks when no mode/profile is provided.

```bash
npx crewup run "Fix a small UI issue and discover/run the necessary project validation"
```

It creates `spec.md`, `tasks.md`, `validation.md`, and `summary.md` directly under the run directory, does not create native subagent tasks, and does not require strict owner-artifact provenance. `finish` requires `validation.md` and `summary.md` to be updated from pending template state before success archive.

Use explicit `--mode=lite` when you want a formal lightweight run with delegated tester/reviewer/release evidence and shorter budgets than strict.

## Operational Notes

- Use `next-agent` before spawning any subagent.
- Use `drive` to reconcile state, classify the next action, and run scriptable closeout steps.
- Record optional tool failures with `tool-fallback`.
- Route tester/reviewer fixes back to owner agents.
- Run `audit`, `gate-check`, and `report` before closing retained subagents when capacity allows.
- Active owner artifacts should be repaired by their owner agent first; use `repair-state` only for audited lifecycle/state repair.
- Use `learn` to extract candidate lessons from real run evidence, then `learn-promote` to explicitly promote only useful lessons into Memory Hints.
- Keep the public command surface small; daily work should stay on `run`, `status/explain/drive`, `next-agent`, gates, report, finish, archive, cancel, and continue.

## Memory Hints

CrewUp stores reusable lessons under `.harness/knowledge/lessons/`, but candidates do not automatically affect future runs. Promote only lessons that are short, evidence-backed, and likely to prevent repeated mistakes:

```bash
npx crewup learn <run-id>
npx crewup learn-promote <lesson-id>
```

Promoted hints are selected by relevance so future runs reuse compact guidance instead of loading full historical logs.
