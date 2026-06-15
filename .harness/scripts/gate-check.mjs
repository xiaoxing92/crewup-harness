import { readFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { loadProjectProfile } from "./lib/project-profile.mjs";
import {
  artifactHasOwnerProvenance,
  collectArtifactProvenance,
  describeArtifactProvenance
} from "./lib/artifact-provenance.mjs";
import {
  configureDelegationGuard,
  collectWorkspaceChanges,
  evaluateDelegationGuard,
  readChangedFilesManifest,
  readNativeState,
  isBusinessCodePath,
  nativeExecutionProblems,
  requiredNativeAgentsForStageEntry,
  requiredNativeAgentsForStageCompletion
} from "./lib/delegation-guard.mjs";
import { hasTemplatePlaceholder } from "./lib/placeholder-detector.mjs";
import { isDocsOnlyAgentSet, isLiteImplementationOnlyAgentSet } from "./lib/agent-roles.mjs";
import { isImplementationAgentUnassigned } from "./lib/implementation-plan-scope.mjs";
import { verifyCoreLock } from "./lib/core-lock.mjs";
import { loadGeneratedMarkdownSchema, validateGeneratedMarkdownFile } from "./lib/generated-markdown.mjs";
import { browserRuntimeVerificationProblems } from "./lib/runtime-verification.mjs";
import { validateArtifactSemantics } from "./lib/artifact-renderer.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const runId = args.find((arg) => !arg.startsWith("--"));
const gateMode = args.includes("--entry") ? "entry" : args.includes("--completion") ? "completion" : "completion";

if (!runId) {
  console.error("Please provide runId, for example: npm run harness:gate-check -- 2026-05-14-001-blog-mvp");
  process.exit(1);
}

const runDir = path.join(root, ".harness", "runs", runId);
const artifactsDir = path.join(runDir, "artifacts");
const tasksDir = path.join(runDir, "tasks");
const logsDir = path.join(runDir, "logs");
const statePath = path.join(runDir, "state.json");
const schema = parseYaml(await readFile(path.join(root, ".harness", "config", "artifact-schema.yaml"), "utf8"));
const generatedMarkdownSchema = await loadGeneratedMarkdownSchema(root);
const { project_profile: projectProfile } = await loadProjectProfile(root);
configureDelegationGuard(projectProfile);

const problems = [];
const warnings = [];

if (!existsSync(runDir)) problems.push(`Run does not exist: ${runId}`);
if (!existsSync(statePath)) problems.push("Missing state.json");
if (!existsSync(tasksDir)) problems.push("Missing tasks/. Run npm run harness:prepare-run -- <run-id>.");

const state = existsSync(statePath) ? JSON.parse(await readFile(statePath, "utf8")) : {};
const artifactProvenance = await collectArtifactProvenance(root, runId);

await checkArtifacts();
await checkGeneratedMarkdown();
await checkCoreLock();
await checkArtifactProvenance();
await checkOwnerArtifactAudit();
await checkRequirementPlanGate();
await checkCompletionContract();
await checkNativeState();
await checkVerifyReport();
await checkReviewReport();
await checkReleaseSummary();
await checkBrowserRuntimeVerification();
await checkFeedbackLoop();
await checkRepairLoopBudget();
await checkDevServiceLifecycle();
await checkAgentLogs();
await checkNoCodeProfile();
await checkStageGate(state);
await checkStateConsistency(state);
await checkDelegationGuard(state);

if (problems.length > 0) {
  console.error("Quality gate failed:");
  for (const problem of problems) console.error(`- ${problem}`);
  if (warnings.length > 0) {
    console.warn("\nWarnings:");
    for (const warning of warnings) console.warn(`- ${warning}`);
  }
  process.exit(1);
}

console.log(`Quality gate passed (${gateMode}).`);
if (warnings.length > 0) {
  console.warn("Warnings:");
  for (const warning of warnings) console.warn(`- ${warning}`);
}

async function checkArtifacts() {
  const requiredForCurrentStage = new Set(requiredArtifactsForGate());
  for (const [file, rules] of Object.entries(schema.artifacts ?? {})) {
    const target = path.join(artifactsDir, file);
    if (!existsSync(target)) {
      if (rules.required === false || !requiredForCurrentStage.has(file)) continue;
      problems.push(`Missing artifact: ${file}`);
      continue;
    }

    const content = await readFile(target, "utf8");
    if (content.trim().length < 40) warnings.push(`Artifact is very short: ${file}`);
    if (hasPlaceholder(content)) {
      if (requiredForCurrentStage.has(file)) {
        problems.push(`Artifact still appears to contain placeholders: ${file}`);
      } else {
        warnings.push(`Artifact still appears to contain placeholders: ${file}`);
      }
    }

    for (const heading of rules.required_headings ?? []) {
      if (!hasAnyHeading(content, headingAliases(heading))) {
        problems.push(`Artifact missing heading: ${file} -> ${heading}`);
      }
    }
    problems.push(...validateArtifactSemantics(file, content));
  }
}

async function checkGeneratedMarkdown() {
  for (const file of Object.keys(generatedMarkdownSchema)) {
    if (!existsSync(path.join(runDir, file))) continue;
    const formatProblems = await validateGeneratedMarkdownFile({ root, runId, file, schema: generatedMarkdownSchema });
    problems.push(...formatProblems.map((problem) => `Generated Markdown schema violation: ${problem}`));
  }
}

async function checkCoreLock() {
  const result = await verifyCoreLock(root);
  if (!result.ok) problems.push(...result.problems);
}

async function checkArtifactProvenance() {
  const requiredForCurrentStage = new Set(requiredArtifactsForGate());
  for (const [file, rules] of Object.entries(schema.artifacts ?? {})) {
    if (!requiredForCurrentStage.has(file)) continue;
    if (!existsSync(path.join(artifactsDir, file))) continue;
    if (!rules.owner) continue;
    if (artifactHasOwnerProvenance(artifactProvenance, file, rules.owner)) continue;

    const message = `Artifact ${file} lacks provenance from owner ${rules.owner}. Found: ${describeArtifactProvenance(artifactProvenance, file)}`;
    if (shouldRequireArtifactProvenance()) problems.push(message);
    else warnings.push(`${message}. Treating as legacy/manual artifact until run has native/bridge/orchestrate results.`);
  }
}

async function checkOwnerArtifactAudit() {
  const nativeStatePath = path.join(logsDir, "native-subagents", "native-state.json");
  if (!existsSync(nativeStatePath)) return;

  const native = JSON.parse(await readFile(nativeStatePath, "utf8"));
  const nativeAgents = new Map((native.agents ?? []).map((agent) => [agent.agent, agent]));

  for (const [file, rules] of Object.entries(schema.artifacts ?? {})) {
    if (!rules.owner) continue;
    if (!existsSync(path.join(artifactsDir, file))) continue;
    if (!nativeAgents.has(rules.owner)) continue;
    if (artifactHasOwnerProvenance(artifactProvenance, file, rules.owner)) continue;

    const owner = nativeAgents.get(rules.owner);
    const ownerDone = Boolean(owner?.handle && owner?.result_captured_at && owner?.result_status === "completed");
    if (!ownerDone) {
      problems.push(`Owner artifact ${file} exists before owner agent ${rules.owner} completed and captured its result. The main agent must not author owner artifacts.`);
    } else {
      problems.push(`Owner artifact ${file} is missing artifactUpdates provenance from ${rules.owner}. Found: ${describeArtifactProvenance(artifactProvenance, file)}`);
    }
  }
}

function shouldRequireArtifactProvenance() {
  return Boolean(
    existsSync(path.join(logsDir, "orchestrate-results.json"))
      || existsSync(path.join(logsDir, "native-subagents", "native-state.json"))
      || existsSync(path.join(logsDir, "agent-bridge", "bridge-state.json"))
  );
}

async function checkRequirementPlanGate() {
  const planPath = path.join(artifactsDir, "requirement-plan.md");
  const requirementPath = path.join(artifactsDir, "requirement.md");
  const promotedPath = path.join(logsDir, "requirements-planning", "promoted.md");
  if (existsSync(planPath) && existsSync(requirementPath)) {
    const plan = await readFile(planPath, "utf8");
    const requirement = await readFile(requirementPath, "utf8");
    if (!isLiteImplementationOnlyRun() && plan.includes("plan-only") && !existsSync(promotedPath) && state.stage && !["intake", "requirements_plan"].includes(state.stage)) {
      warnings.push("requirement-plan.md exists but no promotion log was found.");
    }
    if (!isLiteImplementationOnlyRun() && state.stage && ["implement", "verify", "review", "release", "done"].includes(state.stage) && hasTemplatePlaceholder(requirement)) {
      problems.push("requirement.md still contains template placeholder before implementation/review stage.");
    }
  }
}

async function checkCompletionContract() {
  const goalPath = path.join(runDir, "GOAL.md");
  const contractPath = path.join(runDir, "completion-contract.json");
  const requiresContract = ["release", "done"].includes(state.stage) || state.status === "done";
  if (!existsSync(goalPath) || !existsSync(contractPath)) {
    const missing = [
      !existsSync(goalPath) ? "GOAL.md" : "",
      !existsSync(contractPath) ? "completion-contract.json" : ""
    ].filter(Boolean).join(", ");
    if (requiresContract) {
      problems.push(`Missing completion contract before closeout: ${missing}. Run spec-freeze or repair the run evidence before claiming SUCCESS.`);
    } else {
      warnings.push(`Completion contract not generated yet: ${missing}.`);
    }
    return;
  }
  const parsed = await readJsonStrict(contractPath);
  if (!parsed.ok) {
    problems.push(`Invalid completion-contract.json: ${parsed.error}`);
    return;
  }
  if (parsed.value.runId && parsed.value.runId !== runId) {
    problems.push(`completion-contract.json runId mismatch: ${parsed.value.runId}`);
  }
  if (!Array.isArray(parsed.value.successCriteria) || parsed.value.successCriteria.length === 0) {
    problems.push("completion-contract.json must include non-empty successCriteria.");
  }
}

async function checkNativeState() {
  const nativeStatePath = path.join(logsDir, "native-subagents", "native-state.json");
  const taskAgents = await availableTaskAgents();
  const requiredAgents = gateMode === "entry"
    ? requiredNativeAgentsForStageEntry(state.stage, { root, runId, state, taskAgents })
    : requiredNativeAgentsForStageCompletion(state.stage, { root, runId, state, taskAgents });
  if (!existsSync(nativeStatePath)) {
    if (requiredAgents.length > 0) {
      problems.push(`No native-state.json found, but stage ${state.stage} requires subagent execution records for: ${requiredAgents.join(", ")}`);
    } else {
      warnings.push("No native-state.json found. This is fine only if the run did not use native subagents.");
    }
    return;
  }

  const native = JSON.parse(await readFile(nativeStatePath, "utf8"));
  if (native.fallback && requiredAgents.length > 0) {
    problems.push(`Native fallback is recorded but stage ${state.stage} still requires real subagent results: ${native.fallback.reason}`);
  }

  if (!native.fallback && requiredAgents.length > 0) {
    problems.push(...nativeExecutionProblems({
      nativeState: native,
      requiredAgents,
      label: state.stage
    }));
  }

  for (const agent of native.agents ?? []) {
    const unassignedImplementation = isImplementationAgentUnassigned(agent.agent, { root, runId });
    const resultPathExists = agent.result_path && existsSync(resolveWorkspacePath(agent.result_path));
    const resultJsonPathExists = agent.result_json_path && existsSync(resolveWorkspacePath(agent.result_json_path));
    if (resultJsonPathExists) {
      const parsed = await readJsonStrict(resolveWorkspacePath(agent.result_json_path));
      if (!parsed.ok) {
        problems.push(`Invalid native result JSON for ${agent.agent}: ${agent.result_json_path} (${parsed.error})`);
      } else {
        if (parsed.value.agent && parsed.value.agent !== agent.agent) {
          problems.push(`Native result JSON agent mismatch for ${agent.agent}: ${agent.result_json_path} declares ${parsed.value.agent}`);
        }
        if (parsed.value.status && !["completed", "blocked", "needs_input"].includes(parsed.value.status)) {
          problems.push(`Invalid native result JSON status for ${agent.agent}: ${parsed.value.status}`);
        }
      }
    }
    if (!agent.result_captured_at && (resultPathExists || resultJsonPathExists)) {
      problems.push(`Native result files exist but native-state has not captured result for ${agent.agent}. Record the real handle/result or rerun the subagent; do not fabricate a handle.`);
    }
    if (["running"].includes(agent.status) && !unassignedImplementation) warnings.push(`Native agent is still running: ${agent.agent}`);
    if (gateMode === "completion" && ["verify", "review", "release", "done"].includes(state.stage) && !native.fallback && agent.status === "planned" && !agent.handle && !agent.result_captured_at && !unassignedImplementation) {
      problems.push(`Native agent was planned but never executed before ${state.stage}: ${agent.agent}`);
    }
    if (["completed", "blocked", "needs_input", "waiting_review", "ready_to_close", "closed"].includes(agent.status) && !agent.handle) {
      problems.push(`Native agent has captured/terminal status without a real spawn handle: ${agent.agent}`);
    }
    if (state.stage === "done" && agent.close_required && agent.status !== "closed" && !unassignedImplementation) {
      problems.push(`Native agent must be closed before done/archive: ${agent.agent} (${agent.status})`);
    }
    if (agent.status === "ready_to_close" && !agent.close_confirmed && !unassignedImplementation) {
      problems.push(`Native agent is ready_to_close but not closed: ${agent.agent}`);
    }
    if (agent.result_captured_at && (!agent.result_path || !existsSync(resolveWorkspacePath(agent.result_path)))) {
      problems.push(`Native agent result was marked captured but result file is missing: ${agent.agent}`);
    }
    if (["completed", "blocked", "needs_input", "waiting_review", "ready_to_close", "closed"].includes(agent.status) && !agent.result_captured_at) {
      warnings.push(`Native agent has terminal/review status without captured result: ${agent.agent}`);
    }
  }
}

function resolveWorkspacePath(target) {
  return path.isAbsolute(target) ? target : path.join(root, target);
}

async function availableTaskAgents() {
  if (!existsSync(tasksDir)) return new Set();
  const entries = await readdir(tasksDir, { withFileTypes: true }).catch(() => []);
  return new Set(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".task.md"))
      .map((entry) => entry.name.replace(/\.task\.md$/, ""))
  );
}

