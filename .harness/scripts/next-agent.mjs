import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { sortByExecutionOrder } from "./lib/execution-order.mjs";
import { completedNativePrerequisitesForAgent } from "./lib/delegation-guard.mjs";
import { implementationPlanSkipReason, isImplementationAgentUnassigned } from "./lib/implementation-plan-scope.mjs";
import { readRunState } from "./lib/run-lifecycle.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const runId = args.find((arg) => !arg.startsWith("--"));
const json = args.includes("--json");

if (!runId) {
  console.error("Please provide runId, for example: npm run harness:next-agent -- <run-id>");
  process.exit(1);
}

const statePath = path.join(root, ".harness", "runs", runId, "logs", "native-subagents", "native-state.json");
if (!existsSync(statePath)) {
  console.error(`Missing native state: ${path.relative(root, statePath)}`);
  console.error(`Run first: npm run harness:native-plan -- ${runId}`);
  process.exit(1);
}

const state = JSON.parse(stripBom(await readFile(statePath, "utf8")));
const runState = await readRunState(root, runId).catch(() => null);
const report = finalRunReport(runState) ?? buildReport(state);

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report);
}

function buildReport(current) {
  const agents = current.agents ?? [];
  const byAgent = new Map(agents.map((agent) => [agent.agent, agent]));
  const repairPlan = repairPlanState(agents, byAgent);
  const stale = staleActiveAgents(current);
  const runnable = [];
  const blocked = [];
  const completed = [];
  const active = [];
  const skipped = [];
  const skippedSet = new Set();
  const repair = repairFeedbackFor(agents, repairPlan);
  const hasPendingRepair = repair.required;

  for (const agent of sortByExecutionOrder(agents.map((item) => item.agent)).map((id) => byAgent.get(id)).filter(Boolean)) {
    if (hasPendingRepair && ["tester", "reviewer", "release"].includes(agent.agent)) {
      blocked.push({
        agent: agent.agent,
        status: agent.status ?? "planned",
        missing: repair.sources
      });
      continue;
    }
    if (hasCompletedResult(agent, repairPlan)) {
      completed.push(agent.agent);
      continue;
    }
    if (isImplementationAgentUnassigned(agent.agent, { root, runId: current.runId ?? runId })) {
      skipped.push({
        agent: agent.agent,
        status: "skipped",
        reason: implementationPlanSkipReason(agent.agent)
      });
      skippedSet.add(agent.agent);
      continue;
    }
    if (["running", "waiting_review", "ready_to_close"].includes(agent.status)) {
      active.push({
        agent: agent.agent,
        status: agent.status,
        handle: agent.handle ?? null,
        stale: stale.some((item) => item.agent === agent.agent)
      });
      continue;
    }
    if (agent.status === "error" && agent.handle && !agent.result_captured_at) {
      blocked.push({
        agent: agent.agent,
        status: agent.status,
        missing: [agent.last_error ? `error: ${agent.last_error}` : "error result"]
      });
      continue;
    }
    const missing = missingPrerequisites(agent, byAgent, skippedSet, repairPlan);
    if (missing.length === 0) {
      runnable.push({
        agent: agent.agent,
        status: agent.status ?? "planned",
        prompt_path: agent.prompt_path,
        requires_completed_agents: agent.requires_completed_agents ?? []
      });
    } else {
      blocked.push({
        agent: agent.agent,
        status: agent.status ?? "planned",
        missing
      });
    }
  }

  return {
    runId: current.runId ?? runId,
    generatedAt: new Date().toISOString(),
    action: actionFor({ runnable, active, blocked, repair, stale }),
    userInputRequired: false,
    repairRequired: repair.required,
    repair,
    stale,
    waitFor: runnable.length === 0 && stale.length === 0 ? active.map((item) => item.agent) : [],
    instruction: instructionFor({ runnable, active, blocked, repair, stale }),
    runnable,
    active,
    blocked,
    completed,
    skipped,
    next: runnable[0]?.agent ?? null
  };
}

function finalRunReport(current) {
  if (!current || (!current.archived && !["done", "canceled", "failed"].includes(current.status))) return null;
  const done = current.status === "done" && current.outcome === "success" && current.archived;
  return {
    runId: current.runId ?? runId,
    generatedAt: new Date().toISOString(),
    action: done ? "done" : "closed",
    userInputRequired: false,
    repairRequired: false,
    repair: {
      required: false,
      sources: [],
      targetAgents: [],
      feedback: [],
      command: `npx crewup repair-plan ${runId}`
    },
    waitFor: [],
    instruction: done
      ? "Run is already done and archived. Do not start more agents; create a continuation run for follow-up work."
      : "Run is closed. Do not start more agents unless the run is explicitly reopened.",
    runnable: [],
    active: [],
    blocked: [],
    completed: [],
    skipped: [],
    next: null,
    state: {
      status: current.status,
      stage: current.stage,
      outcome: current.outcome,
      archived: Boolean(current.archived)
    }
  };
}

