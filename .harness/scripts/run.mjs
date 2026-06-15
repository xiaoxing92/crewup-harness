import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { analyzeWorkload, renderWorkloadAnalysisMarkdown } from "./lib/workload-analysis.mjs";
import { resolveScriptPath } from "./lib/script-root.mjs";
import { isNativeAgentEnvironment, readAgentEnvironment } from "./lib/agent-runtime.mjs";
import { semanticSlugFromText } from "./lib/naming.mjs";
import { writeRunState, writeRunStatus } from "./lib/run-lifecycle.mjs";
import { assertKnownMode, modeHelpText, modeLabel, profileFromMode } from "./lib/workflow-modes.mjs";
import { recommendedRunProfile } from "./lib/mode-picker.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const text = valueOf("--text=") ?? positionalText();
const runIdArg = valueOf("--run=");
const fromRunId = valueOf("--from-run=");
const modeArg = valueOf("--mode=");
const riskArg = valueOf("--risk=") ?? "normal";
const explicitProfileArg = valueOf("--profile=");
const inputText = text?.trim() ?? "";
const inferredDefaultProfile = explicitProfileArg || modeArg ? null : recommendedRunProfile(inputText);
const profileArg = explicitProfileArg ?? profileFromMode(modeArg, riskArg) ?? inferredDefaultProfile ?? "auto";
const agentsArg = valueOf("--agents=");
const dryRun = args.includes("--dry-run");

if (!text?.trim() && !runIdArg) {
  console.error('Please provide a request, for example: npx crewup run "Build a minimal counter page"');
  console.error("Or continue preparing an existing run: npx crewup run --run=<run-id>");
  process.exit(1);
}