function requiredArtifactsForStage(stage) {
  if (isDocsOnlyRun()) {
    return stage === "verify" ? ["test-report.md"] : stage === "review" ? ["test-report.md", "review-report.md"] : stage === "release" || stage === "done" ? ["test-report.md", "review-report.md", "release-summary.md"] : [];
  }
  if (stage === "requirements_plan" && isLiteImplementationOnlyRun()) return [];
  const byStage = {
    requirements_plan: ["requirement-plan.md"],
    requirements_confirm: ["requirement-plan.md"],
    plan: ["requirement.md"],
    implement: isLiteImplementationOnlyRun() ? [] : ["requirement.md", "architecture.md", "implementation-plan.md"],
    verify: ["test-report.md"],
    review: ["test-report.md", "review-report.md"],
    release: ["review-report.md", "release-summary.md"],
    done: ["test-report.md", "review-report.md", "release-summary.md"]
  };
  return byStage[stage] ?? [];
}

function requiredArtifactsForGate() {
  return gateMode === "entry"
    ? requiredArtifactsForStage(previousStage(state.stage))
    : requiredArtifactsForStage(state.stage);
}

function previousStage(stage) {
  const previous = {
    requirements_confirm: "requirements_plan",
    plan: "requirements_confirm",
    implement: "plan",
    verify: "implement",
    review: "verify",
    release: "review",
    done: "release"
  };
  return previous[stage] ?? stage;
}

