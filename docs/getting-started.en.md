# Getting Started

[中文](./getting-started.md) | English

This guide is for developers using CrewUp for the first time. CrewUp is a workflow harness, not a model provider. It creates runs, generates role tasks, keeps the main agent inside an orchestration boundary, checks gates, and writes reports. Actual subagent execution comes from the agent environment you choose.

## Prerequisites

- Node.js 20 or newer
- npm, pnpm, or yarn
- A Git repository; `git init` is recommended for real projects
- An agent environment: Codex, Claude, Cursor, Trae, or Manual
- Model access configured for the chosen tool if you want AI subagents to run

## API Keys And Subagents

CrewUp does not include an OpenAI API key and does not create model accounts for users.

If you choose `codex`:

- Codex Desktop / Codex CLI can use native subagents when the environment supports them.
- SDK/API orchestration, `inspect --ai`, or OpenAI API based automation requires `OPENAI_API_KEY`.
- Windows PowerShell:

```powershell
$env:OPENAI_API_KEY="sk-..."
```

- macOS / Linux:

```bash
export OPENAI_API_KEY="sk-..."
```

If you choose `claude`, `cursor`, or `trae`:

- The current path is bridge mode, not native multi-agent API support.
- CrewUp generates handoff files and result JSON contracts.
- The external tool uses its own login, API key, or subscription.
- After the external tool finishes, it must write back to `.harness/runs/<run-id>/logs/agent-bridge/<agent>.result.json`.

If you choose `manual`:

- No AI API key is required.
- CrewUp generates tasks, context, gates, and reports.
- A human or external tool executes the task and writes the result JSON.

## Install

In the target project:

```bash
npm install -D crewup-harness
npx crewup install
npx crewup init --agent codex --yes
npx crewup check
```

For existing repositories or monorepos, inspect first:

```bash
npx crewup inspect --no-ai
npx crewup init --agent codex --yes
```

Use AI-assisted inspection only after API access is configured:

```bash
npx crewup inspect --ai
```

## Check The Environment

```bash
npx crewup doctor
```

Look for:

- `.harness/` exists
- `.harness/project/profile.yaml` was generated
- `OPENAI_API_KEY` is set only when SDK/API mode or `inspect --ai` is needed
- selected agent environment matches what you expect

## Start A Run

CLI:

```bash
npx crewup run --mode=strict "Use CrewUp to build a tiny counter web app and run the full workflow. Acceptance criteria: page shows counter, initial value is 0, +1/-1/reset work, and value persists after refresh. Scope: tiny frontend only; no backend, database, auth, or routing. Discover and run the necessary validation from the project configuration."
```

Chat:

```text
Use CrewUp strict to build a tiny counter web app and run the full workflow. Acceptance criteria: page shows counter, initial value is 0, +1/-1/reset work, and value persists after refresh. Scope: tiny frontend only; no backend, database, auth, or routing. Discover and run the necessary validation from the project configuration.
```

When the user explicitly asks for CrewUp in chat, the user may name the mode. If no mode is named, the main agent can run `npx crewup run "<request>"` and let CrewUp print the selected default mode/profile. It should then extract the runId and continue orchestration with `next-agent` or `drive`.

If a real `run` or `continue` command omits `--mode`, CrewUp now chooses a conservative default and creates the run. Small low-risk work defaults to direct `lite-v2`; broad, risky, or explicitly strict work defaults to strict/full. Use `--mode` or `--profile` to override.

## Observe Dispatch

After you have a runId:

```bash
npx crewup status
npx crewup status <run-id>
npx crewup next-agent <run-id>
npx crewup audit <run-id>
npx crewup gate-check <run-id>
npx crewup report <run-id>
```

- `status` without a runId lists all runs, so you can find the runId.
- `status` reads `.harness/runs/<run-id>/RUN_STATUS.md` and shows the current status, stage, owner, next command, blockers, and reusable artifacts
- `next-agent` shows which subagent is actually runnable now; a formal run should initially expose only `requirements-plan`
- `audit` checks orchestration stability: premature starts, main-agent overreach, missing owner provenance, context pressure, and repair loops
- `gate-check` decides whether the current stage passes the quality gate
- `report` summarizes agent results, artifacts, context/token budgets, repair lineage, and archive status

## Normal Order

```text
requirements-plan
  -> requirements
  -> architect
  -> implementation agents selected by implementation-plan.md
  -> tester
  -> reviewer
  -> release
```

Implementation agents are candidates at run creation time. The actual implementation dispatch should be decided by the architect-owned `artifacts/implementation-plan.md`.

