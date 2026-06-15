# CrewUp Command And Completion Governance

[中文](./command-governance.md) | English

This document answers three questions:

- Which commands are part of normal use, and which commands regular users can ignore.
- How `lite`, `strict`, `plan`, and `discovery` define complete versus incomplete.
- What CrewUp should do after success, partial completion, blockers, cancellation, or failure.

Governance principle: smooth execution should come from fewer ambiguous entry points and explicit state transitions, not from skipping evidence or bypassing workflow rules.

## Command Tiers

### Tier 1: Daily Primary Path

These are the stable commands regular users and the main agent should treat as the normal surface. Most runs only need these.

| Command | When to use it | Governance rule |
| --- | --- | --- |
| `npx crewup doctor` | Diagnose environment, encoding, and optional capabilities | Read-only; does not change run state |
| `npx crewup init --agent codex --yes` | Initialize the project adapter | Use after install or adapter changes |
| `npx crewup check` | Validate harness config and core contracts | Required after `.harness/` changes |
| `npx crewup run --mode=lite "..."` | Create a lightweight implementation run | Only for low-risk narrow work |
| `npx crewup run --mode=strict "..."` | Create a formal multi-agent delivery run | Normal strict path; use `--risk=high` for full profile |
| `npx crewup run --mode=plan "..."` | Create a no-code planning run | Produces planning artifacts; business-code gate stays active |
| `npx crewup run --mode=discovery "..."` | Create a no-code discovery run | Produces project/module discovery artifacts |
| `npx crewup run --dry-run "..."` | Preview naming and routing only | Does not create a run; may omit mode for diagnosis |
| `npx crewup status` / `npx crewup runs` | Find run IDs or list run state | Read-only |
| `npx crewup status <run-id>` | Show one run status card | Read-only |
| `npx crewup explain <run-id>` | Diagnose a stuck or confusing run | First diagnostic entry point |
| `npx crewup drive <run-id>` | Deterministically advance scriptable orchestration steps | Runs reconcile/gates/report/finish when possible; prints the next owner action when a native subagent must be started |
| `npx crewup finish <run-id>` | Attempt successful closeout when evidence is ready | Cannot replace validation; refuses success when evidence is incomplete |
| `npx crewup archive <run-id> --outcome=...` | Record a non-success outcome | Non-success stays open by default unless `--close` is explicit |
| `npx crewup cancel <run-id> --reason="..."` | User intentionally stops this run | Closes as canceled while preserving evidence |
| `npx crewup continue <run-id> --mode=lite "..."` | Continue from a previous run with a small scoped formal implementation | Reuses source evidence and forces formal lightweight mode |
| `npx crewup continue <run-id> --mode=strict "..."` | Continue from a previous run with full delivery | Reuses source evidence and forces strict mode |
| `npx crewup continue <run-id> --mode=plan "..."` | Continue from a previous run with planning only | Reuses source evidence and forces planning mode |

### Tier 2: Strict Operator Commands

These commands support the strict multi-agent workflow. Regular users usually do not run them manually; the main agent or maintainers do.

| Command | When to use it | Governance rule |
| --- | --- | --- |
| `npx crewup next-agent <run-id>` | Determine runnable roles in strict mode | Dispatch authority for subagents |
| `npx crewup clarify <run-id>` | Save answers to requirements-plan questions | Saves confirmation; does not author formal requirements |
| `npx crewup native-state <run-id> diagnose` | Subagent state or result registration looks wrong | Diagnose before restarting |
| `npx crewup native-state <run-id> reconcile-results` | Result files exist but native state missed them | Reconcile before re-running |
| `npx crewup audit <run-id>` | Before closeout or when order/ownership is suspicious | Findings route back to owners |
| `npx crewup gate-check <run-id>` | Pre-closeout quality gate | Failing gates block success |
| `npx crewup report <run-id>` | Generate the delivery report | Success, partial, and blocked runs should have clear reports |
| `npx crewup preview-smoke <run-id> --url=...` | Before user-visible web/full-stack closeout | Writes preview availability as evidence |
| `npx crewup dev-service <run-id> ...` | Manage run-scoped preview services | Service health is not the same as business completion |

### Tier 3: Internal Pipeline Commands

These are not daily product entry points. They are normally called by `run`, `finish`, or main-agent orchestration.

| Command | Role |
| --- | --- |
| `prepare-run` | Create run scaffolding, candidates, and task lists |
| `spec-freeze` | Snapshot the user request |
| `context-pack` | Generate compact subagent context |
| `agent-plan` / `native-plan` | Generate native or bridge handoff plans |
| `transition` | Apply stage transitions and entry gates |
| `changed-files` | Record and validate changed-file ownership |
| `archive-commit` | Create an archive commit when policy allows |
| `token-ledger` | Record budget and usage |
| `knowledge-select` | Select knowledge context for a run |