function isLiteImplementationOnlyRun() {
  return isLiteImplementationOnlyAgentSet(availableTaskAgentsSync(), state.workflowProfile);
}

function availableTaskAgentsSync() {
  if (!existsSync(tasksDir)) return new Set();
  return new Set(
    readdirSync(tasksDir)
      .filter((name) => name.endsWith(".task.md"))
      .map((name) => name.replace(/\.task\.md$/, ""))
  );
}

async function checkVerifyReport() {
  const target = path.join(artifactsDir, "test-report.md");
  if (!existsSync(target)) return;
  const content = await readFile(target, "utf8");
  if (hasRequiredCheckFailure(content)) {
    problems.push("Required verification failed in test-report.md.");
  }
  if (state.stage && ["review", "release", "done"].includes(state.stage) && hasAcceptanceCriteria() && !/AC-\d+/i.test(content)) {
    problems.push("test-report.md does not reference numbered acceptance criteria (AC-*).");
  }
}

async function checkReviewReport() {
  const target = path.join(artifactsDir, "review-report.md");
  if (!existsSync(target)) return;
  const content = await readFile(target, "utf8");
  if (["release", "done"].includes(state.stage) && reviewHasBlockingIssues(content)) {
    problems.push("review-report.md is not passed or still contains blocking issues.");
  }
}

