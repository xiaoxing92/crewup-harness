import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { loadProjectProfile } from "./lib/project-profile.mjs";
import { loadProjectOverlay, resolveImpactScopes } from "./lib/project-overlay.mjs";
import { resolveScriptPath } from "./lib/script-root.mjs";
import {
  artifactHasOwnerProvenance,
  collectArtifactProvenance,
  describeArtifactProvenance
} from "./lib/artifact-provenance.mjs";
import {
  configureDelegationGuard,
  collectWorkspaceChanges,
  evaluateDelegationGuard,
  nativeExecutionProblems,
  requiredNativeAgentsForStageEntry,
  readChangedFilesManifest,
  readNativeState
} from "./lib/delegation-guard.mjs";
import { hasTemplatePlaceholder } from "./lib/placeholder-detector.mjs";
import { codeImplementationAgentIds, isDocsOnlyAgentSet, isLiteImplementationOnlyAgentSet } from "./lib/agent-roles.mjs";
import { isImplementationAgentUnassigned } from "./lib/implementation-plan-scope.mjs";
import { writeRunStatus } from "./lib/run-lifecycle.mjs";
import { loadGeneratedMarkdownSchema, renderGeneratedMarkdown } from "./lib/generated-markdown.mjs";
import { browserRuntimeVerificationProblems } from "./lib/runtime-verification.mjs";
import { validateArtifactSemantics } from "./lib/artifact-renderer.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const runId = args.find((arg) => !arg.startsWith("--"));
const to = valueOf("--to=");
const approveImplementation = args.includes("--approve-implementation");
const approveProductSync = args.includes("--approve-product-sync");
const force = args.includes("--force");
const forceReason = valueOf("--force-reason=");

if (!runId || !to) {
  console.error("Usage: npm run harness:transition -- <run-id> --to=<stage> [--approve-implementation] [--approve-product-sync] [--force --force-reason=<reason>]");
  process.exit(1);
}

if (force && !forceReason) {
  console.error([
    "transition --force requires --force-reason=<reason>.",
    "Force is reserved for audited state repair. Prefer `npx crewup repair-state <run-id> --closeout-only --apply` when diagnostics says only lifecycle metadata is stale."
  ].join("\n"));
  process.exit(1);
}

const runDir = path.join(root, ".harness", "runs", runId);
const tasksDir = path.join(runDir, "tasks");
const statePath = path.join(runDir, "state.json");
const logsDir = path.join(runDir, "logs");
const transitionLog = path.join(logsDir, "transitions.md");

if (!existsSync(statePath)) {
  console.error(`Missing state.json: ${path.relative(root, statePath)}`);
  process.exit(1);
}

await mkdir(logsDir, { recursive: true });

const workflow = parseYaml(await readFile(path.join(root, ".harness", "config", "workflow.yaml"), "utf8")).workflow;
const archivePolicy = parseYaml(await readFile(path.join(root, ".harness", "config", "archive-policy.yaml"), "utf8")).archive;
const artifactSchema = parseYaml(await readFile(path.join(root, ".harness", "config", "artifact-schema.yaml"), "utf8")).artifacts ?? {};
const generatedMarkdownSchema = await loadGeneratedMarkdownSchema(root);
const { project_profile: projectProfile } = await loadProjectProfile(root);
configureDelegationGuard(projectProfile);
const projectOverlay = await loadProjectOverlay(root, projectProfile.ai_overlay?.profile, { projectProfile });
const impactScopesConfig = resolveImpactScopes(projectProfile, projectOverlay.profile);
const state = JSON.parse(await readFile(statePath, "utf8"));
const artifactProvenance = await collectArtifactProvenance(root, runId);
const from = state.stage ?? "intake";
const allowed = workflow.transitions?.[from]?.allowed_next ?? [];
const validStages = new Set((workflow.stages ?? []).map((stage) => stage.id));

if (!validStages.has(to)) fail(`Unknown target stage: ${to}`);
if (!force && !allowed.includes(to) && from !== to && !isLiteDirectImplementationTransition(from, to, state)) {
  fail(`Invalid transition: ${from} -> ${to}. Allowed: ${allowed.join(", ") || "(none)"}`);
}

await enforceGate(to, state);

const now = new Date().toISOString();
state.stage = to;
state.updatedAt = now;
state.status = to === "done" ? "done" : "active";
state.outcome = to === "done" ? "success" : (state.outcome ?? "none");
state.archived = Boolean(state.archived);
state.confirmations = state.confirmations ?? {};
if (approveImplementation) state.confirmations.implementation_approved_at = now;
if (approveProductSync || to === "done") state.confirmations.product_sync_approved_at = now;
state.transitions = [
  ...(state.transitions ?? []),
  { from, to, at: now, force, forceReason: force ? forceReason : "", approveImplementation, approveProductSync }
];