### Tier 4: Optional Advanced Capabilities

Use these only when the corresponding capability is enabled or explicitly needed.

| Command | When to use it |
| --- | --- |
| `tool-fallback` | Record fallback evidence for unavailable Context7, MCP, plugin, or similar tools |
| `knowledge` | Refresh the long-lived knowledge layer |
| `dashboard` | Generate the local dashboard |
| `product-sync` | Sync long-lived product docs after user confirmation |
| `learn` / `learn-promote` | Generate and explicitly promote memory hints |

### Tier 5: Compatibility And Maintenance

These commands recover abnormal state, support older runs, or maintain runtime files. They are not daily commands.

| Command | Governance rule |
| --- | --- |
| `repair-plan` | Groups tester/reviewer fixes by owner |
| `repair-state` | Use only when diagnostics recommends it, state is malformed, or unassigned implementation candidates must be pruned |

## Commands Users Can Ignore

"Ignore" means remove them from the daily mental model, not delete them from the product.

- Casual chat and small Q&A: no CrewUp commands.
- Low-risk small changes: use only `run --mode=lite`, `status/explain/drive`, `finish`, and if needed `archive/cancel/continue`.
- Strict delivery: users usually need only `run --mode=strict`, `status/explain/drive`, and `finish`; the main agent runs `next-agent/audit/gate/report/native-state`.
- Do not start work from internal commands such as `prepare-run`, `transition`, or `archive-commit`.
- Do not use `repair-*` to bypass owner agents; they repair state and formatting, not business results.
- Do not treat `archive --outcome=blocked` as giving up; non-success stays open by default.

## Mode Selection Governance

| Mode | Activation | Internal profile | Best for | Not for |
| --- | --- | --- | --- | --- |
| Normal chat | No CrewUp signal | none | Q&A, explanations, tiny informal discussion | Formal work requiring evidence, reports, or archive |
| Default small work | no explicit mode/profile and request is narrow/low-risk | `lite-v2` | Low-risk, narrow work the main agent can complete reliably | Database, auth, security, deploy, broad cross-module changes |
| `lite` | `--mode=lite` or chat says "use CrewUp lite" | `lite` | Formal lightweight implementation with delegated verification/release evidence | Direct tiny fixes where `lite-v2` evidence is enough |
| `strict` | `--mode=strict` or chat says "use CrewUp strict" | `standard` | Normal formal delivery with strict evidence | Tiny low-risk changes where full delegation adds friction |
| `strict --risk=high` | `--mode=strict --risk=high` or chat says "strict, high risk" | `full` | High-risk, broad, audit-heavy delivery | Fast informal fixes |
| `plan` | `--mode=plan` or chat says "CrewUp plan only" | `plan_only` | No-code planning, acceptance, architecture, implementation plan | Actual implementation |
| `discovery` | `--mode=discovery` or chat says "CrewUp discovery" | `discovery` | Project/module mapping and risk discovery | Actual implementation |

Selection rules:

- No explicit CrewUp signal means no run.
- A real `crewup run` may omit `--mode`; CrewUp chooses a conservative default profile from the request and prints the selected mode/profile.
- A real `crewup continue` may omit `--mode`; CrewUp chooses a continuation default from the new request and source run evidence.
- `--profile` remains a compatibility alias for existing automation, but new user-facing docs and chat prompts should use `--mode`.
- The main agent should not invent hidden mode semantics in chat. It may let the CLI choose the documented default, and it should report the chosen mode/profile to the user.
- If a lite run discovers high-risk scope, stop lightweight success closeout, record blocked/partial, and create or recommend a strict continuation.

## Fixed Run Files By Mode

Every CrewUp run is indexed in reports/knowledge during archive, including non-success outcomes. Modes differ by fixed run structure, not by hidden AI choice.

| Mode | Always generated | Native subagent plan | Knowledge/report indexing |
| --- | --- | --- | --- |
| default `lite-v2` | `spec.md`, `tasks.md`, `validation.md`, `summary.md`, `RUN_STATUS.md`, `RUN_SUMMARY.md` | No | Yes, on archive/finish |
| `lite` | strict-style run files with shorter budgets and delegated tester/reviewer/release evidence | Yes | Yes, on archive/finish |
| `strict` | `input.md`, `state.json`, `tasks/`, `artifacts/`, `logs/native-subagents/`, `RUN_STATUS.md`, `RUN_SUMMARY.md` | Yes | Yes, on archive/finish |
| `strict --risk=high` | Same as `strict`, with `full` profile gates and broader evidence expectations | Yes | Yes, on archive/finish |
| `plan` | `planning.md`, `acceptance.md`, `architecture-plan.md`, `implementation-plan.md`, `review.md`, `validation.md`, `summary.md` | Yes, for planning/review roles only | Yes, on archive/finish |
| `discovery` | `discovery.md`, `module-map.md`, `tech-map.md`, `risk-map.md`, `next-runs.md`, `review.md`, `summary.md` | Yes, for discovery/review roles only | Yes, on archive/finish |