function missingPrerequisites(agent, byAgent, skippedSet = new Set(), repairPlan = null) {
  const missing = [];
  const prerequisites = completedNativePrerequisitesForAgent(agent.agent, { root, runId });
  for (const prerequisite of prerequisites) {
    if (skippedSet.has(prerequisite)) continue;
    if (isImplementationAgentUnassigned(prerequisite, { root, runId })) continue;
    if (!hasCompletedResult(byAgent.get(prerequisite), repairPlan)) missing.push(prerequisite);
  }
  return missing;
}

function hasCompletedResult(agent, repairPlan = null) {
  if (!agent) return false;
  if (repairPlan?.staleVerificationAgents?.has(agent.agent)) return false;
  return Boolean(agent.handle && agent.result_captured_at && agent.result_status === "completed" && !agentRequiresRepair(agent));
}

function printReport(report) {
  console.log(`Next runnable agents: ${report.runId}`);
  console.log(`- action: ${report.action}`);
  console.log(`- user input required: ${report.userInputRequired ? "yes" : "no"}`);
  if (report.repairRequired) {
    console.log(`- repair required: yes`);
    console.log(`- repair targets: ${report.repair.targetAgents.length ? report.repair.targetAgents.join(", ") : "(missing)"}`);
    console.log(`- repair command: ${report.repair.command}`);
  }
  if (report.stale?.length) {
    console.log("- stale:");
    for (const item of report.stale) console.log(`  - ${item.agent}: no activity ${item.minutesSinceActivity} minutes, running ${item.minutesRunning} minutes, handle=${item.handle ?? "none"}`);
  }
  if (report.waitFor.length) console.log(`- wait for: ${report.waitFor.join(", ")}`);
  console.log(`- instruction: ${report.instruction}`);
  console.log(`- next: ${report.next ?? "(none)"}`);
  console.log(`- runnable: ${report.runnable.length ? report.runnable.map((item) => item.agent).join(", ") : "(none)"}`);
  if (report.active.length) {
    console.log("- active:");
    for (const item of report.active) console.log(`  - ${item.agent}: ${item.status}, handle=${item.handle ?? "none"}`);
  }
  if (report.blocked.length) {
    console.log("- blocked:");
    for (const item of report.blocked) console.log(`  - ${item.agent}: missing ${item.missing.join(", ")}`);
  }
  if (report.skipped.length) {
    console.log("- skipped:");
    for (const item of report.skipped) console.log(`  - ${item.agent}: ${item.reason}`);
  }
  if (report.completed.length) console.log(`- completed: ${report.completed.join(", ")}`);
}

function actionFor({ runnable, active, blocked, repair, stale }) {
  if (repair.required) return "repair";
  if (stale.length > 0) return "stale";
  if (runnable.length > 0) return "spawn";
  if (active.length > 0) return "wait";
  if (blocked.length > 0) return "blocked";
  return "idle";
}

function instructionFor({ runnable, active, blocked, repair, stale }) {
  if (repair.required) return `Run repair-plan and route fixes to owner agents: ${repair.targetAgents.join(", ") || "(missing targetAgents)"}. Do not start reviewer/release until repairs are completed and verification is rerun.`;
  if (stale.length > 0) return `Active agent appears stale after ${stale[0].minutesSinceActivity} minutes without result or progress checkpoint: ${stale.map((item) => item.agent).join(", ")}. Ask for a result-only closeout once; if no result is produced, run native-state diagnose and record the run as blocked instead of waiting indefinitely.`;
  if (runnable.length > 0) return `Start only the next runnable agent: ${runnable[0].agent}.`;
  if (active.length > 0) return `Wait for active agent result: ${active.map((item) => item.agent).join(", ")}. Do not ask the user to choose downstream branches.`;
  if (blocked.length > 0) return "No agent is runnable because prerequisites are missing; capture upstream results first.";
  return "No runnable, active, or blocked agents remain.";
}

function staleActiveAgents(current) {
  const slowMinutes = Number(current.runtime?.slow_result_capture_minutes ?? current.slow_result_capture_minutes ?? 10);
  if (!Number.isFinite(slowMinutes) || slowMinutes <= 0) return [];
  return (current.agents ?? []).filter((agent) => {
    if (agent.status !== "running") return false;
    if (!agent.handle || agent.result_captured_at) return false;
    const spawnedAt = Date.parse(agent.spawned_at ?? "");
    if (!Number.isFinite(spawnedAt)) return false;
    const progressUpdatedAt = latestExistingMtime(agent.progress_path);
    const lastActivity = Math.max(spawnedAt, progressUpdatedAt);
    return (Date.now() - lastActivity) / 60000 >= slowMinutes;
  }).map((agent) => ({
    agent: agent.agent,
    handle: agent.handle ?? null,
    spawnedAt: agent.spawned_at ?? null,
    progressPath: agent.progress_path ?? null,
    minutesSinceActivity: Math.floor((Date.now() - Math.max(Date.parse(agent.spawned_at), latestExistingMtime(agent.progress_path))) / 60000),
    minutesRunning: Math.floor((Date.now() - Date.parse(agent.spawned_at)) / 60000),
    resultPath: agent.result_path ?? null,
    resultJsonPath: agent.result_json_path ?? null
  }));
}

