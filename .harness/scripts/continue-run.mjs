import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveScriptPath } from "./lib/script-root.mjs";
import { modeLabel } from "./lib/workflow-modes.mjs";
import { analyzeWorkload } from "./lib/workload-analysis.mjs";
import { recommendedContinueProfile } from "./lib/mode-picker.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const sourceRunId = args.find((arg) => !arg.startsWith("--"));
const text = args.filter((arg) => arg !== sourceRunId && !arg.startsWith("--")).join(" ").trim();
const explicitMode = valueOf("--mode=");
const explicitProfile = valueOf("--profile=");
const risk = valueOf("--risk=") ?? "normal";

if (!sourceRunId || !text) {
  console.error('Usage: npx crewup continue <source-run-id> "Continue from the previous blocker..."');
  process.exit(1);
}

if (!existsSync(path.join(root, ".harness", "runs", sourceRunId))) {
  console.error(`Source run not found: ${sourceRunId}`);
  process.exit(1);
}

let sourceState = null;
try {
  sourceState = JSON.parse(readFileSync(path.join(root, ".harness", "runs", sourceRunId, "state.json"), "utf8"));
} catch {
  sourceState = null;
}

const continuationProfile = resolveContinuationProfile({ sourceState, text, explicitMode, explicitProfile, risk });
const profileArgs = explicitMode
  ? [`--mode=${explicitMode}`, `--risk=${risk}`]
  : explicitProfile
    ? [`--profile=${explicitProfile}`]
    : [`--profile=${continuationProfile}`];
if (!explicitMode && !explicitProfile) {
  console.log(`Continuing ${sourceRunId} with continuation mode: ${modeLabel({ profile: continuationProfile })} (profile: ${continuationProfile})`);
}
const result = spawnSync(process.execPath, [
  resolveScriptPath(root, "run.mjs"),
  `--from-run=${sourceRunId}`,
  ...profileArgs,
  text
], {
  cwd: root,
  stdio: "inherit",
  env: process.env
});

process.exit(result.status ?? 1);

function resolveContinuationProfile({ sourceState: state, text: requestText, explicitMode: mode, explicitProfile: profile, risk: riskLevel }) {
  if (profile) return profile;
  if (mode) return null;
  const recommended = recommendedContinueProfile(requestText, state);
  if (recommended) return recommended;
  const analysis = analyzeWorkload(requestText, { requestedProfile: "auto" });
  if (riskLevel === "high") return "full";
  if (isClosedSuccess(state) && isSmallFollowUp(requestText, analysis)) return "lite-v2";
  return analysis.workflowProfile;
}

function isClosedSuccess(state) {
  return state?.archived === true && state?.outcome === "success";
}

function isSmallFollowUp(textValue, analysis) {
  if (analysis.signals.highRisk || analysis.signals.deepPlanning || analysis.signals.strictWorkflow || analysis.signals.discovery || analysis.signals.planOnly) return false;
  return /bug|fix|修复|报错|错误|runtime|console|运行|启动|小改|单点|回归/i.test(String(textValue ?? ""))
    || analysis.workflowProfile === "lite"
    || analysis.complexityScore <= 2;
}

function valueOf(prefix) {
  const arg = args.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}
