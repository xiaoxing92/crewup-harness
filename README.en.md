# CrewUp

[中文](./README.md) | English

![CrewUp stable AI workflow architecture](assets/crewup-hero.svg)

CrewUp is an AI harness for large projects and rigorous delivery workflows. It is not a prompt bundle that asks one main agent to do everything. It is a workflow control protocol that defines when formal work starts, which role owns each artifact, who implements changes, which gates must pass, how compact memory is reused, and how a run is reported and archived.

Its goal is simple: turn open-ended AI coding into a traceable, delegated, verifiable, and archivable engineering loop.

## Who It Is For

- Developers or teams that want a standardized AI development workflow
- Medium-to-large projects, long-running projects, complex refactors, full-stack systems, or multi-module repositories
- Users who want the main agent to stay in an orchestration role instead of writing requirements, architecture, implementation, and verification artifacts itself
- Teams that want one delivery protocol across Codex, Claude, Cursor, Trae, or manual execution

Tiny edits, one-off scripts, and casual Q&A usually do not need CrewUp. CrewUp is explicit opt-in, so installing it does not take over every chat.

## Architecture

CrewUp splits AI engineering work into three layers:

| Layer | Owns | Does not own |
| --- | --- | --- |
| Main Agent | Run creation, profile selection, task generation, subagent dispatch, result registration, gate checks, user summaries | Formal requirements, architecture, business code, test reports, review reports |
| Role Agents | Requirements, architecture, frontend, backend, database, DevOps, tester, reviewer, docs, release artifacts | Bypassing run state or writing artifacts owned by another role |
| Harness Gates | Entry checks, dependency order, artifact provenance, write scope, tester/reviewer feedback, service shutdown, archive readiness | Replacing the project's own tests, CI/CD, coding standards, or engineering judgment |

Default formal order:

```text
intake -> requirements_plan -> requirements_confirm -> plan
  -> implement -> verify -> review -> release -> done
```

A strict workflow does not skip roles just because a task is small. CrewUp reduces waste through clearer task contracts, more accurate routing, shorter artifacts, and fewer repair loops, not by turning the main agent back into an everything-doer. `lite` means shorter requirements and architecture artifacts, not direct implementation.

## Core Capabilities

- Explicit activation: users still opt into CrewUp, but `run` and `continue` may infer a default profile when no mode is provided
- Mode defaults: small low-risk work defaults to `lite-v2`, broad or risky work defaults to strict/full, and users can still override with `--mode` or `--profile`
- Main-agent boundary: the main agent orchestrates, checks, and summarizes; it does not write owner artifacts or business code
- Ordered dispatch: `next-agent` returns only subagents whose prerequisites are complete
- Stable front door: the first runnable agent in a formal run should be `requirements-plan`, not an implementation agent
- Interactive clarification: `requirements-plan` first writes a Markdown clarification card, then returns a few structured questions; other hosts use `crewup clarify --interactive`
- Artifact ownership: `requirement.md`, `architecture.md`, `implementation-plan.md`, `test-report.md`, and related artifacts must be written by their owner roles
- Schema-first tasks: subagent tasks include required headings and write contracts before execution
- Negation-aware routing: when the user explicitly excludes a scope, CrewUp avoids false-positive agents or high-risk classification; normally, requirements and architecture should decide which implementation agents are needed
- Language following: main/subagent summaries, handoffs, blockers, and status notes match the user's primary language
- English machine contracts: artifact headings, JSON fields, paths, commands, and status values stay in English to reduce encoding drift and false gate failures
- Feedback repair loop: tester/reviewer findings are routed back to implementation owners instead of being fixed directly by the main agent
- Run health explanation: `crewup explain <run-id>` is the first diagnostic entry point for stuck, open, or confusing runs
- Auditable fallback: when optional tools such as Context7, MCP servers, or plugins are unavailable, `tool-fallback` records the fallback evidence in run logs
- Repair lineage: repair results preserve `repairOf`, `repairReason`, and `previousResultPath` to reduce repeated repair loops
- Runtime archive: runs, reports, dashboard, and knowledge have explicit locations and preservation rules
- Low-token memory: `learn` extracts candidate lessons, and `learn-promote` explicitly promotes only valuable lessons into Memory Hints
- Slim command surface: low-value historical commands have been removed; daily users stay on the stable run/drive/gate/report/finish path
- Stable closeout: archive commit skips with an audit record when a new repository has no initial commit, instead of blocking an otherwise successful run
- Safe upgrade: `install --force` updates the harness core while preserving existing runs, knowledge, project adapters, reports, and dashboard state

