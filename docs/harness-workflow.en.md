# Harness Workflow

English | [harness-workflow.md](./harness-workflow.md)

CrewUp is explicit opt-in. Without a clear CrewUp/harness/run signal, the chat stays outside the harness. Once CrewUp is active, the strict loop applies and the main agent only orchestrates, delegates, checks gates, and summarizes.

There are two valid entries:

- CLI entry: the user runs `npx crewup run --mode=<lite|strict|plan|discovery> "..."`.
- Chat entry: the user explicitly asks to use CrewUp. In this case, the main agent runs `npx crewup run` itself, extracts the runId, then continues with `next-agent`.

The chat entry should not require the user to manually create a runId first.

Prefer `npx crewup ...` in target projects because freshly installed projects may not have `npm run harness:*` scripts in `package.json`.

## Execution Prerequisites

CrewUp can create runs, tasks, context packs, audits, and gates without an API key. Real AI subagent execution requires the selected agent environment to be configured:

- `codex` native mode requires a Codex environment that can launch subagents. Codex Desktop / CLI may use its own login state; SDK/API paths and `inspect --ai` require `OPENAI_API_KEY`.
- `claude`, `cursor`, and `trae` currently use bridge mode. Those tools use their own authentication and must write CrewUp-compatible result JSON files back into the run.
- `manual` mode needs no AI key; a human or external tool executes the handoff and writes result JSON.

If native tools or model access are unavailable, record fallback and stop formal delegated work. Fallback does not authorize the main agent to write owner artifacts or business code.

## Language And Contracts

- Human-facing coordination follows the user's primary language: status updates, blockers, handoffs, subagent summaries, and final user-facing explanations.
- Harness-owned contracts stay English: artifact headings, JSON fields, file paths, commands, status values, and schema-owned labels.
- This split keeps the user experience natural while avoiding encoding drift and false gate failures in machine-checked artifacts.

## Operating Model

CrewUp splits AI engineering work into three layers:

- Run state: `.harness/runs/<run-id>/` stores input, state, tasks, context packs, subagent results, services, reports, and archive logs.
- Role-owned artifacts: each formal artifact has an owner agent.
- Gates: transitions check artifact schema, provenance, native results, changed files, feedback loops, service shutdown, and archive readiness.

## Strict Flow

```text
intake -> requirements_plan -> requirements_confirm -> plan
  -> implement -> verify -> review -> release -> done
```

Explicit strict requests stay on the strict workflow. The harness does not reduce cost by silently skipping roles; it reduces repeated work through clearer task contracts, narrower generated prompts, and stricter result schemas. When no mode is provided, CrewUp may choose the documented direct `lite-v2` default for narrow low-risk work; explicit `--mode=lite` remains a formal lightweight workflow.

Negation-aware routing only removes false-positive scope. If the user says `no backend/database/auth/routing` or `不需要 backend、database、auth、routing`, CrewUp should not spawn backend/database owner agents just to confirm they are irrelevant. This does not weaken the strict workflow for the remaining real scope.

## Lite Lightweight Flows

`lite-v2` is the default direct lightweight path for low-risk, scoped implementation work where native subagent provenance would be heavier than the task itself.

```bash
npx crewup run "Fix a small UI issue and discover/run the necessary project validation"
```

Its run shape is:

```text
input.md
spec.md
tasks.md
validation.md
summary.md
state.json
RUN_STATUS.md
```

`lite-v2` does not generate native subagent tasks, does not create `native-subagent-plan.json`, and does not require `requirements-plan -> requirements -> architect -> tester -> reviewer -> release`. The main agent may implement directly inside the scoped task. `finish` checks that `validation.md` and `summary.md` are no longer pending before archiving success.

Use explicit `--mode=lite` when you want a formal lightweight run with delegated tester/reviewer/release evidence and shorter budgets than strict.

Use strict or `strict --risk=high` instead for database, auth, security, deploy, cross-module, or audit-heavy work.

Detailed guide: [Lite Lightweight Flow](./lite-v2.en.md).

## Run Lifecycle

CrewUp's only default work unit is a `Run`. Backlog is not part of the core workflow.

Each run has:

- `.harness/runs/<run-id>/state.json`
- `.harness/runs/<run-id>/RUN_STATUS.md`
- `.harness/runs/<run-id>/RUN_SUMMARY.md` after archive
- `.harness/reports/<run-id>.md` after report/archive

Run statuses:

| Status | Meaning |
| --- | --- |
| `active` | Work is in progress |
| `waiting_user` | Waiting for user confirmation |
| `blocked` | Blocked but evidence is preserved |
| `partial` | Partially useful but not done |
| `done` | Fully completed |
| `canceled` | User canceled |
| `failed` | Execution failed |

Blocked does not mean archived. `blocked` keeps the current run open by default so the owning agent can continue repair. `archive --close` means the user explicitly closes a non-success state. Archive also does not mean success; only a `success` outcome represents full completion.

```bash
npx crewup status
npx crewup status <run-id>
npx crewup next-agent <run-id>
npx crewup archive <run-id> --outcome=blocked --reason="..." --close
npx crewup cancel <run-id> --reason="..."
npx crewup continue <run-id> "continue from the previous blocker"
```

A formal run has a stable front door:

```text
requirements-plan first, always
```

Implementation agents must not start just because the request looks small.

`requirements-plan` owns interactive clarification. It should first write a Markdown clarification card in `requirement-plan.md`, using compact tables and short lists for confirmed facts, needed decisions, non-goals, and acceptance preview. If key decisions are missing, it returns `needs_input` with structured `clarificationQuestions`. The main agent is only the interaction transport: it should show a compact confirmation card or guide the user to `crewup clarify --interactive`, not paste a long questionnaire into chat. Text fallback should use `A/B/C/D/E...` letter choices and keep one `Other` option when the decision is not exhaustive. The main agent must not silently choose defaults or write requirement artifacts.