const summary = [];
try {
  assertKnownMode(modeArg);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const analysis = analyzeWorkload(inputText, { requestedProfile: profileArg });

if (dryRun) {
  console.log(renderWorkloadAnalysisMarkdown(analysis));
  process.exit(0);
}

let runId = runIdArg;
if (!runId) {
  runId = await createDirectRun(inputText, analysis, { fromRunId });
  summary.push(`run: ${runId}`);
}

if (!runId || !existsSync(path.join(root, ".harness", "runs", runId))) {
  console.error(`Run not found: ${runId}`);
  process.exit(1);
}

const runDir = path.join(root, ".harness", "runs", runId);
await mkdir(path.join(runDir, "logs"), { recursive: true });
await writeFile(path.join(runDir, "logs", "workload-analysis.md"), renderWorkloadAnalysisMarkdown(analysis), "utf8");
await writeFile(path.join(runDir, "logs", "workload-analysis.json"), `${JSON.stringify(analysis, null, 2)}\n`, "utf8");

runText("knowledge.mjs", []);
summary.push("knowledge: refreshed");

runText("knowledge-select.mjs", [runId]);
summary.push("knowledge-select: related-runs");

runText("prepare-run.mjs", [runId, `--profile=${analysis.workflowProfile}`]);
summary.push(`prepare-run: ${analysis.workflowProfile}`);

if (analysis.workflowProfile !== "lite-v2") {
  runText("spec-freeze.mjs", [runId]);
  summary.push("spec-freeze: created");
} else {
  summary.push("lite-v2: spec/tasks prepared");
}

if (analysis.needsRequirementsPlan) summary.push("requirements-plan: delegated to subagent");

const agents = agentsArg ?? await agentsFromTasks(runId);
if (agents && analysis.workflowProfile !== "lite-v2") {
  runText("context-pack.mjs", [runId, `--agents=${agents}`]);
  runText("native-plan.mjs", [runId, `--agents=${agents}`]);
  summary.push(`native-plan: ${agents}`);

  runText("token-ledger.mjs", [runId]);
  summary.push("token-ledger: created");
}

await writeRunSummary(runId, { summary, analysis });
await writeRunStatus(root, runId);

console.log(`CrewUp run prepared: ${runId}`);
console.log(`- mode: ${modeLabel({ mode: modeArg, profile: analysis.workflowProfile, risk: riskArg })}${!modeArg && !explicitProfileArg ? " (auto)" : ""}`);
if (modeArg === "strict") console.log(`- risk: ${riskArg}`);
console.log(`- profile: ${analysis.workflowProfile}`);
console.log(`- run_type: ${analysis.runType}`);
console.log(`- complexity: ${analysis.complexityScore}/5 (${analysis.complexityLevel})`);
console.log(`- agents: ${agents || "(none)"}`);
console.log(`- status: .harness/runs/${runId}/RUN_STATUS.md`);
const agentEnvironment = await readAgentEnvironment(root);
if (isNativeAgentEnvironment(agentEnvironment)) {
  if (analysis.workflowProfile === "lite-v2") {
    console.log("Next: implement directly inside the lite-v2 scope, update validation.md and summary.md, then run: crewup finish <run-id>");
  } else {
    console.log("Next: read native-subagent-plan.json and start only currently runnable native subagents.");
  }
} else {
  if (analysis.workflowProfile === "lite-v2") {
    console.log("Next: implement directly inside the lite-v2 scope, update validation.md and summary.md, then run: crewup finish <run-id>");
  } else {
    console.log("Next: external agent reads agent-bridge/*.handoff.md and writes back *.result.json.");
  }
}

function runText(script, scriptArgs) {
  const result = spawnSync(process.execPath, [resolveScriptPath(root, script), ...scriptArgs], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    if (result.stdout?.trim()) console.error(result.stdout.trim());
    if (result.stderr?.trim()) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

async function agentsFromTasks(currentRunId) {
  const tasksDir = path.join(root, ".harness", "runs", currentRunId, "tasks");
  const entries = await readdir(tasksDir, { withFileTypes: true }).catch(() => []);
  const agents = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".task.md"))
    .map((entry) => entry.name.replace(/\.task\.md$/, ""))
    .sort();
  return agents.join(",");
}

async function writeRunSummary(currentRunId, data) {
  const target = path.join(root, ".harness", "runs", currentRunId, "logs", "harness-run.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, renderSummary(data), "utf8");
}

function renderSummary({ summary: items, analysis: workload }) {
  return [
    "# Harness Run Entry Summary",
    "",
    `- generatedAt: ${new Date().toISOString()}`,
    "- source: direct_run",
    `- workflow_profile: ${workload.workflowProfile}`,
    `- run_type: ${workload.runType}`,
    `- complexity: ${workload.complexityScore}/5 (${workload.complexityLevel})`,
    "",
    "## Steps",
    "",
    ...items.map((entry) => `- ${entry}`),
    "",
    "## Analysis",
    "",
    ...workload.reasons.map((entry) => `- ${entry}`),
    ""
  ].join("\n");
}

async function createDirectRun(requestText, workload, { fromRunId: sourceRunId = null } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const sequence = await nextRunSequence(today);
  const slug = semanticSlugFromText(requestText, "crewup-run");
  const runId = `${today}-${sequence}-${slug}`;
  const runDir = path.join(root, ".harness", "runs", runId);
  if (existsSync(runDir)) {
    console.error(`Run already exists: ${path.relative(root, runDir)}`);
    process.exit(1);
  }

  await mkdir(path.join(runDir, "artifacts"), { recursive: true });
  await mkdir(path.join(runDir, "logs"), { recursive: true });
  const input = sourceRunId ? await renderContinuationInput(sourceRunId, requestText) : `${requestText.trim()}\n`;
  await writeFile(path.join(runDir, "input.md"), input, "utf8");
  await writeFile(path.join(runDir, "artifacts", ".gitkeep"), "", "utf8");

  const now = new Date().toISOString();
  const git = createRunBranch(runId, slug);
  const runtimeVerificationRequired = shouldRequireRuntimeVerificationForRun(requestText, workload, sourceRunId);
  const state = {
    runId,
    source: sourceRunId ? "continue_run" : "direct_run",
    sourceRunId,
    stage: "requirements_plan",
    status: "active",
    outcome: "none",
    archived: false,
    workflowProfile: workload.workflowProfile,
    runType: workload.runType,
    runtimeVerificationRequired,
    primaryLanguage: workload.primaryLanguage,
    owners: ["requirements-plan"],
    createdAt: now,
    updatedAt: now,
    confirmations: {},
    transitions: [
      {
        from: "intake",
        to: "requirements_plan",
        at: now,
        reason: "direct_run_created"
      }
    ],
    git
  };
  await writeRunState(root, runId, state);
  await writeFile(path.join(runDir, "logs", "created.md"), renderCreatedLog({ runId, requestText, now, git, sourceRunId }), "utf8");
  return runId;
}

async function renderContinuationInput(sourceRunId, requestText) {
  const sourceDir = path.join(root, ".harness", "runs", sourceRunId);
  if (!existsSync(sourceDir)) {
    console.error(`Source run not found: ${sourceRunId}`);
    process.exit(1);
  }
  const status = await readOptional(path.join(sourceDir, "RUN_STATUS.md"));
  const summary = await readOptional(path.join(sourceDir, "RUN_SUMMARY.md"));
  const requirement = await readOptional(path.join(sourceDir, "artifacts", "requirement.md"));
  const architecture = await readOptional(path.join(sourceDir, "artifacts", "architecture.md"));
  const implementationPlan = await readOptional(path.join(sourceDir, "artifacts", "implementation-plan.md"));
  return [
    `# Continuation Request From ${sourceRunId}`,
    "",
    "## New Request",
    "",
    requestText.trim(),
    "",
    "## Source Run Status",
    "",
    status || "No RUN_STATUS.md found.",
    "",
    "## Source Run Summary",
    "",
    summary || "No RUN_SUMMARY.md found.",
    "",
    "## Reusable Requirement",
    "",
    firstChars(requirement, 12000) || "No requirement.md found.",
    "",
    "## Reusable Architecture",
    "",
    firstChars(architecture, 12000) || "No architecture.md found.",
    "",
    "## Reusable Implementation Plan",
    "",
    firstChars(implementationPlan, 12000) || "No implementation-plan.md found.",
    "",
    "## Continuation Validation Contract",
    "",
    shouldRequireRuntimeVerificationForRun(requestText, { workflowProfile: "lite-v2" }, sourceRunId)
      ? [
          "- This continuation targets a runtime/browser-facing follow-up.",
          "- Before success, start the app and run browser runtime preview smoke.",
          "- Required command shape: `npx crewup preview-smoke <run-id> --browser --url=<local-url>`.",
          "- `validation.md` and `summary.md` must record the browser smoke result and any console/page runtime errors."
        ].join("\n")
      : "- Follow the validation requirements selected for this continuation run.",
    ""
  ].join("\n");
}

function shouldRequireRuntimeVerificationForRun(requestText, workload, sourceRunId) {
  const textValue = String(requestText ?? "");
  if (/(docs only|documentation only)/i.test(textValue)) return false;
  const explicitRuntimeRisk = /(next\.?js|react|runtime|console|hydration|browser|page\s+error|pageerror|start(?:up)?|launch|dev server|preview|运行|启动|报错|错误)/i.test(textValue);
  if (sourceRunId) return explicitRuntimeRisk;
  return explicitRuntimeRisk && ["standard", "full"].includes(workload?.workflowProfile);
}
async function readOptional(target) {
  if (!existsSync(target)) return "";
  return await readFile(target, "utf8").catch(() => "");
}

function firstChars(value, max) {
  const text = String(value ?? "").trim();
  return text.length > max ? `${text.slice(0, max)}\n\n...truncated...` : text;
}

function renderCreatedLog({ runId, requestText, now, git, sourceRunId }) {
  return [
    "# Run Created",
    "",
    `- runId: ${runId}`,
    `- source: ${sourceRunId ? "continue_run" : "direct_run"}`,
    `- sourceRunId: ${sourceRunId ?? "(none)"}`,
    `- createdAt: ${now}`,
    `- branch: ${git.branch ?? "(none)"}`,
    `- branchCreated: ${git.createdByHarness ? "yes" : "no"}`,
    `- branchReason: ${git.reason || "none"}`,
    `- initialCommitExists: ${git.initialCommitExists === false ? "no" : git.initialCommitExists === true ? "yes" : "unknown"}`,
    `- baselineRecommendation: ${git.baselineRecommendation || "none"}`,
    "",
    "## Original Request",
    "",
    requestText.trim(),
    ""
  ].join("\n");
}

async function nextRunSequence(today) {
  const runsRoot = path.join(root, ".harness", "runs");
  const entries = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
  const numbers = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${today}-`))
    .map((entry) => Number(new RegExp(`^${today}-(\\d{3})-`).exec(entry.name)?.[1] ?? 0))
    .filter(Boolean);
  return String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(3, "0");
}

function createRunBranch(runId, slug) {
  const inside = git(["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    return { available: false, createdByHarness: false, branch: null, baseBranch: null, baseCommit: null, reason: "not a git worktree" };
  }
  const baseBranch = git(["branch", "--show-current"]).stdout.trim() || "HEAD";
  const head = git(["rev-parse", "--verify", "HEAD"]);
  const hasInitialCommit = head.status === 0;
  const baseCommit = hasInitialCommit ? head.stdout.trim() : null;
  const status = git(["status", "--short"]).stdout.trim().split(/\r?\n/).filter(Boolean);
  const branch = `crewup/${runId}-${slug}`.slice(0, 180);
  const created = git(["switch", "-c", branch]);
  return {
    available: true,
    initialCommitExists: hasInitialCommit,
    createdByHarness: created.status === 0,
    branch: created.status === 0 ? branch : baseBranch,
    plannedBranch: branch,
    baseBranch,
    baseCommit,
    baselineRecommendation: hasInitialCommit ? "" : "Create an initial git commit before large CrewUp runs so changed-file and archive gates have a stable baseline.",
    dirtyAtStart: status,
    reason: created.status === 0
      ? (!hasInitialCommit
          ? "branch created without an initial commit; baseline is recommended"
          : (status.length > 0 ? "branch created with existing uncommitted changes recorded" : ""))
      : (hasInitialCommit ? "git branch creation failed" : "git branch creation failed; repository has no initial commit")
  };
}

function git(gitArgs) {
  return spawnSync("git", gitArgs, { cwd: root, encoding: "utf8" });
}

function valueOf(prefix) {
  const arg = args.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function positionalText() {
  return args.filter((arg) => !arg.startsWith("--")).join(" ").trim();
}