await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
await appendTransitionLog({ from, to, at: now, force, forceReason });
if (force) await appendForceAudit({ from, to, at: now, forceReason });
await writeRunStatus(root, runId, state);

console.log(`Transitioned ${runId}: ${from} -> ${to}`);
if (to === "done") {
  await writeArchiveReminder();
  runProductSync();
  runArchiveCommit();
}

async function enforceGate(targetStage, currentState) {
  if (force) return;

  await requireDelegatedBusinessCodeWrites(targetStage, currentState);

  if (targetStage === "requirements_confirm") {
    requireNativeExecutionForStage("requirements_confirm");
    await requireArtifactContent("requirement-plan.md", { noPlaceholders: true, requireOwner: true });
  }

  if (targetStage === "plan") {
    requireNativeExecutionForStage("plan");
    await requireArtifactContent("requirement.md", { noPlaceholders: true, requireOwner: true });
  }

  if (targetStage === "implement") {
    if (!isDocsOnlyRun(currentState) && !approveImplementation && !currentState.confirmations?.implementation_approved_at) {
      fail("Transition to implement requires --approve-implementation or an existing implementation approval in state.json.");
    }
    requireNativeExecutionForStage("implement");
    if (!isDocsOnlyRun(currentState) && !isLiteImplementationOnlyRun(currentState)) {
      await requireArtifactContent("requirement.md", { noPlaceholders: true, requireImpactScope: true, requireAcceptanceCriteria: true, requireOwner: true });
      await requireArtifactContent("architecture.md", { noPlaceholders: true, requireOwner: true });
      await requireArtifactContent("implementation-plan.md", { noPlaceholders: true, requireOwner: true });
    }
  }

  if (targetStage === "verify") {
    requireNativeExecutionForStage("verify");
  }

  if (targetStage === "review") {
    requireNativeExecutionForStage("review");
    await requireArtifactContent("test-report.md", { noPlaceholders: true, noRequiredCheckFailures: true, requireOwner: true });
  }

  if (targetStage === "release") {
    requireNativeExecutionForStage("release");
    await requireArtifactContent("review-report.md", { noPlaceholders: true, reviewPassed: true, requireOwner: true });
  }

  if (targetStage === "done") {
    requireNativeExecutionForStage("done");
    await requireArtifactContent("test-report.md", { noPlaceholders: true, noRequiredCheckFailures: true, requireOwner: true });
    await requireArtifactContent("review-report.md", { noPlaceholders: true, reviewPassed: true, requireOwner: true });
    await requireArtifactContent("release-summary.md", { noPlaceholders: true, requireOwner: true });
    await requirePreviewSmokeIfPresent();
    await requireBrowserRuntimeVerification();
    requireNoOpenNativeAgents();
    await requireNoRunningDevService();
    await refreshDashboard();
  }
}

async function requireDelegatedBusinessCodeWrites(targetStage, currentState) {
  if (!["implement", "verify", "review", "release", "done"].includes(targetStage)) return;

  const problems = evaluateDelegationGuard({
    root,
    runId,
    state: currentState,
    workspaceFiles: collectWorkspaceChanges(root, runId, currentState),
    manifestFiles: readChangedFilesManifest(root, runId),
    nativeState: await readNativeState(root, runId),
    targetStage,
    requiredAgentsMode: "entry"
  });

  if (problems.length > 0) {
    fail([
      `Delegation guard failed before ${targetStage}.`,
      ...problems,
      "Record real native subagent execution results, or remove/revert the business-code changes before continuing."
    ].join("\n"));
  }
}

function requireArtifact(name) {
  const target = path.join(runDir, "artifacts", name);
  if (!existsSync(target)) fail(`Missing required artifact for transition: ${name}`);
  return target;
}