## Install

Install in a new or target project:

```bash
npm install -D crewup-harness
npx crewup install
npx crewup init --agent codex --yes
npx crewup check
```

## Model Access And API Keys

CrewUp is a workflow harness. It does not include model credits, API keys, or a built-in subagent runtime.

For `codex` native mode, you need a Codex environment that can launch native subagents. Depending on how you use Codex, this may be a logged-in Codex Desktop / CLI session or API-backed automation. SDK/API paths and `inspect --ai` require `OPENAI_API_KEY`:

```bash
export OPENAI_API_KEY="sk-..."
```

On Windows PowerShell:

```powershell
$env:OPENAI_API_KEY="sk-..."
```

For `claude`, `cursor`, and `trae`, CrewUp currently uses the Universal Agent Bridge. Those tools use their own login, API key, or subscription, then write CrewUp-compatible result JSON files back into the run directory.

For `manual`, no AI API key is required. CrewUp generates tasks, context, gates, and reports; a human or external tool executes the handoff and writes back results.

For existing projects, monorepos, or complex repository shapes, inspect first:

```bash
npx crewup inspect --no-ai
npx crewup init --agent codex --yes
```

Upgrade an existing CrewUp installation:

```bash
npx crewup install --force
```

`--force` updates reusable `.harness` core files while preserving `.harness/runs/`, `.harness/knowledge/`, `.harness/project/`, `.harness/reports/`, and `.harness/dashboard/`. Use reset only when you explicitly want to remove old runtime state and reinstall from scratch:

```bash
npx crewup install --reset
```

## Usage

CLI:

```bash
npx crewup run --mode=strict "Use CrewUp to plan and implement a todo MVP with requirements, architecture, frontend implementation, tester verification, reviewer review, and release summary. Keep the implementation small."
```

Chat:

```text
Use CrewUp strict to plan and implement a tiny Todo MVP. Keep the full flow: requirements, architecture, implementation, tester, reviewer, release. Let requirements and architecture confirm the scope, then dispatch implementation agents from the architecture plan.
```

When CrewUp is requested in chat, the user may name the mode. If no mode is named, the main agent can run `npx crewup run "<user request>"` and let CrewUp print the selected default mode/profile. It should then extract the runId, call `npx crewup next-agent <run-id>` or `npx crewup drive <run-id>`, and continue orchestration. Users do not need to manually create a runId first.

Requests without an explicit CrewUp signal remain normal assistant work.

If a real `run` or `continue` command omits `--mode`, CrewUp now chooses a conservative default profile from the request. Small low-risk work defaults to `lite-v2`; broad, risky, or explicitly strict work defaults to strict/full. Use `--mode` or `--profile` to override.

## Choosing A Mode

Users only choose the delivery contract. They do not need to tell the AI whether to run `build`, `test`, `lint`, or which preview service to start. CrewUp agents discover validation from project evidence such as `package.json`, README, CI config, framework config, test folders, and existing scripts.

| Desired outcome | Choose | Example phrase | Changes business code |
| --- | --- | --- | --- |
| Clarify requirements, architecture, acceptance criteria, and implementation steps first | `plan` | `Use CrewUp plan. Only plan; do not write code.` | No |
| Fix one small bug, UI issue, copy issue, component tweak, or one clear phase | `lite` | `Use CrewUp lite. Fix this small issue and run the necessary validation.` | Yes |
| Deliver a complete feature, cross-module change, full-stack request, or tester/reviewer/release evidence | `strict` | `Use CrewUp strict. Fully implement this requirement.` | Yes |
| Permissions, database, security, deployment, migration, or broad refactor | `strict --risk=high` | `Use CrewUp strict, high risk, for this change.` | Yes |
| Map an unfamiliar project, module, stack, risks, and follow-up runs | `discovery` | `Use CrewUp discovery to map this project and recommend next runs.` | No |

Common rule of thumb:

- Need a plan first: use `plan`.
- Clear small fix: use `lite`.
- Complete delivery: use `strict`.
- Security, auth, database, deployment, or broad scope: use `strict --risk=high`.

A successful `plan` run does not silently turn into implementation. Start a continuation run from the approved plan:

```bash
npx crewup continue <plan-run-id> --mode=lite "Implement only the first phase from the plan"
npx crewup continue <plan-run-id> --mode=strict "Implement the approved plan fully"
```