function latestExistingMtime(target) {
  if (!target) return 0;
  const absolute = path.isAbsolute(target) ? target : path.join(root, target);
  if (!existsSync(absolute)) return 0;
  try {
    return statSync(absolute).mtimeMs;
  } catch {
    return 0;
  }
}

function repairFeedbackFor(agents, repairPlan = null) {
  const feedback = [];
  for (const agent of agents) {
    if (!["tester", "reviewer"].includes(agent.agent)) continue;
    if (repairPlan?.staleVerificationAgents?.has(agent.agent)) continue;
    if (!agentRequiresRepair(agent)) continue;
    const payload = readResultPayload(agent);
    const requiredFixes = Array.isArray(payload.requiredFixes) ? payload.requiredFixes : [];
    const targetAgents = [
      ...new Set([
        ...asArray(payload.targetAgents),
        ...requiredFixes.flatMap((fix) => asArray(fix.targetAgents))
      ].filter(Boolean))
    ];
    feedback.push({
      agent: agent.agent,
      targetAgents,
      requiredFixes: requiredFixes.length,
      blockingIssues: asArray(payload.blockingIssues).length
    });
  }
  if (repairPlan?.required) {
    feedback.push({
      agent: "repair-plan",
      targetAgents: repairPlan.targetAgents,
      requiredFixes: repairPlan.pendingTargetAgents.length,
      blockingIssues: 0
    });
  }
  return {
    required: feedback.length > 0,
    sources: feedback.map((item) => item.agent),
    targetAgents: [...new Set(feedback.flatMap((item) => item.targetAgents))],
    feedback,
    command: `npx crewup repair-plan ${runId}`
  };
}

function repairPlanState(agents, byAgent) {
  const planPath = path.join(root, ".harness", "runs", runId, "logs", "repair-plan.json");
  const empty = {
    exists: false,
    required: false,
    targetAgents: [],
    pendingTargetAgents: [],
    repairedTargetAgents: [],
    staleVerificationAgents: new Set()
  };
  if (!existsSync(planPath)) return empty;

  let plan = null;
  try {
    plan = JSON.parse(readFileSync(planPath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return empty;
  }

  const generatedAtMs = Date.parse(plan.generatedAt ?? "");
  if (!Number.isFinite(generatedAtMs)) return empty;
  const targetAgents = asArray(plan.targetAgents).map((item) => String(item).trim()).filter(Boolean);
  if (targetAgents.length === 0) return empty;

  const pendingTargetAgents = [];
  const repairedTargetAgents = [];
  let latestRepairMs = generatedAtMs;
  for (const target of targetAgents) {
    const agent = byAgent.get(target);
    const capturedMs = Date.parse(agent?.result_captured_at ?? "");
    const repaired = Boolean(
      agent?.handle
      && agent?.result_status === "completed"
      && Number.isFinite(capturedMs)
      && capturedMs > generatedAtMs
      && !agentRequiresRepair(agent)
    );
    if (repaired) {
      repairedTargetAgents.push(target);
      latestRepairMs = Math.max(latestRepairMs, capturedMs);
    } else {
      pendingTargetAgents.push(target);
    }
  }

  if (pendingTargetAgents.length > 0) {
    return {
      exists: true,
      required: true,
      targetAgents,
      pendingTargetAgents,
      repairedTargetAgents,
      staleVerificationAgents: new Set()
    };
  }

  const staleVerificationAgents = new Set();
  const tester = byAgent.get("tester");
  const testerMs = Date.parse(tester?.result_captured_at ?? "");
  const testerClean = Boolean(
    tester?.handle
    && tester?.result_status === "completed"
    && Number.isFinite(testerMs)
    && testerMs > latestRepairMs
    && !agentRequiresRepair(tester)
  );
  if (tester && !testerClean) staleVerificationAgents.add("tester");

  const reviewer = byAgent.get("reviewer");
  const reviewerMs = Date.parse(reviewer?.result_captured_at ?? "");
  const reviewerClean = Boolean(
    reviewer?.handle
    && reviewer?.result_status === "completed"
    && Number.isFinite(reviewerMs)
    && reviewerMs > Math.max(latestRepairMs, testerClean ? testerMs : latestRepairMs)
    && !agentRequiresRepair(reviewer)
  );
  if (reviewer && !reviewerClean) staleVerificationAgents.add("reviewer");

  return {
    exists: true,
    required: false,
    targetAgents,
    pendingTargetAgents,
    repairedTargetAgents,
    staleVerificationAgents
  };
}

function agentRequiresRepair(agent) {
  const payload = readResultPayload(agent);
  return Boolean(
    payload.fixRequired === true
    || asArray(payload.requiredFixes).length > 0
    || asArray(payload.blockingIssues).length > 0
  );
}

function readResultPayload(agent) {
  const target = agent?.result_json_path ? path.join(root, agent.result_json_path) : "";
  if (!target || !existsSync(target)) return {};
  try {
    return JSON.parse(readFileSync(target, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function stripBom(text) {
  return String(text ?? "").replace(/^\uFEFF/, "");
}