async function requireArtifactContent(name, options = {}) {
  const target = requireArtifact(name);
  const content = await readFile(target, "utf8");
  for (const heading of artifactSchema[name]?.required_headings ?? []) {
    if (!hasAnyHeading(content, headingAliases(heading))) fail(`Artifact ${name} missing required heading: ${heading}`);
  }
  const semanticProblems = validateArtifactSemantics(name, content);
  if (semanticProblems.length > 0) fail(semanticProblems.join("\n"));
  if (options.noPlaceholders && hasPlaceholder(content)) fail(`Artifact ${name} still contains template placeholders.`);
  if (options.requireImpactScope && availableImpactScopes().length > 0 && !hasMarkedImpactScope(content)) {
    fail(`requirement.md must mark at least one discovered impact scope before implementation. Available scopes: ${availableImpactScopes().join(", ")}`);
  }
  if (options.requireAcceptanceCriteria && !hasAcceptanceCriteria(content)) {
    fail("requirement.md must include concrete acceptance criteria before implementation.");
  }
  if (options.noRequiredCheckFailures && hasRequiredCheckFailure(content)) {
    fail(`${name} contains failed required verification checks.`);
  }
  if (options.reviewPassed && reviewHasBlockingIssues(content)) {
    fail("review-report.md is not passed or still contains blocking issues.");
  }
  if (options.requireOwner) requireArtifactOwnerProvenance(name);
}

function requireArtifactOwnerProvenance(name) {
  const owner = artifactSchema[name]?.owner;
  if (!owner) return;
  if (artifactHasOwnerProvenance(artifactProvenance, name, owner)) return;
  if (!shouldRequireArtifactProvenance()) {
    console.warn(`Warning: Artifact ${name} lacks provenance from owner ${owner}. Found: ${describeArtifactProvenance(artifactProvenance, name)}. Treating as legacy/manual artifact.`);
    return;
  }
  fail(`Artifact ${name} lacks provenance from owner ${owner}. Found: ${describeArtifactProvenance(artifactProvenance, name)}`);
}

function shouldRequireArtifactProvenance() {
  return Boolean(
    existsSync(path.join(logsDir, "orchestrate-results.json"))
      || existsSync(path.join(logsDir, "native-subagents", "native-state.json"))
      || existsSync(path.join(logsDir, "agent-bridge", "bridge-state.json"))
  );
}

function requireNoOpenNativeAgents() {
  const nativeStatePath = path.join(logsDir, "native-subagents", "native-state.json");
  if (!existsSync(nativeStatePath)) return;
  const native = JSON.parse(readFileSync(nativeStatePath, "utf8"));
  const open = (native.agents ?? []).filter((agent) => {
    if (isImplementationAgentUnassigned(agent.agent, { root, runId })) return false;
    if (agent.status === "closed") return false;
    if (agent.close_required) return true;
    return ["planned", "running", "waiting_review", "ready_to_close", "needs_input", "blocked", "error"].includes(agent.status);
  });
  if (open.length > 0) {
    fail(`Native subagents must be closed before run done/archive: ${open.map((agent) => `${agent.agent}:${agent.status}`).join(", ")}`);
  }
}

async function requireNoRunningDevService() {
  const servicePath = path.join(logsDir, "dev-service.json");
  if (!existsSync(servicePath)) return;
  const service = JSON.parse(await readFile(servicePath, "utf8"));
  if (service.status !== "running" || !service.pid) return;
  if (!isPidRunning(service.pid)) return;
  fail(`Dev service is still running before done/archive: pid ${service.pid}. Run \`npm run harness:dev-service -- ${runId} stop\`.`);
}

async function requirePreviewSmokeIfPresent() {
  const smokePath = path.join(logsDir, "preview-smoke.json");
  const artifactPath = path.join(runDir, "artifacts", "preview-smoke.md");
  if (!existsSync(smokePath) && !existsSync(artifactPath)) return;
  if (!existsSync(smokePath)) fail("preview-smoke.md exists but logs/preview-smoke.json is missing.");
  const smoke = JSON.parse(await readFile(smokePath, "utf8"));
  if (smoke.status !== "passed") {
    fail("Preview smoke exists but did not pass. Route the issue to the owning implementation/devops agent before done.");
  }
}

async function requireBrowserRuntimeVerification() {
  const problems = await browserRuntimeVerificationProblems({ root, runId, state, tasksDir });
  if (problems.length > 0) fail(problems.join("\n"));
}