Without `--mode`, CrewUp chooses a conservative default and creates the run:

```bash
npx crewup run "Localize the whole blog project"
npx crewup continue <run-id> "Continue implementation"
```

Small low-risk work typically defaults to direct `lite-v2`; broad, risky, or explicitly strict work defaults to strict/full. Use `--mode` or `--profile` when you want to force a specific path.

Mode examples:

- `Use CrewUp lite to fix this low-risk UI bug and update validation/summary.`
- `Use CrewUp strict to add the permission system.`
- `Use CrewUp strict, high risk, to redesign auth and database access.`
- `Use CrewUp plan only; do not write code.`
- `Use CrewUp discovery to map the repo and propose next runs.`

## First Full-Flow Example

Use this small case to test the whole workflow without spending too much:

```text
Use CrewUp strict to build a tiny counter web app and run the full workflow. Acceptance criteria: page shows counter, initial value is 0, +1/-1/reset work, and value persists after refresh. Scope: tiny frontend only; no backend, database, auth, or routing. Discover and run the necessary validation from the project configuration.
```

After the run is created, check orchestration:

```bash
npx crewup next-agent <run-id>
npx crewup audit <run-id>
npx crewup gate-check <run-id>
```

More copy-ready prompts are in [examples/crewup-cases](./examples/crewup-cases/README.md).

If multilingual text appears garbled in a terminal, run `npx crewup doctor --encoding-help`. CrewUp files are managed as UTF-8, and the main agent should use explicit UTF-8 reads for local documentation.

## Common Commands

Daily users do not need to remember every script. Prefer `doctor`, `init`, `check`, `run`, `status/runs`, `explain`, `drive`, `finish`, `archive`, `cancel`, and `continue`; strict operator commands such as `next-agent`, `native-state`, `audit`, `gate-check`, and `report` are usually run by the main agent. See [Command And Completion Governance](./docs/command-governance.en.md) for the full tiering and outcome rules.

| Command | Purpose |
| --- | --- |
| `npx crewup doctor` | Check local environment and prerequisites |
| `npx crewup doctor --encoding-help` | Show Windows/macOS/Linux UTF-8 terminal troubleshooting |
| `npx crewup install` | Install the CrewUp harness template |
| `npx crewup install --force` | Safely upgrade harness core while preserving runtime state |
| `npx crewup inspect --no-ai` | Inspect project structure without AI |
| `npx crewup init --agent codex --yes` | Generate project adapter and runtime config |
| `npx crewup check` | Validate harness config, scripts, and templates |
| `npx crewup run --mode=lite "..."` | Create a lightweight implementation run |
| `npx crewup run --mode=strict "..."` | Create a formal multi-agent run |
| `npx crewup run --mode=strict --risk=high "..."` | Create a high-risk full-profile strict run |
| `npx crewup run --mode=plan "..."` | Create a no-code planning run |
| `npx crewup run --mode=discovery "..."` | Create a no-code discovery run |
| `npx crewup run --dry-run "..."` | Preview naming, profile, and agent routing |
| `npx crewup drive <run-id>` | Deterministically reconcile, classify next action, and run scriptable closeout steps |
| `npx crewup next-agent <run-id>` | Show currently runnable subagents and blocked prerequisites; a formal run should start with `requirements-plan` |
| `npx crewup status` | List all runs and find a runId |
| `npx crewup runs` | Alias for the status list view |
| `npx crewup status <run-id>` | Show one run status card |
| `npx crewup explain <run-id>` | Explain whether a run is done, why it is stuck, and the next safe action |
| `npx crewup clarify <run-id>` | Render clarification questions and options generated by `requirements-plan` |
| `npx crewup clarify <run-id> --interactive` | Use keyboard selection in a real terminal and save answers |
| `npx crewup native-state <run-id> diagnose` | Diagnose native subagent handles, results, and state gaps |
| `npx crewup native-state <run-id> reconcile-results` | Capture existing subagent result files that were not registered |
| `npx crewup tool-fallback <run-id> --tool Context7 --reason "..." --fallback "..."` | Record optional tool fallback evidence |
| `npx crewup audit <run-id>` | Audit orchestration order, owner boundaries, repair loops, and context pressure |
| `npx crewup gate-check <run-id>` | Check gates, artifact ownership, and overreach risks |
| `npx crewup preview-smoke <run-id> --url=http://localhost:3000` | Verify preview URLs and write smoke evidence |
| `npx crewup report <run-id>` | Generate a structured delivery report |
| `npx crewup archive <run-id> --outcome=blocked --reason="..."` | Mark a non-success state while keeping the run open by default |
| `npx crewup archive <run-id> --outcome=blocked --reason="..." --close` | Archive-close a non-success run only when the user explicitly abandons or closes it |
| `npx crewup cancel <run-id> --reason="..."` | Cancel a run and archive the cancellation without discarding files |
| `npx crewup continue <run-id> --mode=lite "..."` | Create a small scoped continuation run from a previous run |
| `npx crewup continue <run-id> --mode=strict "..."` | Create a full delivery continuation run from a previous run |
| `npx crewup continue <run-id> --mode=plan "..."` | Create a planning continuation run from a previous run |
| `npx crewup finish <run-id>` | Finish and archive the run by policy |
| `npx crewup learn <run-id>` | Extract candidate lessons without changing future routing |
| `npx crewup learn-promote <lesson-id>` | Explicitly promote a candidate lesson into Memory Hints |
| `npx crewup dashboard` | Generate or refresh `.harness/dashboard/index.html` |
| `npx crewup dev-service <run-id> start` | Start a run-scoped preview service |
| `npx crewup dev-service <run-id> stop` | Stop the run-scoped preview service |

