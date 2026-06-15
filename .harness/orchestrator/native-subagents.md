# Native Subagents

## Purpose

Native subagents are the preferred execution path when the environment supports spawning and managing independent agents. They are not just prompt text; they are the normal delegation mechanism for strict CrewUp runs.

## Setup

Before spawning agents:

```bash
npm run harness:context-pack -- <run-id> --agents=<agents>
npm run harness:native-plan -- <run-id> --agents=<agents>
npm run harness:native-state -- <run-id> status
```

## Lifecycle

1. Read `logs/native-subagents/native-subagent-plan.json`.
2. Spawn only agents whose `requires_completed_agents` are already captured.
3. Register real handles with `native-state mark-spawned`.
4. Wait only when the next critical step needs the result.
5. Require each subagent to write its own `<agent>.result.md` and `<agent>.result.json`.
6. Register existing result files with `native-state mark-result`.
7. Keep only agents that still need follow-up in `waiting_review`; completed agents without follow-up may remain `completed`.
8. Run `audit`, `gate-check`, and `report` before closing retained agents when capacity allows.
9. Mark retained agents `ready_to_close`, close them, then mark them `closed`.

## State Mutation Rule

Run native-state mutations serially. Do not run `mark-spawned`, `mark-result`, close-state commands, or repair-state commands in parallel for the same run.

## Result Ownership

- Result files are subagent-owned audit outputs.
- The main agent may only register result files after they already exist.
- The main agent must not create, summarize, or copy result files on behalf of a subagent.
- Formal artifacts are also owner-agent outputs, not main-agent outputs.

## Feedback Routing

Tester/reviewer findings must use:

- `fixRequired`
- `targetAgents`
- `requiredFixes`
- `blockingIssues`

The main agent uses those fields to create repair tasks or resume owner agents. It does not patch business code directly.

When a repair result supersedes an earlier result, the repairing subagent should preserve lineage in its result JSON:

- `repairOf`: ids or result paths being repaired
- `repairReason`: why the repair was needed
- `previousResultPath`: the earlier result file, when known

## Capacity

If retained agents exceed capacity:

```bash
npm run harness:native-state -- <run-id> recommend-close
```

Prefer closing lower-value completed agents before spawning new ones. Prefer resuming retained owner agents over starting duplicate replacements.