async function checkReleaseSummary() {
  const target = path.join(artifactsDir, "release-summary.md");
  if (!existsSync(target)) return;
  const content = await readFile(target, "utf8");
  if (state.stage === "done" && hasPlaceholder(content)) {
    problems.push("release-summary.md still contains placeholders before done.");
  }
}

async function checkBrowserRuntimeVerification() {
  if (state.stage !== "done") return;
  const runtimeProblems = await browserRuntimeVerificationProblems({ root, runId, state, tasksDir });
  problems.push(...runtimeProblems);
}

async function checkFeedbackLoop() {
  if (!["review", "release", "done"].includes(state.stage)) return;
  for (const agent of ["tester", "reviewer"]) {
    const payload = await readAgentResultJson(agent);
    if (!payload) continue;
    if (payload.fixRequired === true || (payload.requiredFixes ?? []).length > 0 || (payload.blockingIssues ?? []).length > 0) {
      const targets = (payload.targetAgents ?? []).join(", ") || "(missing targetAgents)";
      problems.push(`${agent} feedback requires delegated repair before continuing. targetAgents: ${targets}`);
    }
  }
}

async function checkRepairLoopBudget() {
  const contract = await readOptionalJson(path.join(runDir, "completion-contract.json"));
  const loop = await readOptionalJson(path.join(logsDir, "repair-loop.json"));
  if (!loop) return;
  const maxRepairRounds = Number(contract?.maxRepairRounds ?? loop.maxRepairRounds ?? 3);
  const rounds = Array.isArray(loop.rounds) ? loop.rounds.length : Number(loop.round ?? 0);
  if (rounds > maxRepairRounds) {
    problems.push(`Repair loop exceeded maxRepairRounds (${rounds}/${maxRepairRounds}). Archive as blocked/partial or narrow the scope instead of continuing indefinitely.`);
  }
}