Prefer `npx crewup ...` in target projects because the user's `package.json` may not include `npm run harness:*` scripts.

For internal pipeline and maintenance commands, see [Script Map](./docs/harness-script-map.en.md). Regular developers do not need to memorize every `.harness/scripts` file.

## Memory Hints

CrewUp does not push every archived run log into future context. The learning path is intentionally explicit:

```bash
npx crewup learn <run-id>
npx crewup learn-promote <lesson-id>
```

`learn` creates candidate lessons from real run evidence. `learn-promote` is the human/maintainer approval step that moves a useful lesson into `.harness/knowledge/memory-hints.md`. Later runs select only relevant short hints, which keeps token cost low while preserving lessons that actually prevent repeated mistakes. See [Memory Hints](./docs/memory-hints.en.md).

## Workflow Profiles

| Public mode | Internal profile | Best for |
| --- | --- | --- |
| auto small work | `lite-v2` | Low-risk narrow implementation; main agent may implement directly and must record `spec.md`, `tasks.md`, `validation.md`, and `summary.md` |
| `lite` | `lite` | Formal lightweight implementation with delegated verification and release evidence |
| `strict` | `standard` | Normal formal multi-agent delivery |
| `strict --risk=high` | `full` | High-risk, broad, multi-stage, or audit-heavy work |
| `plan` | `plan_only` | Planning/no-code artifacts only; business-code gate is active |
| `discovery` | `discovery` | Project/module mapping and next-run recommendations |

## When Subagents Start

Typical planning-to-development flow:

1. The main agent creates the run, freezes input, generates tasks, and writes the native plan.
2. `requirements-plan` writes `artifacts/requirement-plan.md`.
3. `requirements` writes `artifacts/requirement.md` after prerequisites are complete.
4. `architect` writes `artifacts/architecture.md` and `artifacts/implementation-plan.md` after requirements complete.
5. Implementation agents start only after `implementation-plan.md` exists and assigns exact agent ids, such as `frontend`, `backend`, `database`, `devops`, or `docs`.
6. `tester` verifies the result and writes `artifacts/test-report.md`.
7. `reviewer` reviews implementation, artifacts, risks, and test evidence.
8. For web/full-stack runs, the main agent starts or reports preview, then runs `preview-smoke` for the URLs the user should open.
9. `release` writes `artifacts/release-summary.md`, then the run can be reported and archived.

If an open run hits a preview, deployment, build, or functional issue, keep repairing inside the current run and route work to the owning agent. If an archived run later shows a preview, deployment, or functional issue, create a continuation run with `npx crewup continue <run-id> --mode=lite "..."` for a small fix or `--mode=strict` for full delivery. The main agent may restart/stop services and rerun preview smoke, but business-code fixes must go through the owning agents.

Normally, users should describe the goal and constraints; requirements/architect artifacts and impact scope should decide which implementation agents are needed. Negation-aware routing only applies when the user has explicitly excluded a scope, so CrewUp does not start irrelevant owner agents just to confirm they are irrelevant.

## Lite Lightweight Flow

`lite-v2` is the default path for low-risk, narrow changes when no mode is provided. It is meant for small UI work, single-module bug fixes, and lightweight implementation tasks where the full native subagent audit chain would add more friction than value.