function isPidRunning(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function requireNativeExecutionForStage(targetStage) {
  const requiredAgents = requiredNativeAgentsForStageEntry(targetStage, { root, runId, state });
  if (requiredAgents.length === 0) return;

  const nativeStatePath = path.join(logsDir, "native-subagents", "native-state.json");
  if (!existsSync(nativeStatePath)) {
    fail([
      `Missing native subagent execution record before ${targetStage}: ${requiredAgents.join(", ")}.`,
      "Run `npm run harness:context-pack -- <run-id> --agents=<agents>` and `npm run harness:native-plan -- <run-id> --agents=<agents>`, then spawn native subagents.",
      "If native tools are unavailable, run native-plan first and record fallback with `npm run harness:native-state -- <run-id> mark-fallback <reason>`."
    ].join("\n"));
  }

  const native = JSON.parse(readFileSync(nativeStatePath, "utf8"));
  if (native.fallback) {
    fail([
      `Native subagent gate failed before ${targetStage}: fallback is recorded (${native.fallback.reason}).`,
      "Fallback records why the harness is blocked; it does not authorize the main agent to complete delegated work in the main window.",
      "Resume by enabling native subagents, capturing external agent results into native-state, or explicitly restructuring this as a no-harness/simple task."
    ].join("\n"));
  }

  const issues = nativeExecutionProblems({
    nativeState: native,
    requiredAgents,
    label: `${targetStage} entry`
  });

  if (issues.length > 0) {
    fail([
      `Native subagent gate failed before ${targetStage}.`,
      ...issues,
      "The main agent must not complete delegated planning, implementation, testing, review, or release work only in the main window.",
      "Spawn the required subagents and capture results. If native tools are unavailable, record fallback and stop instead of continuing in the main window."
    ].join("\n"));
  }
}

function isLiteDirectImplementationTransition(fromStage, targetStage, currentState) {
  return fromStage === "requirements_plan"
    && targetStage === "implement"
    && isLiteImplementationOnlyRun(currentState);
}

function isDocsOnlyRun(currentState) {
  return isDocsOnlyAgentSet(availableTaskAgents());
}

function isLiteImplementationOnlyRun(currentState) {
  if (currentState.workflowProfile !== "lite" || isDocsOnlyRun(currentState)) return false;
  const taskAgents = availableTaskAgents();
  const implementationAgents = [...codeImplementationAgentIds].filter((agent) => taskAgents.has(agent));
  return implementationAgents.length > 0
    && isLiteImplementationOnlyAgentSet(taskAgents, currentState.workflowProfile);
}

function availableTaskAgents() {
  if (!existsSync(tasksDir)) return new Set();
  return new Set(
    listTaskFiles(tasksDir).map((name) => name.replace(/\.task\.md$/, ""))
  );
}

function listTaskFiles(tasksDir) {
  try {
    return readdirSync(tasksDir).filter((name) => name.endsWith(".task.md"));
  } catch {
    return [];
  }
}

function hasPlaceholder(content) {
  return hasTemplatePlaceholder(content);
}

function hasMarkedImpactScope(content) {
  const scopes = availableImpactScopes();
  return scopes.some((scope) => new RegExp(`- \\[[xX]\\]\\s+${escapeRegExp(scope)}\\b`, "i").test(content));
}

function availableImpactScopes() {
  return Object.keys(impactScopesConfig ?? {});
}

function hasAcceptanceCriteria(content) {
  const section = sectionTextAny(content, ["Acceptance Criteria", "Acceptance Criteria Draft"]);
  return /AC-\d+/i.test(section) || (/- \[[ xX]\]\s+\S+/.test(section) && !/- \[[ xX]\]\s*$/.test(section.trim()));
}

function hasRequiredCheckFailure(content) {
  return /\|\s*[^|\n]+\s*\|\s*failed\s*\|\s*(true|required)\s*\|/i.test(content)
    || /Required verification failed/i.test(content);
}

function reviewHasBlockingIssues(content) {
  if (/- \[[xX]\]\s*(fail|failed|not passed)/i.test(content)) return true;
  if (hasAnyHeading(content, ["Conclusion"]) && !/- \[[xX]\]\s*(pass|passed|conditional pass)/i.test(content)) return true;
  return sectionHasSubstantiveBulletAny(content, ["Blocking Issues"]);
}

function sectionHasSubstantiveBulletAny(content, headings) {
  const section = sectionTextAny(content, headings);
  return section.split(/\r?\n/).some((line) => {
    const text = line.trim().replace(/^[-*]\s*/, "").trim().replace(/[.!]+$/g, "");
    return text && !["none", "n/a", "no blocking issues", "-"].includes(text.toLowerCase());
  });
}

function hasAnyHeading(content, headings) {
  return headings.some((heading) => new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "m").test(content));
}

function sectionTextAny(content, headings) {
  for (const heading of headings) {
    const section = sectionText(content, heading);
    if (section) return section;
  }
  return "";
}

function headingAliases(heading) {
  return [heading];
}

function sectionText(content, heading) {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "m");
  const match = pattern.exec(content);
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = content.slice(start);
  const next = /^##\s+/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function appendTransitionLog(entry) {
  const previous = existsSync(transitionLog) ? await readFile(transitionLog, "utf8") : `# Transition Log: ${runId}\n\n`;
  const line = `- ${entry.at}: ${entry.from} -> ${entry.to}${entry.force ? ` (force: ${entry.forceReason})` : ""}\n`;
  await writeFile(transitionLog, `${previous.trimEnd()}\n${line}`, "utf8");
}