`lite` only means shorter requirements/architecture artifacts and smaller context budgets. It does not skip `requirements-plan -> requirements -> architect`. When `implementation-plan.md` is missing, implementation agents must remain blocked/skipped.

## Lightweight Runs

For low-risk, narrow tasks, you can omit mode and use the default direct `lite-v2` path:

```bash
npx crewup run "Fix a small frontend layout issue and discover/run the necessary project validation"
```

`lite-v2` creates `spec.md`, `tasks.md`, `validation.md`, and `summary.md` directly under the run directory. It does not create native subagent tasks or a native subagent plan. The main agent may implement directly inside the scoped task, then must update `validation.md` and `summary.md` before running:

```bash
npx crewup finish <run-id>
```

Use `--mode=lite` when you want a formal lightweight run with delegated tester/reviewer/release evidence. Use `strict` or `strict --risk=high` for database, auth, security, deploy, cross-module, or audit-heavy work.

Detailed guide: [Lite Lightweight Flow](./lite-v2.en.md).

## Tool Fallback

If Context7, an MCP server, a plugin, or another optional tool is unavailable, record it in the run instead of only mentioning it in chat:

```bash
npx crewup tool-fallback <run-id> --tool Context7 --reason "not available in this session" --fallback "use checked-in docs and architect synthesis"
```

This is evidence only. It does not authorize the main agent to take over work owned by architect, tester, reviewer, or implementation agents.

## Finish And Archive

Every formal task closes as a run. Common statuses:

| Status | Meaning |
| --- | --- |
| `active` | Work is in progress |
| `waiting_user` | Waiting for user confirmation or selection |
| `blocked` | Blocked, with evidence preserved |
| `partial` | Partially complete and reusable, but not done |
| `done` | Fully complete |
| `canceled` | Canceled by the user |
| `failed` | Execution failed |

Successful completion:

```bash
npx crewup report <run-id>
npx crewup finish <run-id>
```

If a run is blocked or partially complete, keep the current run open first and route repair back to the owning agent:

```bash
npx crewup native-state <run-id> diagnose
npx crewup native-state <run-id> reconcile-results
npx crewup next-agent <run-id>
```

Only archive-close a non-success run when the user explicitly asks to close that state:

```bash
npx crewup archive <run-id> --outcome=blocked --reason="local database is unavailable" --close
npx crewup archive <run-id> --outcome=partial --reason="frontend done, backend blocked" --close
npx crewup cancel <run-id> --reason="scope changed"
```

Archive creates or refreshes:

- `.harness/runs/<run-id>/RUN_STATUS.md`
- `.harness/runs/<run-id>/RUN_SUMMARY.md`
- `.harness/runs/<run-id>/logs/archive/archive-summary.md`
- `.harness/reports/<run-id>.md`

Archive does not mean success. Only `finish` or `archive --outcome=success` represents a successful outcome.

To continue from a blocked/partial/canceled run:

```bash
npx crewup continue <run-id> --mode=lite "Continue from the previous blocker and reuse the existing requirement and architecture."
```

This creates a new run and includes the source run's `RUN_STATUS.md`, `RUN_SUMMARY.md`, requirements, and architecture artifacts in the new input context. If `continue` omits `--mode`, CrewUp chooses a continuation default from the new request and source run evidence; use `--mode` or `--profile` to override.

If the run started a preview service:

```bash
npx crewup dev-service <run-id> stop
```

Before `finish`, make sure services are stopped, tester/reviewer issues are delegated back to owner agents, and `audit` / `gate-check` pass. Prefer audit/gate/report before closing retained subagents.

## Troubleshooting

### Why did no subagent start?

Common reasons:

- the agent is not listed as runnable by `next-agent`
- upstream agent results do not have a real handle/result yet
- native subagent tooling is unavailable
- the project is in bridge/manual mode and needs handoff execution
- API key or external-tool login is not configured

### Can the main agent directly write business code?

Not in a formal CrewUp run. The main agent orchestrates, registers, checks, and summarizes. Business code and owner artifacts should be written by the owning subagent. `audit` and `gate-check` check overreach risk.

### What about Chinese encoding?

Machine-checked contracts use English headings, JSON fields, status values, and commands to reduce false gate failures. Human-facing summaries, handoffs, and blockers should match the user's primary language.

Run:

```bash
npx crewup doctor
```

If Windows terminal encoding is not CP65001, PowerShell may render Chinese text as mojibake. You can switch the current terminal with:

```powershell
chcp 65001
```

When reading files, prefer:

```powershell
Get-Content README.md -Encoding UTF8
```

or open the file in a UTF-8 aware editor. Inside the harness workflow, the main agent should use explicit UTF-8 reads before judging local documentation content.