async function checkDevServiceLifecycle() {
  if (state.stage !== "done") return;
  const target = path.join(logsDir, "dev-service.json");
  if (!existsSync(target)) return;
  const service = JSON.parse(await readFile(target, "utf8"));
  if (service.status !== "running" || !service.pid) return;
  if (isPidRunning(service.pid)) {
    problems.push(`Dev service is still running at done/archive: pid ${service.pid}. Run npm run harness:dev-service -- ${runId} stop`);
  }
}

async function readAgentResultJson(agent) {
  const nativePath = path.join(logsDir, "native-subagents", `${agent}.result.json`);
  const bridgePath = path.join(logsDir, "agent-bridge", `${agent}.result.json`);
  for (const target of [nativePath, bridgePath]) {
    if (!existsSync(target)) continue;
    try {
      return JSON.parse(await readFile(target, "utf8"));
    } catch {
      warnings.push(`Invalid JSON result for ${agent}: ${path.relative(root, target)}`);
    }
  }
  return null;
}

async function readOptionalJson(target) {
  if (!existsSync(target)) return null;
  try {
    return JSON.parse((await readFile(target, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    warnings.push(`Invalid JSON: ${path.relative(root, target)}`);
    return null;
  }
}

async function readJsonStrict(target) {
  try {
    return { ok: true, value: JSON.parse((await readFile(target, "utf8")).replace(/^\uFEFF/, "")) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function isPidRunning(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

async function checkAgentLogs() {
  const resultsPath = path.join(logsDir, "orchestrate-results.json");
  if (!existsSync(resultsPath)) return;
  const parsed = JSON.parse(await readFile(resultsPath, "utf8"));
  for (const result of parsed.results ?? []) {
    if (result.status === "blocked") problems.push(`Agent blocked: ${result.agent}`);
    if ((result.blockers ?? []).length > 0) problems.push(`Agent has blockers: ${result.agent}`);
  }
}

async function checkNoCodeProfile() {
  if (!isNoCodeProfile()) return;
  const workspaceFiles = collectWorkspaceChanges(root, runId, state);
  const manifestFiles = readChangedFilesManifest(root, runId);
  const businessFiles = [...new Set([...workspaceFiles, ...manifestFiles].filter(isBusinessCodePath))];
  if (businessFiles.length === 0) return;
  problems.push(`No-code workflow profile ${state.workflowProfile} detected business code changes: ${businessFiles.join(", ")}`);
  problems.push("Planning-only runs must stop at requirements/architecture/review artifacts; create a separate implementation run for code changes.");
}

async function checkStageGate(currentState) {
  const stage = currentState.stage;
  if (!stage) return;
  const usesTransitionState = Boolean(currentState.confirmations) || (currentState.transitions ?? []).length > 0;
  if (!isDocsOnlyRun() && ["implement", "verify", "review", "release", "done"].includes(stage) && !currentState.confirmations?.implementation_approved_at) {
    const message = "Implementation stage or later should have implementation approval in state.json.";
    if (usesTransitionState) problems.push(message);
    else warnings.push(`${message} Treating as legacy run because no transition state exists.`);
  }
  if (stage === "done") {
    for (const artifact of ["test-report.md", "review-report.md", "release-summary.md"]) {
      if (!existsSync(path.join(artifactsDir, artifact))) problems.push(`Done stage missing artifact: ${artifact}`);
    }
  }
}

function isNoCodeProfile() {
  return ["discovery", "plan_only"].includes(state.workflowProfile) || ["discovery", "plan_only"].includes(state.runType);
}

async function checkStateConsistency(currentState) {
  if (!currentState.status || !currentState.stage) return;
  if (currentState.status === "done" && currentState.stage !== "done") {
    problems.push(`State mismatch: status is done but stage is ${currentState.stage}. Run harness:repair-state or transition to done.`);
  }
  if (currentState.status === "archived" && currentState.stage !== "done") {
    warnings.push(`State mismatch: archived run is not at done stage (${currentState.stage}).`);
  }
}

async function checkDelegationGuard(currentState) {
  const nativeState = await readNativeState(root, runId);
  const workspaceFiles = collectWorkspaceChanges(root, runId, currentState);
  const manifestFiles = readChangedFilesManifest(root, runId);
  const issues = evaluateDelegationGuard({
    root,
    runId,
    state: currentState,
    workspaceFiles,
    manifestFiles,
    nativeState,
    targetStage: currentState.stage
  });

  if (issues.length > 0) {
    problems.push(...issues);
  }
}

function hasPlaceholder(content) {
  return hasTemplatePlaceholder(content);
}

function isDocsOnlyRun() {
  return isDocsOnlyAgentSet(availableTaskAgentsSync());
}

function hasAcceptanceCriteria() {
  const target = path.join(artifactsDir, "requirement.md");
  if (!existsSync(target)) return false;
  const content = readFileSync(target, "utf8");
  return /AC-\d+/i.test(content);
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