async function appendForceAudit(entry) {
  const target = path.join(logsDir, "state-repair.md");
  const previous = existsSync(target) ? await readFile(target, "utf8") : `# State Repair Audit: ${runId}\n\n`;
  const line = [
    `## ${entry.at}`,
    "",
    `- action: transition --force`,
    `- from: ${entry.from}`,
    `- to: ${entry.to}`,
    `- reason: ${entry.forceReason}`,
    ""
  ].join("\n");
  await writeFile(target, `${previous.trimEnd()}\n\n${line}`, "utf8");
}

function valueOf(prefix) {
  const arg = args.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function runProductSync() {
  const result = spawnSync(process.execPath, [
    resolveScriptPath(root, "product-sync.mjs"),
    runId,
    "--approved-product-sync"
  ], {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit"
  });

  if (result.status !== 0) {
    console.error("Run reached done, but product docs sync failed. Fix the issue and rerun `npm run harness:product-sync -- <run-id> --approved-product-sync`.");
    process.exit(result.status ?? 1);
  }
}

async function writeArchiveReminder() {
  if (!archivePolicy?.reminder_required) return;
  const reminderRel = (archivePolicy.reminder_file ?? ".harness/runs/<run>/artifacts/archive-reminder.md").replaceAll("<run>", runId);
  const reminderPath = path.join(root, reminderRel);
  const gitStatus = gitStatusShort();
  const content = renderGeneratedMarkdown({
    title: "Archive Reminder",
    file: "artifacts/archive-reminder.md",
    schema: generatedMarkdownSchema,
    sections: {
      "Required Checks Before Archive": [
        `- runId: ${runId}`,
        `- from: ${from}`,
        `- to: ${to}`,
        `- archivedAt: ${new Date().toISOString()}`,
        "- [x] run has reached done stage.",
        "- [x] test report, review report, and release summary passed gates.",
        "- [x] close_required native subagents are closed and recorded.",
        "- [ ] business code and product documentation changes for this run are recorded in changed-files manifest.",
        "- [ ] if the workspace contains unrelated changes, do not use --allow-all-workspace-changes."
      ],
      "Automatic Git Commit Policy": [
        `- enabled: ${archivePolicy.git?.enabled ? "true" : "false"}`,
        `- auto_commit_after_done: ${archivePolicy.git?.auto_commit_after_done ? "true" : "false"}`,
        `- stage_mode: ${archivePolicy.git?.stage_mode ?? "all_workspace_changes"}`,
        `- commit_message: ${(archivePolicy.git?.commit_message_template ?? "chore(harness): archive <run>").replaceAll("<run>", runId)}`
      ],
      "Current Git Worktree": gitStatus.length ? gitStatus.map((line) => `- ${line}`) : "- no changes",
      Reminder: [
        "After done, harness runs the archive commit automatically. If the commit is blocked by unrecorded files, record this run's changes with `harness:changed-files`, then rerun:",
        "",
        "```bash",
        `npm run harness:archive-commit -- ${runId}`,
        "```"
      ]
    }
  });
  await mkdir(path.dirname(reminderPath), { recursive: true });
  await writeFile(reminderPath, content, "utf8");
  console.log(`Archive reminder written: ${path.relative(root, reminderPath).replaceAll("\\", "/")}`);
  console.log("Archive reminder: confirm the git worktree contains only this run's relevant changes before automatic commit.");
}

function runArchiveCommit() {
  if (!archivePolicy.git?.enabled || !archivePolicy.git?.auto_commit_after_done) return;
  const result = spawnSync(process.execPath, [
    resolveScriptPath(root, "archive-commit.mjs"),
    runId
  ], {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit"
  });

  if (result.status !== 0) {
    console.error("Run reached done, but archive git commit failed. After fixing the issue, run:");
    console.error(`npm run harness:archive-commit -- ${runId}`);
    process.exit(result.status ?? 1);
  }
}

async function refreshDashboard() {
  const result = spawnSync(process.execPath, [
    resolveScriptPath(root, "dashboard.mjs")
  ], {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    env: {
      ...process.env,
      HARNESS_DASHBOARD_QUIET: "1"
    }
  });

  if (result.status !== 0) {
    console.error("Done reached, but dashboard generation failed.");
    process.exit(result.status ?? 1);
  }
}

function gitStatusShort() {
  const result = spawnSync("git", ["status", "--short"], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) return [`Failed to read git status: ${result.stderr?.trim() || result.stdout?.trim() || "unknown error"}`];
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}