If a run is not archived yet, you may iterate the same run when it is still open. Starting a second requirement before the first run has a clear outcome is allowed only when the scopes are independent; otherwise it creates ambiguous evidence, stale knowledge, and unclear ownership.

## Completion Definitions

### lite Complete

`lite` is complete only when all of these are true:

- `spec.md`, `tasks.md`, `validation.md`, and `summary.md` exist.
- `tasks.md` has no unresolved core task.
- `validation.md` records validation discovery evidence, actual commands/checks, results, and key evidence.
- `summary.md` records final changes, validation conclusion, residual risks, and user-checkable paths.
- `validation.md` and `summary.md` no longer contain pending placeholder states.
- No high-risk scope was discovered that requires strict handling.

After completion:

- `npx crewup finish <run-id>` may close as success.
- The run should become `done`, outcome `success`, with archived summary evidence.
- A closed run is not edited further; future work uses `continue`.

### lite Incomplete

Any of these means incomplete:

- One of the four root files is missing.
- `validation.md` or `summary.md` is still pending.
- Validation failed, was not run, or the evidence cannot support the result.
- User acceptance failed.
- Database/auth/security/deploy/broad cross-module scope was discovered.
- The main agent cannot reliably continue because tools repeatedly fail or required input is missing.

After incompletion:

- Prefer updating evidence, fixing the issue, then retrying `finish`.
- For recoverable blockers, record `archive --outcome=blocked --reason="..."` and keep the run open by default.
- If the user accepts partial delivery, use `archive --outcome=partial --reason="..."`; `--close` requires explicit user intent.
- If the user intentionally stops, use `cancel`.
- If scope escalates, use `continue` or create a strict run.

### strict Complete

`strict` and `strict --risk=high` are complete only when all of these are true:

- requirements-plan, requirements, and architect completed in order.
- `implementation-plan.md` assigned exact implementation owners.
- Every assigned implementation owner produced and registered a result.
- tester completed verification and wrote evidence.
- reviewer completed review, and required fixes were routed back to owners and resolved.
- Web/full-stack user-visible delivery has preview-smoke evidence or a documented reason it does not apply.
- release/report/gate-check passed.
- The main agent did not overreach by writing owner artifacts or business code.

After completion:

- `finish` may close as success.
- Run report, summary, and archive logs are generated or updated.
- Archive commit is attempted if policy allows; missing initial git commit writes an audit record and does not block success.
- Future issues after closeout use `continue`.

### strict Incomplete

Any of these means incomplete:

- Stage order is wrong or owner artifacts are missing.
- Implementation owners are incomplete or unregistered.
- tester/reviewer required fixes are unresolved.
- gate-check fails.
- preview-smoke fails for an issue that belongs to the current run.
- The main agent wrote formal business implementation or owner artifacts.
- Tooling, service, permission, or requirement-input blockers prevent progress.

After incompletion:

- Use `explain` first to identify the next safe action.
- For subagent result problems, use `native-state diagnose`; reconcile existing results before re-running agents.
- Route business issues back to owner agents, not the main agent.
- Keep recoverable blockers open and recorded.
- Use `archive ... --close` only when the user explicitly abandons or closes the run.

### plan Complete

`plan` is complete only when all of these are true:

- `planning.md`, `acceptance.md`, `architecture-plan.md`, `implementation-plan.md`, `review.md`, `validation.md`, and `summary.md` exist.
- These files are no longer pending placeholders.
- No business code was changed.
- The plan clearly states recommended implementation owners, risks, acceptance criteria, and next-run boundaries.
- `validation.md` records that this was a no-code validation and lists the evidence reviewed.
- Review has checked the plan for ambiguity and unsafe missing scope.

After completion, `finish` may close the no-code plan as success. Later implementation should start a new `lite` or `strict` run instead of quietly turning the plan run into implementation.

### plan Incomplete

`plan` is incomplete when planning files are still pending, acceptance criteria are ambiguous, architecture or implementation ownership is missing, review has blocking concerns, or business code was changed. Fix the plan artifacts first; if implementation already started, record the state and create the correct implementation run.

### discovery Complete