Use this command to render the questions:

```bash
npx crewup clarify <run-id>
```

For a real terminal, use keyboard interaction:

```bash
npx crewup clarify <run-id> --interactive
```

This writes `.harness/runs/<run-id>/logs/clarifications/answers.json` and `answers.md`. Hosts with native Plan-mode choice UI, such as Codex when available, can map `clarificationQuestions` directly to that UI. Cursor, Claude, Trae, manual, and bridge environments use the same JSON contract through `clarify --interactive`. Text-choice chat fallback must stay compact and use letter choices, not `1/2/3` numeric choices.

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

The main agent must not copy subagent text into owner artifacts. If an owner agent fails to write the artifact, the run should be repaired, blocked, or resumed with that owner agent.

`repair-artifacts` has been removed. Owner artifacts must be repaired by their owner agent first; use `repair-state` only for audited lifecycle/state repair.

## Native Subagent Path

```bash
npx crewup context-pack <run-id> --agents=<agents>
npx crewup native-plan <run-id> --agents=<agents>
npx crewup next-agent <run-id>
npx crewup native-state <run-id> status
```

The main agent should use `next-agent` before spawning. It returns only agents whose prerequisites are complete and lists blocked agents with missing upstream results. The main agent then uses `spawn_agent`, `wait_agent`, and `close_agent` where available.

Native-state mutations must be serial. Do not run `mark-spawned`, `mark-result`, or close-state commands in parallel for the same run.

`native-state mark-spawned` enforces upstream prerequisites. For example, `architect` cannot be marked spawned until `requirements-plan` and `requirements` have completed and their results have been captured. This is the required harness ordering:

```text
requirements-plan -> requirements -> architect -> implementation agents -> tester -> reviewer -> release
```

The main agent may prepare tasks and native plans ahead of time, but it must not start downstream agents before their prerequisite results are captured.

Implementation agents require `artifacts/implementation-plan.md` to exist and assign their exact agent id. A missing implementation plan is a blocker, not permission to start coding.

`gate-check` also audits owner artifacts. If `artifacts/requirement-plan.md`, `artifacts/requirement.md`, `artifacts/architecture.md`, or other owner artifacts appear before the owner agent has completed and reported them through `artifactUpdates`, the gate fails. This keeps the main agent in an orchestration role instead of letting it fill formal artifacts directly.

Technical reference gathering follows the same ownership rule. The main agent may record minimal source links, local evidence, and fallback notes, but `architect` owns technical synthesis, trade-off analysis, and final technology recommendations.

## Tool Fallback Log

Context7, MCP servers, plugins, Playwright, Browser, CodeGraph, and similar integrations are optional enhancements. If one is unavailable, record it in the run instead of only mentioning it in chat:

```bash
npx crewup tool-fallback <run-id> --tool Context7 --reason "not available in this session" --fallback "architect uses project evidence and checked-in docs"
```

Tool fallback logs are evidence only. They do not transfer an owner agent's responsibility to the main agent.

## Orchestration Audit

Use `audit` when you want a direct stability check for the workflow itself:

```bash
npx crewup audit <run-id>
```

`audit` checks dispatch order, premature downstream starts, implementation agents that were not assigned by `implementation-plan.md`, owner artifacts without owner provenance, tester/reviewer feedback that still needs delegated repair, retained subagent pressure, and large context/token budgets.

`gate-check` answers "can this run pass the quality gate?". `audit` answers "is the orchestration staying clean, calm, and delegated?". A clean audit writes `logs/orchestration-audit.md` and `logs/orchestration-audit.json`.

Before closing retained subagents, prefer:

```text
audit -> gate-check -> report -> mark-ready-to-close -> close_agent -> mark-closed
```

The normal exception is capacity pressure. If the environment cannot keep enough agents open to continue, use `native-state recommend-close`, release the lowest-value retained agents, and record the reason.

## Artifact Contract

Core artifacts use English headings to avoid encoding drift. For example, `requirement.md` must include:

- `## Background`
- `## Goals`
- `## Non-Goals`
- `## Acceptance Criteria`
- `## Impact Scope`
- `## Test Requirements`
- `## Rollback Strategy`

Acceptance criteria should use `AC-01`, `AC-02`, and so on.

## Tester And Reviewer Contracts

Tester frontend/local MVP baseline:

- non-blank page
- add/create behavior
- persistence after refresh
- complete/toggle behavior
- completed state persistence after refresh
- delete behavior
- delete-after-refresh does not restore deleted data
- empty input rejection
- desktop viewport
- mobile viewport
- build command
- dev service shutdown

Reviewer pass format:

```markdown
## Conclusion

- [x] pass

## Blocking Issues

- none
```

This avoids false-positive release gates caused by ambiguous blocking wording.

## Repair Tools

```bash
npx crewup native-state <run-id> diagnose
npx crewup repair-plan <run-id>
```

- `native-state diagnose` reports missing handles, uncaptured result files, invalid JSON, and state/result mismatches.
- `repair-plan` reads tester/reviewer `requiredFixes` and creates owner repair tasks under `tasks/repairs/`.

Repair result JSON should preserve lineage when it supersedes an earlier result:

```json
{
  "repairOf": ["RF-01", ".harness/runs/<run-id>/logs/native-subagents/frontend.result.json"],
  "repairReason": "tester reported a blocking issue",
  "previousResultPath": ".harness/runs/<run-id>/logs/native-subagents/frontend.result.json"
}
```

## Release Validation

```bash
npm run release:preflight
```

This runs harness checks, example tests, temporary pack-install flow tests, and `npm pack --dry-run`.