```bash
npx crewup run "Fix the Admin mobile overflow and discover/run the necessary project validation"
```

It creates `spec.md`, `tasks.md`, `validation.md`, and `summary.md` directly under the run directory. It does not create native subagent tasks or `logs/native-subagents/native-subagent-plan.json`. The main agent may implement directly inside the scoped task, but `finish` refuses success while `validation.md` or `summary.md` still contain pending evidence.

Use `--mode=lite` when you want a formal lightweight run with delegated tester/reviewer/release evidence. Use `--mode=strict` for database, auth, security, deploy, cross-module, or audit-heavy work. `--profile=lite-v2` remains available as an explicit direct-lightweight override.

Detailed guide: [Lite Lightweight Flow](./docs/lite-v2.en.md).

## Directory Layout

```text
.harness/
  AGENTS.md                # CrewUp entry contract
  orchestrator/            # Main agent, routing, native/bridge protocols
  config/                  # Workflow, model, gate, delegation, and write policies
  project/                 # Project adapter generated by init
  runs/                    # Per-run inputs, tasks, artifacts, and logs
  reports/                 # Delivery reports
  dashboard/               # Dashboard output
  knowledge/               # Lessons and reusable context
```

## Optional Integrations

CrewUp core does not require CodeGraph or any external code intelligence provider. Optional integrations are reported by:

```bash
npx crewup doctor
```

CodeGraph is useful for large-codebase structure indexing and impact assistance. It does not replace `.harness/knowledge/`: CodeGraph is code-fact indexing, while knowledge files are project lessons, decisions, and retrospectives.

## Local Validation

```bash
npm run harness:check
npm test
npm run test:pack-install
npm run release:preflight
```

`release:preflight` runs harness validation, example tests, temporary-project pack-install flow tests, and `npm pack --dry-run`.

Install/upgrade/reset paths can be tested independently:

```bash
npm run test:install-flow
```

See the full matrix in [Test Matrix](./docs/test-matrix.en.md).

## More Docs

| Document | Topic |
| --- | --- |
| [Workflow](./docs/harness-workflow.en.md) | Command flow, profiles, and run lifecycle |
| [模式治理](./docs/mode-governance.md) | 中文说明：聊天怎么指定模式、每种模式生成什么、怎么算完成、卡住怎么办 |
| [Default Mode Selection](./docs/mode-picker.en.md) | How CrewUp chooses a default profile when mode is omitted, and how to override it |
| [Lite](./docs/lite-v2.en.md) | Default direct-lightweight flow and explicit lightweight mode |
| [Runbook](./docs/runbook.en.md) | How to judge health, completion, blockers, cancellation, and continuation |
| [Command Governance](./docs/command-governance.en.md) | Daily/internal/maintenance command tiers plus complete, incomplete, blocked, and canceled outcome rules |
| [Memory Hints](./docs/memory-hints.en.md) | Candidate lessons, explicit promotion, and low-token reuse |
| [Getting Started](./docs/getting-started.en.md) | Install, API key setup, first run, and troubleshooting |
| [Troubleshooting](./docs/troubleshooting.en.md) | Terminal encoding, mojibake checks, and cross-platform fixes |
| [Local Testing](./docs/local-testing.en.md) | Test CrewUp locally with `npm pack` and a temporary project |
| [Test Matrix](./docs/test-matrix.en.md) | Which validation command covers each risk area |
| [Universal Agent Bridge](./docs/universal-agent-bridge.en.md) | External-agent handoff and result JSON contract |
| [Agent Selection](./docs/harness-agent-selection.en.md) | Agent selection and adapter generation |
| [Agent Capabilities](./docs/harness-agent-capabilities.en.md) | Support levels, capability boundaries, and claims |
| [Core Boundary](./docs/harness-core-boundary.en.md) | Core, project adapter, and runtime boundaries |
| [Script Map](./docs/harness-script-map.en.md) | Core entries, internal pipeline scripts, optional scripts, and consolidation direction |
| [Optional Integrations](./docs/optional-integrations.en.md) | Optional providers such as CodeGraph |
| [Extension Guide](./docs/harness-extension-guide.en.md) | Skills, policies, rules, and templates |

## Boundaries

CrewUp does not replace your framework, test runner, CI/CD, business architecture, or team conventions. It provides an AI collaboration and delivery-loop protocol. Real projects should keep their own README, test commands, release flow, and coding standards; CrewUp reads and follows that project evidence during initialization and runs.