`discovery` is complete only when all of these are true:

- `discovery.md`, `module-map.md`, `tech-map.md`, `risk-map.md`, `next-runs.md`, `review.md`, and `summary.md` exist.
- These files are no longer pending placeholders.
- No business code was changed.
- The repository or module map is specific enough to route future work.
- Risks and unknowns are explicitly recorded instead of hidden.
- `next-runs.md` describes recommended follow-up runs and which mode each follow-up should use.

After completion, `finish` may close the discovery run as success. Follow-up work should be created as a separate explicit-mode run.

### discovery Incomplete

`discovery` is incomplete when the maps are still placeholders, key modules are unknown without explanation, risks are not captured, or code was changed. Keep it open, repair the discovery evidence, or archive as blocked/partial with the reason.

## Outcome Semantics

| Outcome | Meaning | Closed by default | Follow-up |
| --- | --- | --- | --- |
| `success` | Completion definition and gates passed | Yes | Future changes use `continue` |
| `partial` | User accepts partial delivery but known work remains | No, unless `--close` | Continue repair or close by explicit user choice |
| `blocked` | Cannot proceed now, but the goal is still valid | No, unless `--close` | Resume current run after unblocking |
| `canceled` | User intentionally stopped this run | Yes | Start a new run or continuation if needed |
| `failed` | Unrecoverable or policy-level failure | Usually yes, but use carefully | Retrospect, then create a new run |

## Stuck, Blocked, And Unarchived Runs

Use `npx crewup next-agent <run-id> --json` or `npx crewup drive <run-id>` to classify state:

- `action=spawn`: start only the listed `next` agent.
- `action=wait`: an agent is active and has recent enough activity; wait instead of restarting.
- `action=stale`: ask that agent once for result-only closeout, then run `native-state diagnose` and `reconcile-results`.
- `action=repair`: run `repair-plan` and route fixes to owner agents.
- `action=blocked`: prerequisites or state are missing; diagnose before restarting.
- `action=done` or `closed`: do not continue editing that run; create a continuation for follow-up.

If a run cannot meet its archive standard, it should not be called done. Record `blocked` or `partial` with a reason, keep it open by default, and resume the same run after the blocker is removed. Use `--close` only when the user explicitly wants to abandon or freeze that run.

An unarchived run can still be iterated when it remains open. The cost of leaving it unarchived is governance ambiguity: knowledge may not reflect the final lesson yet, dashboards may show it as active, and a later run may not have clean predecessor evidence. For independent work, create another explicit-mode run; for the same requirement, continue the existing run or create a continuation after it is closed.

## Stability Boundaries

- Do not delete commands to create perceived simplicity; that can break old runs, docs, scripts, and external automation.
- Reduce mental load through tiers: daily users remember Tier 1, strict orchestration uses Tier 2.
- `finish` can only close success; it cannot package unvalidated work as success.
- `archive blocked/partial` records state; it does not hide the problem.
- `--close` is explicit user intent; non-success remains open by default.
- `lite` is additive and opt-in; it does not change strict behavior.

## strict Stability Strategy

`strict` optimizes for evidence and auditability, not the shortest path. To reduce false stalls and repeated restarts, the default strategy is:

- `runtime.slow_result_capture_minutes` defaults to 45 minutes; `crewup check` rejects values below 15 minutes.
- Subagents must update `logs/native-subagents/<agent>.progress.md`; recent progress keeps `next-agent` in normal wait mode.
- `next-agent action=stale` means "no result and no recent progress"; it does not mean the task failed.
- After stale, ask the same subagent for one result-only closeout; then run `native-state diagnose` and `reconcile-results` before restarting anything.
- If diagnostics show the external tool, login state, permissions, or native runner is unavailable, record blocked and keep the run open instead of letting the main agent take over strict owner work.
- `next-agent` dynamically ignores implementation candidates that `implementation-plan.md` did not assign, so leftover backend/database/devops candidate tasks do not block closeout.
- Tester and reviewer only become runnable after assigned implementation owners finish; they should not race ahead of implementation results.
- `drive` is the preferred deterministic helper for orchestration maintenance: it reconciles results, reports stale/repair/spawn/wait decisions, and runs closeout gates when scriptable. It does not replace native subagent spawning in hosts where spawning is an app-level action.
- `repair-state --prune-unassigned-implementation` is available for legacy/dirty runs. It previews by default and removes only unassigned implementation candidates that have no handle or result evidence when `--apply` is explicit.
- If the user wants stable fast delivery and the task is low-risk and narrow, explicitly use `lite`; if the task is high-risk but the strict native environment is unstable, fix the runner/login/tooling first, then run `strict`.
