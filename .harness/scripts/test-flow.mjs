import { mkdir, readFile, readdir, rm, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { hasTemplatePlaceholder } from "./lib/placeholder-detector.mjs";
import { sortByExecutionOrder } from "./lib/execution-order.mjs";

const root = process.cwd();
const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "crewup-flow-"));
const appDir = path.join(tmpRoot, "app");
const packDir = path.join(tmpRoot, "pack");
let smokeServer = null;

await mkdir(appDir, { recursive: true });
await mkdir(packDir, { recursive: true });

try {
  assertPlaceholderDetector();

  runNpm(["init", "-y"], appDir);
  runGit(["init"], appDir);
  const tarball = packPackage(packDir);
  runNpm(["install", "--no-audit", "--no-fund", "--prefer-offline", tarball], appDir, { timeoutMs: 120000 });
  await assertInstallResetPath(tmpRoot, tarball);

  runCli(appDir, ["install"]);
  await seedExistingHarnessState(appDir);
  runCli(appDir, ["install", "--force"]);
  assertExistingHarnessStatePreserved(appDir);
  assertExists(path.join(appDir, ".harness", "core-lock.json"), "sealed core lock");

  runCli(appDir, ["inspect", "--no-ai"]);
  runCli(appDir, ["init", "--yes", "--agent", "codex"]);
  runCli(appDir, ["check"]);
  await assertSealedCoreDriftDetected(appDir);
  commitBaseline(appDir);
  await writeFile(path.join(appDir, "baseline-dirty.txt"), "pre-run dirty file\n", "utf8");
  const mainAgentDoc = await readFile(path.join(appDir, ".harness", "orchestrator", "main-agent.md"), "utf8");
  assertIncludes(mainAgentDoc, "Do not ask the user to open a terminal just to create a runId", "chat entry run creation rule");
  assertIncludes(mainAgentDoc, "`next-agent` is the only dispatch authority", "next-agent dispatch authority rule");
  assertIncludes(mainAgentDoc, "After an agent finishes, register its result first, then run `next-agent` again", "post-result next-agent rule");
  assertIncludes(mainAgentDoc, "Do not paste full subagent result files into the main window", "no long subagent paste rule");
  assertIncludes(mainAgentDoc, "Status card: .harness/runs/<run-id>/RUN_STATUS.md", "path-based status reporting rule");
  assertIncludes(mainAgentDoc, "run `next-agent` and start only agents listed as runnable", "next-agent spawn rule");
  assertIncludes(mainAgentDoc, "record optional tool/plugin/MCP fallback with `tool-fallback`", "tool fallback logging rule");
  assertIncludes(mainAgentDoc, "Run `npx crewup audit <run-id>`", "audit before close rule");
  assertIncludes(mainAgentDoc, "Use owner-agent repair first", "owner repair before state repair rule");
  const doctorOutput = runCli(appDir, ["doctor"]);
  assertIncludes(doctorOutput, "code_intelligence", "optional code intelligence integration in doctor");
  assertIncludes(doctorOutput, "Optional Integrations", "optional integration section in doctor");

  const missingGate = runInstalledScript(appDir, ".harness/scripts/gate-check.mjs", ["missing-run"], { expectedStatus: 1 });
  assertNotIncludes(missingGate, "SyntaxError", "gate-check syntax error");

  const implicitRunOutput = runCli(appDir, [
    "run",
    "Use CrewUp to create a real tiny UI run without an explicit mode."
  ]);
  assertIncludes(implicitRunOutput, "- mode: lite (auto)", "real run without mode auto-selects lite-v2");
  assertIncludes(implicitRunOutput, "- profile: lite-v2", "auto mode uses direct lite-v2 for tiny run");

  const planOnlyOutput = runCli(appDir, [
    "run",
    "--dry-run",
    "\u4f7f\u7528 CrewUp \u5148\u89c4\u5212\u4e00\u4e2a\u5927\u578b\u7cfb\u7edf\u7684\u6a21\u5757\u8fb9\u754c\u548c\u6280\u672f\u8def\u7ebf\uff0c\u4e0d\u5199\u4ee3\u7801"
  ]);
  assertIncludes(planOnlyOutput, "workflow_profile: plan_only", "plan-only dry run profile");

  const strictLoopOutput = runCli(appDir, [
    "run",
    "--dry-run",
    "\u7528 crewup \u505a\u4e00\u4e2a\u6700\u5c0f\u53ef\u8fd0\u884c MVP\uff0c\u5fc5\u987b\u5b8c\u6574\u95ed\u73af\uff1a\u9700\u6c42\u786e\u8ba4\u3001\u67b6\u6784/\u5b9e\u73b0\u8ba1\u5212\u3001frontend \u5b9e\u73b0\u3001tester \u9a8c\u8bc1\u3001reviewer \u5ba1\u67e5\u3001release \u603b\u7ed3\u3002"
  ]);
  assertIncludes(strictLoopOutput, "workflow_profile: full", "explicit strict workflow stays full");

  const tinyLiteOutput = runCli(appDir, [
    "run",
    "--dry-run",
    "\u4f7f\u7528 CrewUp \u4fee\u4e00\u4e2a\u5f88\u5c0f\u7684\u524d\u7aef UI \u95ee\u9898\uff0c\u8dd1 harness \u6d41\u7a0b"
  ]);
  assertIncludes(tinyLiteOutput, "workflow_profile: lite-v2", "tiny auto run defaults to lite-v2");
  assertIncludes(tinyLiteOutput, "needs_requirements_plan: false", "lite-v2 skips requirements planning");

  const formalLiteRunOutput = runCli(appDir, [
    "run",
    "--mode=lite",
    "Use CrewUp lite to fix a small frontend UI issue with delegated verification."
  ]);
  const formalLiteRunId = extractRunId(formalLiteRunOutput);
  if (!formalLiteRunId) throw new Error(`Failed to detect formal lite runId from output: ${formalLiteRunOutput}`);
  assertIncludes(formalLiteRunOutput, "- profile: lite", "--mode=lite maps to formal lite profile");
  const formalLiteTaskNames = sortByExecutionOrder(await listTaskNames(path.join(appDir, ".harness", "runs", formalLiteRunId, "tasks")));
  assertIncludes(formalLiteTaskNames.join(","), "tester", "formal lite keeps tester");
  assertIncludes(formalLiteTaskNames.join(","), "reviewer", "formal lite keeps reviewer");
  assertIncludes(formalLiteTaskNames.join(","), "release", "formal lite keeps release");

  const liteV2DryRunOutput = runCli(appDir, [
    "run",
    "--dry-run",
    "--profile=lite-v2",
    "Use CrewUp lite-v2 to make a tiny frontend copy change and validate it."
  ]);
  assertIncludes(liteV2DryRunOutput, "workflow_profile: lite-v2", "lite-v2 is explicit opt-in");
  assertIncludes(liteV2DryRunOutput, "needs_requirements_plan: false", "lite-v2 skips requirements planning");

  const liteV2RunOutput = runCli(appDir, [
    "run",
    "--profile=lite-v2",
    "Use CrewUp lite-v2 to make a tiny frontend copy change and validate it."
  ]);
  const liteV2RunId = extractRunId(liteV2RunOutput);
  if (!liteV2RunId) throw new Error(`Failed to detect lite-v2 runId from output: ${liteV2RunOutput}`);
  const liteV2RunDir = path.join(appDir, ".harness", "runs", liteV2RunId);
  assertExists(path.join(liteV2RunDir, "spec.md"), "lite-v2 spec");
  assertExists(path.join(liteV2RunDir, "tasks.md"), "lite-v2 tasks");
  assertExists(path.join(liteV2RunDir, "validation.md"), "lite-v2 validation");
  assertExists(path.join(liteV2RunDir, "summary.md"), "lite-v2 summary");
  const liteV2TaskNames = await listTaskNames(path.join(liteV2RunDir, "tasks"));
  assertSameArray(liteV2TaskNames, [], "lite-v2 does not create native agent tasks");
  assertNotExists(path.join(liteV2RunDir, "logs", "native-subagents", "native-subagent-plan.json"), "lite-v2 skips native plan");
  const liteV2PendingFinish = runCliWithStatus(appDir, ["finish", liteV2RunId], { expectedStatus: 1 });
  assertIncludes(liteV2PendingFinish, "update validation.md, summary.md", "lite-v2 finish blocks pending evidence");
  await writeFile(path.join(liteV2RunDir, "validation.md"), "# Lite Validation\n\n## Result\n\n- status: passed\n\n## Commands\n\n| Command | Result | Notes |\n| --- | --- | --- |\n| npm test | passed | simulated in flow test |\n\n## Acceptance Criteria Check\n\n- [x] AC-01: passed\n- [x] AC-02: passed\n- [x] AC-03: passed\n\n## Risks Or Skips\n\n- none\n\n## Metadata\n\n- profile: lite-v2\n", "utf8");
  await writeFile(path.join(liteV2RunDir, "summary.md"), "# Lite Summary\n\n## Outcome\n\n- Completed simulated lite-v2 run.\n\n## Changed Files\n\n- none\n\n## Validation\n\n- npm test passed in simulated record.\n\n## Residual Risks\n\n- none\n\n## Metadata\n\n- profile: lite-v2\n", "utf8");
  const liteV2FinishOutput = runCli(appDir, ["finish", liteV2RunId]);
  assertIncludes(liteV2FinishOutput, "Run archived", "lite-v2 finish archives success");
  const liteV2FinishedState = JSON.parse(await readFile(path.join(liteV2RunDir, "state.json"), "utf8"));
  if (liteV2FinishedState.status !== "done" || liteV2FinishedState.outcome !== "success" || liteV2FinishedState.archived !== true) {
    throw new Error(`Expected lite-v2 run to archive as success:\n${JSON.stringify(liteV2FinishedState, null, 2)}`);
  }
  const runtimeContinuationOutput = runCli(appDir, [
    "continue",
    liteV2RunId,
    "修复 Next.js runtime console error，页面启动时报错"
  ]);
  assertIncludes(runtimeContinuationOutput, "profile: lite-v2", "small runtime continuation defaults to lite-v2");
  const runtimeContinuationRunId = extractRunId(runtimeContinuationOutput);
  if (!runtimeContinuationRunId) throw new Error(`Failed to detect runtime continuation runId from output: ${runtimeContinuationOutput}`);
  const runtimeContinuationRunDir = path.join(appDir, ".harness", "runs", runtimeContinuationRunId);
  const runtimeContinuationState = JSON.parse(await readFile(path.join(runtimeContinuationRunDir, "state.json"), "utf8"));
  if (
    runtimeContinuationState.source !== "continue_run"
    || runtimeContinuationState.sourceRunId !== liteV2RunId
    || runtimeContinuationState.workflowProfile !== "lite-v2"
    || runtimeContinuationState.runtimeVerificationRequired !== true
  ) {
    throw new Error(`Runtime continuation state mismatch:\n${JSON.stringify(runtimeContinuationState, null, 2)}`);
  }
  await writeFile(path.join(runtimeContinuationRunDir, "validation.md"), "# Lite Validation\n\n## Result\n\n- status: passed\n\n## Commands\n\n| Command | Result | Notes |\n| --- | --- | --- |\n| npm run build | passed | simulated in flow test |\n\n## Acceptance Criteria Check\n\n- [x] AC-01: passed\n- [x] AC-02: passed\n- [x] AC-03: passed\n\n## Risks Or Skips\n\n- none\n\n## Metadata\n\n- profile: lite-v2\n", "utf8");
  await writeFile(path.join(runtimeContinuationRunDir, "summary.md"), "# Lite Summary\n\n## Outcome\n\n- Completed simulated runtime continuation.\n\n## Changed Files\n\n- components/theme-script.tsx\n\n## Validation\n\n- npm run build passed in simulated record.\n\n## Residual Risks\n\n- none\n\n## Metadata\n\n- profile: lite-v2\n", "utf8");
  const runtimeMissingSmokeFinish = runCliWithStatus(appDir, ["finish", runtimeContinuationRunId], { expectedStatus: 1 });
  assertIncludes(runtimeMissingSmokeFinish, "browser runtime verification is incomplete", "runtime continuation finish requires browser smoke");
  await writeFile(path.join(runtimeContinuationRunDir, "logs", "preview-smoke.json"), `${JSON.stringify({
    runId: runtimeContinuationRunId,
    status: "passed",
    mode: "browser",
    urls: [{ url: "http://127.0.0.1:3000", ok: true, status: 200, consoleErrors: [], pageErrors: [] }]
  }, null, 2)}\n`, "utf8");
  const runtimeContinuationFinishOutput = runCli(appDir, ["finish", runtimeContinuationRunId]);
  assertIncludes(runtimeContinuationFinishOutput, "Run archived", "runtime continuation archives after browser smoke");

  const naturalCounterRunOutput = runCli(appDir, [
    "run",
    "--mode=strict",
    "使用 CrewUp 做一个最小 counter web app，跑完整 workflow。页面显示一个计数器，默认是 0，可以加一、减一、重置，刷新后数字还在。"
  ]);
  const naturalCounterRunId = extractRunId(naturalCounterRunOutput);
  if (!naturalCounterRunId) throw new Error(`Failed to detect natural counter runId from output: ${naturalCounterRunOutput}`);
  const naturalCounterRunDir = path.join(appDir, ".harness", "runs", naturalCounterRunId);
  const naturalCounterTaskNames = sortByExecutionOrder(await listTaskNames(path.join(naturalCounterRunDir, "tasks")));
  assertNotIncludes(naturalCounterTaskNames.join(","), "pm", "natural counter excludes pm from default chain");
  assertSameArray(
    naturalCounterTaskNames.filter((agent) => ["requirements-plan", "requirements", "architect"].includes(agent)),
    ["requirements-plan", "requirements", "architect"],
    "natural counter starts with sequential requirements chain"
  );
  const naturalCounterNextAgent = JSON.parse(runCli(appDir, ["next-agent", naturalCounterRunId, "--json"]));
  assertSameArray(naturalCounterNextAgent.runnable.map((item) => item.agent), ["requirements-plan"], "natural counter initial runnable only requirements-plan");
  const naturalCounterState = JSON.parse(await readFile(path.join(naturalCounterRunDir, "state.json"), "utf8"));
  if (naturalCounterState.primaryLanguage !== "zh-CN") throw new Error(`Expected zh-CN primaryLanguage, got ${naturalCounterState.primaryLanguage}`);
  assertExists(path.join(naturalCounterRunDir, "GOAL.md"), "natural counter goal contract");
  assertExists(path.join(naturalCounterRunDir, "completion-contract.json"), "natural counter completion contract");
  const naturalCounterContract = JSON.parse(await readFile(path.join(naturalCounterRunDir, "completion-contract.json"), "utf8"));
  if (!naturalCounterContract.successCriteria?.length) throw new Error("Expected completion contract success criteria");
  if (!naturalCounterState.git?.createdByHarness) throw new Error(`Expected run branch to be created even with install/init dirty state:\n${JSON.stringify(naturalCounterState.git, null, 2)}`);
  assertIncludes(naturalCounterState.git.branch, "crewup/", "run branch name");
  if (!naturalCounterState.git.dirtyAtStart?.length) throw new Error("Expected dirtyAtStart to record existing install/init files");
  const naturalCounterStatus = runCli(appDir, ["status", naturalCounterRunId]);
  assertIncludes(naturalCounterStatus, "# Run 状态", "natural counter localized run status");

  const planOnlyRunOutput = runCli(appDir, [
    "run",
    "--mode=plan",
    "\u7528 CrewUp \u89c4\u5212\u4e00\u4e2a\u5168\u6808\u535a\u5ba2\u7cfb\u7edf\u3002\u5f53\u524d\u9636\u6bb5\u53ea\u505a\u9700\u6c42\u6f84\u6e05\u3001\u6280\u672f\u9009\u578b\u5efa\u8bae\u3001\u76ee\u5f55\u7ed3\u6784\u8bbe\u8ba1\u3001\u6a21\u5757\u8fb9\u754c\u3001\u5f00\u53d1\u9636\u6bb5\u62c6\u5206\u548c\u9a8c\u6536\u6807\u51c6\uff0c\u4e0d\u5199\u4e1a\u52a1\u4ee3\u7801\u3002\u7cfb\u7edf\u5305\u542b C \u7aef\u535a\u5ba2\u524d\u53f0\u3001Admin \u540e\u53f0\u3001\u540e\u7aef API\u3001\u6570\u636e\u5e93\u3002"
  ]);
  assertIncludes(planOnlyRunOutput, "profile: plan_only", "plan-only formal run profile");
  const planOnlyRunId = extractRunId(planOnlyRunOutput);
  if (!planOnlyRunId) throw new Error(`Failed to detect plan-only runId from output: ${planOnlyRunOutput}`);
  assertIncludes(planOnlyRunId, "plan-fullstack-blog-system", "semantic plan-only run id");

  const planOnlyRunDir = path.join(appDir, ".harness", "runs", planOnlyRunId);
  const planOnlyTaskNames = sortByExecutionOrder(await listTaskNames(path.join(planOnlyRunDir, "tasks")));
  assertSameMembers(planOnlyTaskNames, ["architect", "requirements", "requirements-plan", "reviewer"], "plan-only task assignment");
  assertNotExists(path.join(planOnlyRunDir, "artifacts", "requirement-plan.md"), "main-authored requirement-plan artifact");
  for (const file of ["planning.md", "acceptance.md", "architecture-plan.md", "implementation-plan.md", "review.md", "validation.md", "summary.md"]) {
    assertExists(path.join(planOnlyRunDir, file), `plan root artifact ${file}`);
  }
  const planPendingFinish = runCliWithStatus(appDir, ["finish", planOnlyRunId], { expectedStatus: 1 });
  assertIncludes(planPendingFinish, "Cannot finish plan run", "plan finish blocks pending root evidence");
  const planContinueOutput = runCli(appDir, ["continue", planOnlyRunId, "开始实现"]);
  assertIncludes(planContinueOutput, "Continuing", "plan continuation auto starts");
  assertIncludes(planContinueOutput, "profile: standard", "plan continuation defaults to strict/standard for full plan implementation");

  const requirementPlanTask = await readFile(path.join(planOnlyRunDir, "tasks", "requirements-plan.task.md"), "utf8");
  assertIncludes(requirementPlanTask, "Original Request Summary", "requirements-plan English heading");
  assertIncludes(requirementPlanTask, "Clarification Card", "requirements-plan clarification card heading");
  assertIncludes(requirementPlanTask, "ACTION REQUIRED", "requirements-plan task requires obvious user action prompt");
  assertIncludes(requirementPlanTask, "Impact Scope Candidates", "requirements-plan impact heading");
  assertIncludes(requirementPlanTask, "Human-facing summaries, handoff notes, blockers, and coordination comments should match the user's primary language", "human-facing language-following rule");
  assertIncludes(requirementPlanTask, "question text, option labels, option descriptions", "requirements-plan clarification wording rule");
  assertNotIncludes(requirementPlanTask, "## Artifact Scaffold", "artifact scaffold section removed");
  assertNotIncludes(requirementPlanTask, "Copy this skeleton structure", "markdown scaffold copy instruction removed");
  assertIncludes(requirementPlanTask, "## Structured Artifact Payload", "structured artifact payload section");
  assertIncludes(requirementPlanTask, "### JSON Schema", "structured artifact payload JSON schema");
  assertIncludes(requirementPlanTask, "artifactPayloads", "structured artifact payload contract");
  assertIncludes(requirementPlanTask, "Harness renders Markdown", "harness-controlled artifact rendering rule");
  assertIncludes(requirementPlanTask, "Clarification Questions", "requirements-plan clarification heading");
  assertIncludes(requirementPlanTask, "clarificationQuestions", "requirements-plan structured clarification JSON");
  assertIncludes(requirementPlanTask, "return `needs_input`", "requirements-plan needs-input contract");
  assertIncludes(requirementPlanTask, "artifactUpdates", "task result contract requires artifactUpdates");
  assertIncludes(requirementPlanTask, "do not use `artifacts`", "task result contract rejects artifacts alias");

  const testerTaskCandidates = await createStrictFrontendRun(appDir);
  assertIncludes(testerTaskCandidates.frontendTask, "src/**", "frontend task includes src scope");
  assertIncludes(testerTaskCandidates.frontendTask, "package.json", "frontend task includes package scope");
  assertIncludes(testerTaskCandidates.testerTask, "non-blank page", "tester baseline includes non-blank check");
  assertIncludes(testerTaskCandidates.testerTask, "empty input rejection", "tester baseline includes empty input check");
  assertIncludes(testerTaskCandidates.reviewerTask, "- [x] pass", "reviewer pass format is explicit");

  const counterRunOutput = runCli(appDir, [
    "run",
    "--mode=strict",
    "\u4f7f\u7528 CrewUp \u505a\u4e00\u4e2a\u6700\u5c0f counter web app\uff0c\u8dd1\u5b8c\u6574 workflow\u3002\u9a8c\u6536\u6807\u51c6\uff1a\u9875\u9762\u663e\u793a counter\uff0c\u521d\u59cb\u503c\u4e3a 0\uff1b\u53ef\u4ee5 +1\u3001-1\u3001reset\uff1b\u5237\u65b0\u540e\u6570\u503c\u4fdd\u7559\u3002\u8303\u56f4\uff1a\u53ea\u505a\u4e00\u4e2a\u5f88\u5c0f\u7684\u524d\u7aef\u5b9e\u73b0\uff1b\u4e0d\u9700\u8981 backend\u3001database\u3001auth\u3001routing\u3002\u5b8c\u6210\u540e\u8bf7\u6839\u636e\u9879\u76ee\u914d\u7f6e\u81ea\u884c\u53d1\u73b0\u5e76\u6267\u884c\u5fc5\u8981\u9a8c\u8bc1\u3002"
  ]);
  const counterRunId = extractRunId(counterRunOutput);
  if (!counterRunId) throw new Error(`Failed to detect counter runId from output: ${counterRunOutput}`);
  const counterRunDir = path.join(appDir, ".harness", "runs", counterRunId);
  assertIncludes(counterRunId, "build-counter-web-app", "semantic counter run id ignores negated auth");
  const counterTaskNames = sortByExecutionOrder(await listTaskNames(path.join(appDir, ".harness", "runs", counterRunId, "tasks")));
  assertSameMembers(counterTaskNames, ["requirements-plan", "requirements", "architect", "frontend", "tester", "reviewer", "release"], "counter task assignment excludes negated scopes");
  assertNotIncludes(counterTaskNames.join(","), "pm", "counter excludes pm from default strict chain");
  assertNotIncludes(counterTaskNames.join(","), "backend", "counter excludes backend");
  assertNotIncludes(counterTaskNames.join(","), "database", "counter excludes database");
  const counterNextAgent = JSON.parse(runCli(appDir, ["next-agent", counterRunId, "--json"]));
  assertSameArray(counterNextAgent.runnable.map((item) => item.agent), ["requirements-plan"], "counter starts with requirements-plan");
  assertSameMembers(counterNextAgent.skipped.map((item) => item.agent), ["frontend"], "counter implementation waits for architecture assignment");
  const protectedHarnessFile = path.join(appDir, ".harness", "scripts", "project-run-overreach.tmp");
  await writeFile(protectedHarnessFile, "project run must not edit harness core\n", "utf8");
  const protectedChangedFilesAdd = runCliWithStatus(appDir, ["changed-files", counterRunId, "add", ".harness/scripts/project-run-overreach.tmp"], { expectedStatus: 1 });
  assertIncludes(protectedChangedFilesAdd, "Harness core files cannot be recorded", "changed-files blocks harness core edits");
  const protectedGate = runCliWithStatus(appDir, ["gate-check", counterRunId], { expectedStatus: 1 });
  assertIncludes(protectedGate, "Harness core files changed during a project run", "gate-check blocks harness core edits");
  await rm(protectedHarnessFile, { force: true });
  const counterStatusOutput = runCli(appDir, ["status", counterRunId]);
  assertIncludes(counterStatusOutput, "# Run 状态", "single run localized status card");
  assertIncludes(counterStatusOutput, "## 一眼看懂", "status card localized at a glance");
  assertIncludes(counterStatusOutput, "**迭代结论:**", "status card localized iteration verdict");
  assertIncludes(counterStatusOutput, "**完成契约:**", "status card localized completion contract");
  assertIncludes(counterStatusOutput, "## 当前决策", "status card localized current decision");
  assertIncludes(counterStatusOutput, "**当前 Owner:** requirements-plan", "status card current owner");
  assertIncludes(counterStatusOutput, "**命令:** `npx crewup next-agent", "status card next command");
  assertIncludes(counterStatusOutput, `| Run | ${counterRunId} |`, "single run status id");
  assertExists(path.join(appDir, ".harness", "runs", counterRunId, "RUN_STATUS.md"), "run status markdown");
  const counterExplainOutput = runCli(appDir, ["explain", counterRunId]);
  assertIncludes(counterExplainOutput, "# CrewUp Run Health", "explain heading");
  assertIncludes(counterExplainOutput, "## What This Means", "explain meaning section");
  assertIncludes(counterExplainOutput, "## Next Steps", "explain next steps section");
  assertIncludes(counterExplainOutput, `npx crewup next-agent ${counterRunId}`, "explain includes next command for active run");
  const runsListOutput = runCli(appDir, ["runs"]);
  assertIncludes(runsListOutput, "# CrewUp Runs", "runs list heading");
  assertIncludes(runsListOutput, counterRunId, "runs list includes counter run");
  const blockedOpenOutput = runCli(appDir, ["archive", counterRunId, "--outcome=blocked", "--reason=test blocker stays in current run"]);
  assertIncludes(blockedOpenOutput, "kept open", "blocked archive keeps run open by default");
  const blockedOpenState = JSON.parse(await readFile(path.join(counterRunDir, "state.json"), "utf8"));
  if (blockedOpenState.archived !== false || blockedOpenState.status !== "blocked") {
    throw new Error(`Blocked run should stay open:\n${JSON.stringify(blockedOpenState, null, 2)}`);
  }
  assertIncludes(blockedOpenState.nextAction?.command ?? "", `next-agent ${counterRunId}`, "blocked open run points back to next-agent");
  runCli(appDir, ["archive", counterRunId, "--outcome=blocked", "--reason=test explicit close", "--close"]);
  const reopenOutput = runCli(appDir, ["repair-state", counterRunId, "--reopen-blocked", "--apply"]);
  assertIncludes(reopenOutput, '"reopenBlocked": true', "repair-state supports reopening incorrectly archived blocked runs");
  const reopenedState = JSON.parse(await readFile(path.join(counterRunDir, "state.json"), "utf8"));
  if (reopenedState.archived !== false || reopenedState.status !== "blocked") {
    throw new Error(`Blocked run should reopen after repair-state:\n${JSON.stringify(reopenedState, null, 2)}`);
  }
  const cancelOutput = runCli(appDir, ["cancel", counterRunId, "--reason=test lifecycle cancellation"]);
  assertIncludes(cancelOutput, "Run archived", "cancel archives run");
  assertIncludes(cancelOutput, "- outcome: canceled", "cancel outcome");
  assertExists(path.join(appDir, ".harness", "runs", counterRunId, "RUN_SUMMARY.md"), "canceled run summary");
  assertExists(path.join(appDir, ".harness", "runs", counterRunId, "logs", "archive", "archive-summary.md"), "canceled archive summary");
  assertExists(path.join(appDir, ".harness", "reports", `${counterRunId}.md`), "global canceled run report");
  const canceledStatusOutput = runCli(appDir, ["status", counterRunId]);
  assertIncludes(canceledStatusOutput, "| Status | canceled |", "canceled status card");
  const canceledNextAgent = JSON.parse(runCli(appDir, ["next-agent", counterRunId, "--json"]));
  if (canceledNextAgent.next !== null || canceledNextAgent.runnable.length !== 0 || !["closed", "done"].includes(canceledNextAgent.action)) {
    throw new Error(`Closed run must not expose runnable agents:\n${JSON.stringify(canceledNextAgent, null, 2)}`);
  }
  const canceledExplainOutput = runCli(appDir, ["explain", counterRunId]);
  assertIncludes(canceledExplainOutput, "Verdict: `", "explain renders closed verdict");
  assertIncludes(canceledExplainOutput, "Do not start more agents", "explain prevents closed run continuation");
  const canceledReport = await readFile(path.join(appDir, ".harness", "runs", counterRunId, "logs", "run-report.md"), "utf8");
  assertIncludes(canceledReport, "| deliveryStatus | closed |", "archived run report is closed even without archive commit");

  const smokePort = await startSmokeServer();
  try {
    const smokeOutput = runCli(appDir, ["preview-smoke", counterRunId, "--url", `http://127.0.0.1:${smokePort}`]);
    assertIncludes(smokeOutput, "Preview smoke passed", "preview smoke passed output");
    assertExists(path.join(counterRunDir, "artifacts", "preview-smoke.md"), "preview smoke artifact");
    assertExists(path.join(counterRunDir, "logs", "preview-smoke.json"), "preview smoke json");
  } finally {
    await stopSmokeServer();
  }

  const runtimeState = JSON.parse(await readFile(path.join(counterRunDir, "state.json"), "utf8"));
  await writeFile(path.join(counterRunDir, "state.json"), `${JSON.stringify({
    ...runtimeState,
    stage: "done",
    workflowProfile: "standard"
  }, null, 2)}\n`, "utf8");
  const fetchOnlyRuntimeGate = runCliWithStatus(appDir, ["gate-check", counterRunId], { expectedStatus: 1 });
  assertIncludes(fetchOnlyRuntimeGate, "browser-mode preview smoke", "strict frontend done gate rejects fetch-only smoke");
  await writeFile(path.join(counterRunDir, "logs", "preview-smoke.json"), `${JSON.stringify({
    runId: counterRunId,
    status: "passed",
    mode: "browser",
    urls: [{ url: "http://127.0.0.1:3000", ok: true, status: 200, consoleErrors: [], pageErrors: [] }]
  }, null, 2)}\n`, "utf8");
  await writeFile(path.join(counterRunDir, "state.json"), `${JSON.stringify(runtimeState, null, 2)}\n`, "utf8");

  const forceWithoutReason = runCliWithStatus(appDir, ["transition", counterRunId, "--to=done", "--force"], { expectedStatus: 1 });
  assertIncludes(forceWithoutReason, "transition --force requires --force-reason", "force transition reason guard");
  const autoContinueOutput = runCli(appDir, ["continue", counterRunId, "Continue the counter MVP after cancellation with the same tiny scope."]);
  assertIncludes(autoContinueOutput, "continuation mode: strict", "continue without mode auto-selects conservative strict for MVP continuation");
  assertIncludes(autoContinueOutput, "- profile: standard", "auto MVP continuation uses standard profile");
  const continueOutput = runCli(appDir, ["continue", counterRunId, "--mode=lite", "Continue the counter MVP after cancellation with the same tiny scope."]);
  const continuationRunId = extractRunId(continueOutput);
  if (!continuationRunId) throw new Error(`Failed to detect continuation runId from output: ${continueOutput}`);
  assertIncludes(continueOutput, "- profile: lite", "explicit --mode=lite continuation uses formal lite");
  const continuationInput = await readFile(path.join(appDir, ".harness", "runs", continuationRunId, "input.md"), "utf8");
  assertIncludes(continuationInput, `# Continuation Request From ${counterRunId}`, "continuation input links source run");
  const continuationState = JSON.parse(await readFile(path.join(appDir, ".harness", "runs", continuationRunId, "state.json"), "utf8"));
  if (continuationState.source !== "continue_run" || continuationState.sourceRunId !== counterRunId) {
    throw new Error(`Continuation state mismatch:\n${JSON.stringify(continuationState, null, 2)}`);
  }
  await writeFile(path.join(counterRunDir, "artifacts", "test-report.md"), "# Test Report\n", "utf8");
  const removedArtifactRepair = runCliWithStatus(appDir, ["repair-artifacts", counterRunId], { expectedStatus: 1 });
  assertIncludes(removedArtifactRepair, "Unknown command: repair-artifacts", "repair-artifacts command removed");

  const architectureDispatchOutput = runCli(appDir, [
    "run",
    "--mode=strict",
    "Use CrewUp to implement a tiny catalog app with frontend, backend API, and database candidates. Let the architecture plan decide the actual implementation agents."
  ]);
  const architectureDispatchRunId = extractRunId(architectureDispatchOutput);
  if (!architectureDispatchRunId) throw new Error(`Failed to detect architecture-dispatch runId from output: ${architectureDispatchOutput}`);
  const architectureDispatchRunDir = path.join(appDir, ".harness", "runs", architectureDispatchRunId);
  const architectureDispatchTaskNames = sortByExecutionOrder(await listTaskNames(path.join(architectureDispatchRunDir, "tasks")));
  assertIncludes(architectureDispatchTaskNames.join(","), "frontend", "architecture-dispatch has frontend candidate");
  assertIncludes(architectureDispatchTaskNames.join(","), "backend", "architecture-dispatch has backend candidate");
  assertIncludes(architectureDispatchTaskNames.join(","), "database", "architecture-dispatch has database candidate");
  await writeFile(path.join(architectureDispatchRunDir, "artifacts", "implementation-plan.md"), renderFrontendOnlyImplementationPlan(), "utf8");
  await markNativeAgentsCompleted(architectureDispatchRunDir, ["pm", "requirements-plan", "requirements", "architect"]);
  const architectureNextAgent = JSON.parse(runCli(appDir, ["next-agent", architectureDispatchRunId, "--json"]));
  assertSameArray(architectureNextAgent.runnable.map((item) => item.agent), ["frontend"], "implementation dispatch follows architecture plan assignment");
  assertSameMembers(architectureNextAgent.skipped.map((item) => item.agent), ["backend", "database", "devops"], "unassigned implementation candidates are skipped");
  const driveSpawnOutput = runCli(appDir, ["drive", architectureDispatchRunId]);
  assertIncludes(driveSpawnOutput, "- action: spawn", "drive reports spawn action");
  assertIncludes(driveSpawnOutput, "- do: Start only frontend.", "drive gives human-safe spawn instruction");
  const unassignedBackendSpawn = runCliWithStatus(appDir, ["native-state", architectureDispatchRunId, "mark-spawned", "backend", "backend-handle"], { expectedStatus: 1 });
  assertIncludes(unassignedBackendSpawn, "implementation-plan.md is missing or does not assign backend", "unassigned backend spawn is blocked");
  const prunePreview = JSON.parse(runCli(appDir, ["repair-state", architectureDispatchRunId, "--prune-unassigned-implementation"]));
  assertIncludes(JSON.stringify(prunePreview), "pruned unassigned implementation candidates", "repair-state previews unassigned candidate prune");
  runCli(appDir, ["repair-state", architectureDispatchRunId, "--prune-unassigned-implementation", "--apply"]);
  assertNotExists(path.join(architectureDispatchRunDir, "tasks", "backend.task.md"), "repair-state prunes unassigned backend task");
  assertNotExists(path.join(architectureDispatchRunDir, "tasks", "database.task.md"), "repair-state prunes unassigned database task");
  assertNotExists(path.join(architectureDispatchRunDir, "tasks", "devops.task.md"), "repair-state prunes unassigned devops task");
  runCli(appDir, ["native-state", architectureDispatchRunId, "mark-spawned", "frontend", "frontend-handle"]);
  const architectureNativeDir = path.join(architectureDispatchRunDir, "logs", "native-subagents");
  await writeFile(path.join(architectureNativeDir, "frontend.result.md"), "# Frontend Result\n\n## Status\n\ncompleted\n", "utf8");
  await writeFile(path.join(architectureNativeDir, "frontend.result.json"), `${JSON.stringify({ agent: "frontend", status: "completed", summary: "frontend done" }, null, 2)}\n`, "utf8");
  const reconcileAgentFieldOutput = runCli(appDir, ["native-state", architectureDispatchRunId, "reconcile-results"]);
  assertIncludes(reconcileAgentFieldOutput, "frontend", "reconcile-results accepts matching JSON agent field");
  runCli(appDir, ["report", architectureDispatchRunId]);
  const reconciledReport = await readFile(path.join(architectureDispatchRunDir, "logs", "run-report.md"), "utf8");
  assertIncludes(reconciledReport, "`frontend`", "report includes frontend row");
  assertIncludes(reconciledReport, "result=completed", "report reconciles uncaptured native result");
  const testerRunnable = JSON.parse(runCli(appDir, ["next-agent", architectureDispatchRunId, "--json"]));
  assertSameArray(testerRunnable.runnable.map((item) => item.agent), ["tester"], "tester becomes runnable after implementation result is captured");
  runCli(appDir, ["native-state", architectureDispatchRunId, "mark-spawned", "tester", "tester-handle"]);
  const waitForTester = JSON.parse(runCli(appDir, ["next-agent", architectureDispatchRunId, "--json"]));
  if (waitForTester.action !== "wait" || waitForTester.userInputRequired !== false) {
    throw new Error(`Active tester should produce wait/no-user-input next-agent result:\n${JSON.stringify(waitForTester, null, 2)}`);
  }
  assertSameArray(waitForTester.waitFor, ["tester"], "next-agent waits for active tester result");
  assertIncludes(waitForTester.instruction, "Do not ask the user to choose", "wait instruction prevents user branch selection");
  const driveWaitOutput = runCli(appDir, ["drive", architectureDispatchRunId]);
  assertIncludes(driveWaitOutput, "- action: wait", "drive reports wait action");
  assertIncludes(driveWaitOutput, "Do not restart", "drive wait output prevents restart");
  const staleTesterState = JSON.parse(await readFile(path.join(architectureNativeDir, "native-state.json"), "utf8"));
  staleTesterState.runtime = {
    ...(staleTesterState.runtime ?? {}),
    slow_result_capture_minutes: 10
  };
  const staleTester = staleTesterState.agents.find((agent) => agent.agent === "tester");
  staleTester.spawned_at = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  await writeFile(path.join(architectureNativeDir, "native-state.json"), `${JSON.stringify(staleTesterState, null, 2)}\n`, "utf8");
  await writeFile(path.join(architectureNativeDir, "tester.progress.md"), "# Progress\n\n- still running smoke checks\n", "utf8");
  const activeWithProgress = JSON.parse(runCli(appDir, ["next-agent", architectureDispatchRunId, "--json"]));
  if (activeWithProgress.action !== "wait") {
    throw new Error(`Recent progress checkpoint should keep active tester in wait state:\n${JSON.stringify(activeWithProgress, null, 2)}`);
  }
  await rm(path.join(architectureNativeDir, "tester.progress.md"));
  const staleTesterNext = JSON.parse(runCli(appDir, ["next-agent", architectureDispatchRunId, "--json"]));
  if (staleTesterNext.action !== "stale" || staleTesterNext.waitFor.length !== 0) {
    throw new Error(`Stale tester should produce stale/no-wait next-agent result:\n${JSON.stringify(staleTesterNext, null, 2)}`);
  }
  assertSameArray(staleTesterNext.stale.map((item) => item.agent), ["tester"], "next-agent reports stale active tester");
  assertIncludes(staleTesterNext.instruction, "result-only closeout", "stale instruction asks for closeout before blocking");
  const driveStaleOutput = runCli(appDir, ["drive", architectureDispatchRunId]);
  assertIncludes(driveStaleOutput, "- action: stale", "drive reports stale action");
  assertIncludes(driveStaleOutput, "result-only closeout", "drive stale output asks for closeout");
  await writeFile(path.join(architectureNativeDir, "tester.result.md"), "# Tester Result\n\nStatus: completed\n\nFix required.\n", "utf8");
  await writeFile(path.join(architectureNativeDir, "tester.result.json"), `${JSON.stringify({
    status: "completed",
    fixRequired: true,
    targetAgents: ["frontend"],
    requiredFixes: [
      {
        id: "RF-TEST-01",
        targetAgents: ["frontend"],
        severity: "high",
        summary: "Fix failing frontend build before review.",
        requiredChange: "Restore missing frontend files and rerun tester."
      }
    ],
    blockingIssues: ["Frontend build failed."]
  }, null, 2)}\n`, "utf8");
  runCli(appDir, ["native-state", architectureDispatchRunId, "mark-result", "tester", "completed"]);
  const repairAfterTester = JSON.parse(runCli(appDir, ["next-agent", architectureDispatchRunId, "--json"]));
  if (repairAfterTester.action !== "repair" || repairAfterTester.next !== null) {
    throw new Error(`Tester fixRequired should route to repair, not reviewer:\n${JSON.stringify(repairAfterTester, null, 2)}`);
  }
  assertSameArray(repairAfterTester.repair.targetAgents, ["frontend"], "tester required fixes target frontend repair");
  runCli(appDir, ["repair-plan", architectureDispatchRunId]);
  runCli(appDir, ["native-state", architectureDispatchRunId, "mark-resumed", "tester"]);
  const nativeAfterTesterResume = JSON.parse(await readFile(path.join(architectureNativeDir, "native-state.json"), "utf8"));
  const resumedTester = nativeAfterTesterResume.agents.find((agent) => agent.agent === "tester");
  if (resumedTester.result_status !== null || resumedTester.result_captured_at !== null || resumedTester.fixRequired !== false) {
    throw new Error(`mark-resumed should clear stale tester result metadata:\n${JSON.stringify(resumedTester, null, 2)}`);
  }
  const repairFromPlanAfterTesterResume = JSON.parse(runCli(appDir, ["next-agent", architectureDispatchRunId, "--json"]));
  if (repairFromPlanAfterTesterResume.action !== "repair" || !repairFromPlanAfterTesterResume.repair.sources.includes("repair-plan")) {
    throw new Error(`Unresolved repair-plan should keep routing to owner repair even if tester metadata was cleared:\n${JSON.stringify(repairFromPlanAfterTesterResume, null, 2)}`);
  }
  assertSameArray(repairFromPlanAfterTesterResume.repair.targetAgents, ["frontend"], "repair-plan preserves frontend repair target");
  const frontendBeforeRecapture = JSON.parse(await readFile(path.join(architectureNativeDir, "native-state.json"), "utf8")).agents.find((agent) => agent.agent === "frontend");
  await sleep(1100);
  await writeFile(path.join(architectureNativeDir, "frontend.result.md"), "# Frontend Result\n\n## Status\n\ncompleted\n\nRepair result refreshed.\n", "utf8");
  await writeFile(path.join(architectureNativeDir, "frontend.result.json"), `${JSON.stringify({ agent: "frontend", status: "completed", summary: "frontend repair result refreshed" }, null, 2)}\n`, "utf8");
  runCli(appDir, ["native-state", architectureDispatchRunId, "mark-result", "frontend", "completed"]);
  const frontendAfterRecapture = JSON.parse(await readFile(path.join(architectureNativeDir, "native-state.json"), "utf8")).agents.find((agent) => agent.agent === "frontend");
  if (Date.parse(frontendAfterRecapture.result_captured_at) <= Date.parse(frontendBeforeRecapture.result_captured_at)) {
    throw new Error(`mark-result should refresh captured_at when the same result file is rewritten:\n${JSON.stringify({ before: frontendBeforeRecapture, after: frontendAfterRecapture }, null, 2)}`);
  }

  const planOnlyPlan = JSON.parse(await readFile(path.join(planOnlyRunDir, "logs", "native-subagents", "native-subagent-plan.json"), "utf8"));
  assertSameArray(
    planOnlyPlan.tasks.map((task) => task.agent),
    ["requirements-plan", "requirements", "architect", "reviewer"],
    "plan-only native execution order"
  );
  const requirementsPlanNativeTask = planOnlyPlan.tasks.find((task) => task.agent === "requirements-plan");
  if (!requirementsPlanNativeTask) throw new Error("Missing requirements-plan native task");
  assertIncludes(requirementsPlanNativeTask.allowed_patterns.join("\n"), `.harness/runs/${planOnlyRunId}/logs/native-subagents/requirements-plan.result.md`, "requirements-plan result md allowed pattern");
  assertIncludes(requirementsPlanNativeTask.allowed_patterns.join("\n"), `.harness/runs/${planOnlyRunId}/logs/native-subagents/requirements-plan.result.json`, "requirements-plan result json allowed pattern");
  assertIncludes(requirementsPlanNativeTask.allowed_patterns.join("\n"), `.harness/runs/${planOnlyRunId}/logs/native-subagents/requirements-plan.progress.md`, "requirements-plan progress checkpoint allowed pattern");
  assertIncludes(requirementsPlanNativeTask.progress_path, "requirements-plan.progress.md", "requirements-plan native task records progress path");

  const requirementsPlanSpawn = await readFile(path.join(planOnlyRunDir, "logs", "native-subagents", "requirements-plan.spawn.md"), "utf8");
  assertIncludes(requirementsPlanSpawn, "Result files are subagent-owned audit outputs", "subagent-owned result prompt");
  assertIncludes(requirementsPlanSpawn, "main agent may only register", "main-agent result registration boundary");
  assertIncludes(requirementsPlanSpawn, "do not use `artifacts` as a substitute", "native prompt rejects artifacts alias");
  assertIncludes(requirementsPlanSpawn, "repairOf", "native prompt repair lineage field");
  assertIncludes(requirementsPlanSpawn, "previousResultPath", "native prompt previous result field");
  assertIncludes(requirementsPlanSpawn, "Progress checkpoint", "native prompt requires progress checkpoint");
  assertIncludes(requirementsPlanSpawn, "requirements-plan.progress.md", "native prompt names progress checkpoint path");
  assertIncludes(requirementsPlanSpawn, "### Structured Artifact Payload Contract", "native prompt repeats structured payload contract");
  assertIncludes(requirementsPlanSpawn, "artifactPayloads", "native prompt JSON example includes artifactPayloads");
  assertNotIncludes(requirementsPlanSpawn, "full markdown content", "native prompt avoids full markdown artifact content");

  const toolFallbackOutput = runCli(appDir, [
    "tool-fallback",
    planOnlyRunId,
    "--tool",
    "Context7",
    "--reason",
    "not available in test",
    "--fallback",
    "use checked-in docs"
  ]);
  assertIncludes(toolFallbackOutput, "Tool fallback recorded", "tool-fallback output");
  const toolFallbackLog = JSON.parse(await readFile(path.join(planOnlyRunDir, "logs", "tool-fallbacks.json"), "utf8"));
  assertIncludes(JSON.stringify(toolFallbackLog), "Context7", "tool-fallback json entry");

  assertSameMembers(planOnlyPlan.groups.map((group) => group.id), [
    "requirements_planning",
    "requirements_confirmation",
    "architecture_planning",
    "verification_reviewer"
  ], "plan-only native plan groups");
  assertSameMembers(prereqsFor(planOnlyPlan, "requirements"), ["requirements-plan"], "requirements prerequisites");
  assertSameMembers(prereqsFor(planOnlyPlan, "architect"), ["requirements-plan", "requirements"], "architect prerequisites");
  assertAgentModel(planOnlyPlan, "requirements", { modelHint: "gpt-5.5", reasoningEffort: "medium" });
  assertAgentModel(planOnlyPlan, "architect", { modelHint: "gpt-5.5", reasoningEffort: "medium" });
  const nativeState = JSON.parse(await readFile(path.join(planOnlyRunDir, "logs", "native-subagents", "native-state.json"), "utf8"));
  assertSameMembers(
    nativeState.agents.find((agent) => agent.agent === "architect")?.requires_completed_agents ?? [],
    ["requirements-plan", "requirements"],
    "architect native-state prerequisites"
  );
  const nextAgent = JSON.parse(runCli(appDir, ["next-agent", planOnlyRunId, "--json"]));
  assertSameArray(nextAgent.runnable.map((item) => item.agent), ["requirements-plan"], "initial runnable native agents");
  assertSameMembers(nextAgent.blocked.map((item) => item.agent), ["requirements", "architect", "reviewer"], "initial blocked native agents");
  const transitionDoneGuard = runCliWithStatus(appDir, ["transition", planOnlyRunId, "--to=done"], { expectedStatus: 1 });
  assertIncludes(transitionDoneGuard, "Invalid transition", "done transition reports normal gate error instead of tasksDir crash");
  const cleanAudit = JSON.parse(runCli(appDir, ["audit", planOnlyRunId, "--json"]));
  if (cleanAudit.counts.errors !== 0) throw new Error(`Expected clean orchestration audit, got ${cleanAudit.counts.errors} errors:\n${JSON.stringify(cleanAudit.findings, null, 2)}`);
  const prematureArchitectSpawn = runCliWithStatus(appDir, ["native-state", planOnlyRunId, "mark-spawned", "architect", "premature-architect"], { expectedStatus: 1 });
  assertIncludes(prematureArchitectSpawn, "Cannot spawn architect", "architect spawn prerequisite guard");
  const dirtyHandleSpawn = runCliWithStatus(appDir, ["native-state", planOnlyRunId, "mark-spawned", "requirements-plan", "--handle=dirty"], { expectedStatus: 1 });
  assertIncludes(dirtyHandleSpawn, "Invalid native handle", "dirty handle guard");

  await seedRequirementsPlanResult(planOnlyRunDir, { status: "completed", userConfirmed: false });
  runCli(appDir, ["native-state", planOnlyRunId, "mark-spawned", "requirements-plan", "requirements-plan-handle"]);
  const unconfirmedRequirementsPlan = runCliWithStatus(appDir, ["native-state", planOnlyRunId, "mark-result", "requirements-plan", "completed"], { expectedStatus: 1 });
  assertIncludes(unconfirmedRequirementsPlan, "Cannot complete requirements-plan before user confirmation", "requirements-plan requires user confirmation");

  await writeFile(path.join(planOnlyRunDir, "artifacts", "requirement-plan.md"), "# Requirement Plan\n\n## Clarification Card\n\n- pending\n", "utf8");
  await seedRequirementsPlanResult(planOnlyRunDir, { status: "needs_input", userConfirmed: false, includePayload: false });
  const invalidArtifactCapture = runCliWithStatus(appDir, ["native-state", planOnlyRunId, "mark-result", "requirements-plan", "needs_input"], { expectedStatus: 1 });
  assertIncludes(invalidArtifactCapture, "structured artifact rendering failed", "native-state rejects missing structured artifact payload");
  assertIncludes(invalidArtifactCapture, "artifactPayloads", "native-state explains structured payload requirement");

  await writeFile(path.join(planOnlyRunDir, "artifacts", "requirement-plan.md"), renderValidRequirementPlanArtifact(), "utf8");
  await seedRequirementsPlanResult(planOnlyRunDir, { status: "needs_input", userConfirmed: false });
  const clarificationCapture = runCli(appDir, ["native-state", planOnlyRunId, "mark-result", "requirements-plan", "needs_input"]);
  assertIncludes(clarificationCapture, "requirements-plan: needs_input", "requirements-plan needs_input captured");
  const clarifyOutput = runCli(appDir, ["clarify", planOnlyRunId]);
  assertIncludes(clarifyOutput, "Q-01", "clarify renders question id");
  assertIncludes(clarifyOutput, "ACTION REQUIRED", "clarify renders obvious action-required banner");
  assertIncludes(clarifyOutput, "## 需要你回答的问题", "clarify renders compact choice card");
  assertIncludes(clarifyOutput, "可直接复制的回复格式", "clarify shows copyable answer format");
  assertIncludes(clarifyOutput, "C. Other", "clarify keeps an Other option");
  const clarifyAnswersOutput = runCli(appDir, ["clarify", planOnlyRunId, "--answers=Q-01:A"]);
  assertIncludes(clarifyAnswersOutput, "Clarification answers saved", "clarify saves answers");
  assertExists(path.join(planOnlyRunDir, "logs", "clarifications", "answers.json"), "clarification answers json");
  const requirementPlanTaskAfterAnswers = await readFile(path.join(planOnlyRunDir, "tasks", "requirements-plan.task.md"), "utf8");
  assertIncludes(requirementPlanTaskAfterAnswers, "logs/clarifications/answers.json", "requirements-plan answer input");

  await writeFile(path.join(planOnlyRunDir, "artifacts", "requirement-plan.md"), renderValidRequirementPlanArtifact(), "utf8");
  const ownerArtifactAudit = runCliWithStatus(appDir, ["audit", planOnlyRunId], { expectedStatus: 1 });
  assertIncludes(ownerArtifactAudit, "owner_artifact_before_owner_done", "owner artifact overreach audit");
  const ownerArtifactGate = runCliWithStatus(appDir, ["gate-check", planOnlyRunId], { expectedStatus: 1 });
  assertIncludes(ownerArtifactGate, "Owner artifact requirement-plan.md exists before owner agent requirements-plan completed", "owner artifact overreach gate");

  await writeFile(path.join(planOnlyRunDir, "logs", "native-subagents", "tester.result.json"), `${JSON.stringify({
    agent: "tester",
    status: "completed",
    requiredFixes: [
      {
        id: "RF-01",
        targetAgents: ["frontend", "devops"],
        severity: "high",
        acceptanceCriteria: ["AC-01"],
        summary: "Wire UI to the real API and align environment variables.",
        evidence: "tester evidence",
        requiredChange: "Update frontend API client and env docs."
      },
      {
        id: "RF-02",
        targetAgents: ["frontend"],
        severity: "medium",
        scope: "src/admin",
        relatedAcceptanceCriteria: ["AC-02"],
        description: "Restore the Admin shell entry so the build can run."
      }
    ],
    targetAgents: ["frontend", "devops"],
    blockers: [],
    blockingIssues: [
      {
        owner: "frontend",
        severity: "high",
        summary: "Protected route runtime remains blocked.",
        details: "The app loops during auth validation instead of entering the protected shell."
      }
    ]
  }, null, 2)}\n`, "utf8");
  const repairPlanOutput = runCli(appDir, ["repair-plan", planOnlyRunId]);
  assertIncludes(repairPlanOutput, "Repair plan generated", "repair-plan output");
  assertIncludes(repairPlanOutput, "repair round: 1/", "repair-plan repair round output");
  assertExists(path.join(planOnlyRunDir, "logs", "repair-plan.md"), "repair-plan markdown");
  assertExists(path.join(planOnlyRunDir, "logs", "repair-loop.json"), "repair-loop json");
  assertExists(path.join(planOnlyRunDir, "tasks", "repairs", "frontend.repair.task.md"), "frontend repair task");
  assertExists(path.join(planOnlyRunDir, "tasks", "repairs", "devops.repair.task.md"), "devops repair task");
  const frontendRepairTask = await readFile(path.join(planOnlyRunDir, "tasks", "repairs", "frontend.repair.task.md"), "utf8");
  assertIncludes(frontendRepairTask, "Restore the Admin shell entry so the build can run.", "repair-plan supports description-only fixes");
  assertIncludes(frontendRepairTask, "AC-02", "repair-plan supports relatedAcceptanceCriteria");
  assertIncludes(frontendRepairTask, "Protected route runtime remains blocked.", "repair-plan renders object blocking issue summary");
  assertNotIncludes(frontendRepairTask, "[object Object]", "repair-plan does not render object blocking issues as [object Object]");
  const repairRefreshOutput = runCli(appDir, ["repair-plan", planOnlyRunId, "--refresh"]);
  assertIncludes(repairRefreshOutput, "refresh: true", "repair-plan refresh output");
  const repairLoopAfterRefresh = JSON.parse(await readFile(path.join(planOnlyRunDir, "logs", "repair-loop.json"), "utf8"));
  if (repairLoopAfterRefresh.rounds.length !== 1 || repairLoopAfterRefresh.rounds[0].round !== 1) {
    throw new Error(`repair-plan --refresh should not add a new round:\n${JSON.stringify(repairLoopAfterRefresh, null, 2)}`);
  }

  const reviewArtifactProblemRun = "2026-06-15-001-review-artifact-check";
  const reviewArtifactRunDir = path.join(appDir, ".harness", "runs", reviewArtifactProblemRun);
  await mkdir(path.join(reviewArtifactRunDir, "artifacts"), { recursive: true });
  await mkdir(path.join(reviewArtifactRunDir, "logs", "native-subagents"), { recursive: true });
  await mkdir(path.join(reviewArtifactRunDir, "tasks"), { recursive: true });
  await writeFile(path.join(reviewArtifactRunDir, "state.json"), `${JSON.stringify({
    runId: reviewArtifactProblemRun,
    stage: "release",
    status: "active",
    outcome: "none",
    archived: false,
    sourceRequirement: ""
  }, null, 2)}\n`, "utf8");
  await writeFile(path.join(reviewArtifactRunDir, "tasks", "reviewer.task.md"), "# Reviewer Task\n", "utf8");
  await writeFile(path.join(reviewArtifactRunDir, "logs", "native-subagents", "native-state.json"), `${JSON.stringify({
    runId: reviewArtifactProblemRun,
    agents: [
      { agent: "reviewer", handle: "reviewer-handle", status: "waiting_review", result_status: "completed", result_captured_at: new Date().toISOString(), retention: { retain_after_result: true } }
    ]
  }, null, 2)}\n`, "utf8");
  await writeFile(path.join(reviewArtifactRunDir, "artifacts", "review-report.md"), "# Review Report\n\n## Conclusion\n\n- [x] pass\n\n## Blocking Issues\n\n- stale note\n\n## Non-Blocking Suggestions\n\n- none\n\n## Risks\n\n- none\n\n## Test Gaps\n\n- none\n\n## Definition Of Done\n\n- [ ] requirement satisfied\n", "utf8");
  const reviewGate = runCliWithStatus(appDir, ["gate-check", reviewArtifactProblemRun], { expectedStatus: 1 });
  assertIncludes(reviewGate, "review-report.md Blocking Issues must be", "review report formatting gate");

  const testArtifactProblemRun = "2026-06-15-001-test-artifact-check";
  const testArtifactRunDir = path.join(appDir, ".harness", "runs", testArtifactProblemRun);
  await mkdir(path.join(testArtifactRunDir, "artifacts"), { recursive: true });
  await mkdir(path.join(testArtifactRunDir, "logs", "native-subagents"), { recursive: true });
  await mkdir(path.join(testArtifactRunDir, "tasks"), { recursive: true });
  await writeFile(path.join(testArtifactRunDir, "state.json"), `${JSON.stringify({
    runId: testArtifactProblemRun,
    stage: "review",
    status: "active",
    outcome: "none",
    archived: false,
    sourceRequirement: ""
  }, null, 2)}\n`, "utf8");
  await writeFile(path.join(testArtifactRunDir, "tasks", "tester.task.md"), "# Tester Task\n", "utf8");
  await writeFile(path.join(testArtifactRunDir, "logs", "native-subagents", "native-state.json"), `${JSON.stringify({
    runId: testArtifactProblemRun,
    agents: [
      { agent: "tester", handle: "tester-handle", status: "waiting_review", result_status: "completed", result_captured_at: new Date().toISOString(), retention: { retain_after_result: true } }
    ]
  }, null, 2)}\n`, "utf8");
  await writeFile(path.join(testArtifactRunDir, "artifacts", "test-report.md"), `# Test Report\n\n## Run\n\n- runId: ${testArtifactProblemRun}\n- tester: tester\n- generatedAt: ${new Date().toISOString()}\n\n## Result Summary\n\n- Verification completed.\n\n## Executed Checks\n\n- Record actual commands.\n\n## Passed Checks\n\n- none\n\n## Failed Or Blocked Checks\n\n- none\n\n## Uncovered Risks\n\n- none\n`, "utf8");
  const testGate = runCliWithStatus(appDir, ["gate-check", testArtifactProblemRun], { expectedStatus: 1 });
  assertIncludes(testGate, "test-report.md must reference checked acceptance criteria", "test report AC gate");

  console.log(JSON.stringify({
    planOnlyRunId,
    planOnlyTaskNames,
    strictFrontendTasksChecked: true
  }, null, 2));
  console.log("test-flow passed");
} finally {
  await stopSmokeServer();
  await rm(tmpRoot, { recursive: true, force: true });
}

async function startSmokeServer() {
  smokeServer = spawn(process.execPath, [
    "-e",
    "const http=require('node:http');const s=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/plain; charset=utf-8'});res.end('ok')});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));process.on('SIGTERM',()=>s.close(()=>process.exit(0)));"
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  return await new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`smoke server did not start: ${stderr}`)), 10000);
    smokeServer.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    smokeServer.stdout.once("data", (chunk) => {
      clearTimeout(timer);
      resolve(Number(chunk.toString().trim()));
    });
    smokeServer.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`smoke server exited early: ${code} ${stderr}`));
    });
  });
}

async function stopSmokeServer() {
  if (!smokeServer) return;
  const child = smokeServer;
  smokeServer = null;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

async function createStrictFrontendRun(appDir) {
  const output = runCli(appDir, [
    "run",
    "--mode=strict",
    "\u7528 crewup \u73b0\u5728\u505a\u4e00\u4e2a\u6700\u5c0f\u53ef\u8fd0\u884c MVP\uff1a\u5b9e\u73b0\u4e00\u4e2a\u672c\u5730\u5f85\u529e\u5217\u8868\u5e94\u7528\uff0c\u5fc5\u987b\u5305\u542b\u5f00\u53d1\u5b9e\u73b0\u3002\u5f53\u524d run \u5fc5\u987b\u5b8c\u6574\u8d70\u5f00\u53d1\u95ed\u73af\uff1a\u9700\u6c42\u786e\u8ba4\u3001\u67b6\u6784/\u5b9e\u73b0\u8ba1\u5212\u3001frontend \u5b9e\u73b0\u3001tester \u9a8c\u8bc1\u3001reviewer \u5ba1\u67e5\u3001release \u603b\u7ed3\u3002\u9a8c\u6536\uff1a\u53ef\u4ee5\u6dfb\u52a0\u5f85\u529e\u3001\u5237\u65b0\u540e\u4fdd\u7559\u3001\u53ef\u4ee5\u6807\u8bb0\u5b8c\u6210\u3001\u53ef\u4ee5\u5220\u9664\u3001build \u901a\u8fc7\u3002"
  ]);
  const runId = extractRunId(output);
  if (!runId) throw new Error(`Failed to detect strict frontend runId from output: ${output}`);
  const runDir = path.join(appDir, ".harness", "runs", runId);
  return {
    frontendTask: await readFile(path.join(runDir, "tasks", "frontend.task.md"), "utf8"),
    testerTask: await readFile(path.join(runDir, "tasks", "tester.task.md"), "utf8"),
    reviewerTask: await readFile(path.join(runDir, "tasks", "reviewer.task.md"), "utf8")
  };
}

async function assertInstallResetPath(tmpRoot, tarball) {
  const resetDir = path.join(tmpRoot, "reset-app");
  await mkdir(resetDir, { recursive: true });
  runNpm(["init", "-y"], resetDir);
  runGit(["init"], resetDir);
  runNpm(["install", "--no-audit", "--no-fund", "--prefer-offline", tarball], resetDir, { timeoutMs: 120000 });
  runCli(resetDir, ["install"]);
  await assertArchiveCommitSkipsNoInitialCommit(resetDir);

  await mkdir(path.join(resetDir, ".harness", "runs", "old-run"), { recursive: true });
  await mkdir(path.join(resetDir, ".harness", "knowledge"), { recursive: true });
  await writeFile(path.join(resetDir, ".harness", "runs", "old-run", "state.json"), "{}\n", "utf8");
  await writeFile(path.join(resetDir, ".harness", "knowledge", "custom.md"), "custom knowledge\n", "utf8");
  await writeFile(path.join(resetDir, ".harness", "scripts", "local-drift.mjs"), "console.log('drift');\n", "utf8");

  const output = runCli(resetDir, ["install", "--reset"]);
  assertIncludes(output, "reset existing .harness/ before install", "install --reset reset notice");
  assertNotExists(path.join(resetDir, ".harness", "runs", "old-run", "state.json"), "reset removed old run state");
  assertNotExists(path.join(resetDir, ".harness", "knowledge", "custom.md"), "reset removed old knowledge state");
  assertNotExists(path.join(resetDir, ".harness", "scripts", "local-drift.mjs"), "reset removed harness core drift");
  assertExists(path.join(resetDir, ".harness", "core-lock.json"), "reset regenerated core lock");

  const doctor = runCli(resetDir, ["doctor"]);
  assertIncludes(doctor, "sealed core", "doctor reports sealed core after reset");
  const encodingHelp = runCli(resetDir, ["doctor", "--encoding-help"]);
  assertIncludes(encodingHelp, "CrewUp Encoding Help", "doctor encoding help title");
  assertIncludes(encodingHelp, "macOS / Linux", "doctor encoding help covers posix terminals");
  const encodingProfile = runCli(resetDir, ["doctor", "--encoding-profile"]);
  assertIncludes(encodingProfile, process.platform === "win32" ? "chcp 65001" : "export LANG=", "doctor encoding profile snippet");
  runCli(resetDir, ["init", "--yes", "--agent", "codex"]);
  runCli(resetDir, ["check"]);
}

async function assertArchiveCommitSkipsNoInitialCommit(appDir) {
  const runId = "2026-06-05-001-no-initial-commit";
  const runDir = path.join(appDir, ".harness", "runs", runId);
  await mkdir(path.join(runDir, "logs"), { recursive: true });
  await writeFile(path.join(runDir, "state.json"), `${JSON.stringify({
    runId,
    stage: "done",
    status: "done",
    outcome: "success",
    archived: false,
    sourceRequirement: ""
  }, null, 2)}\n`, "utf8");
  await writeFile(path.join(runDir, "logs", "changed-files.json"), `${JSON.stringify({ files: [] }, null, 2)}\n`, "utf8");
  const output = runCli(appDir, ["archive-commit", runId]);
  assertIncludes(output, "Archive commit skipped: this repository has no initial git commit.", "archive commit no initial commit skip");
  const auditPath = path.join(runDir, "logs", "archive", "git-commit.md");
  assertExists(auditPath, "archive commit skipped audit");
  const audit = await readFile(auditPath, "utf8");
  assertIncludes(audit, "- status: skipped", "archive skipped audit status");
  assertIncludes(audit, "- reason: repository has no initial git commit", "archive skipped audit reason");
}

function packPackage(packDir) {
  const result = runNpm(["pack", "--json", "--pack-destination", packDir], root);
  const payload = JSON.parse(result.stdout.trim() || "[]");
  const file = payload.at(-1)?.filename;
  if (!file) throw new Error(`npm pack did not return a filename: ${result.stdout || result.stderr || "empty output"}`);
  return path.join(packDir, file);
}

function runNpm(args, cwd, { timeoutMs = 120000 } = {}) {
  const result = process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/c", "npm", ...args], { cwd, encoding: "utf8", timeout: timeoutMs })
    : spawnSync("npm", args, { cwd, encoding: "utf8", timeout: timeoutMs });
  if (process.platform === "win32" && result.error?.code === "ETIMEDOUT") {
    throw new Error(`npm ${args.join(" ")} timed out after ${timeoutMs}ms`);
  }
  if (result.error?.code === "ETIMEDOUT") {
    throw new Error(`npm ${args.join(" ")} timed out after ${timeoutMs}ms`);
  }
  if (result.status !== 0) {
    throw new Error((result.stdout || "") + (result.stderr || "") || `npm ${args.join(" ")} failed`);
  }
  return result;
}

function runGit(args, cwd, { timeoutMs = 30000 } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: timeoutMs });
  if (result.status !== 0) {
    throw new Error((result.stdout || "") + (result.stderr || "") || `git ${args.join(" ")} failed`);
  }
  return result;
}

function commitBaseline(cwd) {
  runGit(["config", "user.email", "crewup-test@example.local"], cwd);
  runGit(["config", "user.name", "CrewUp Test"], cwd);
  runGit(["add", "-A"], cwd);
  const result = spawnSync("git", ["commit", "-m", "test baseline"], { cwd, encoding: "utf8", timeout: 30000 });
  if (result.status !== 0 && !`${result.stdout}${result.stderr}`.includes("nothing to commit")) {
    throw new Error((result.stdout || "") + (result.stderr || "") || "git commit baseline failed");
  }
}

function runCli(cwd, args) {
  const bin = path.join(cwd, "node_modules", "crewup-harness", "bin", "crewup.mjs");
  const result = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stdout || "") + (result.stderr || ""));
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function runCliWithStatus(cwd, args, { expectedStatus = 0 } = {}) {
  const bin = path.join(cwd, "node_modules", "crewup-harness", "bin", "crewup.mjs");
  const result = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8" });
  if (result.status !== expectedStatus) {
    throw new Error(`Expected crewup ${args.join(" ")} status ${expectedStatus}, got ${result.status}\n${result.stdout || ""}${result.stderr || ""}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function runInstalledScript(cwd, scriptRelPath, args, { expectedStatus = 0 } = {}) {
  const script = path.join(cwd, "node_modules", "crewup-harness", scriptRelPath);
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
  if (result.status !== expectedStatus) {
    throw new Error(`Expected ${scriptRelPath} status ${expectedStatus}, got ${result.status}\n${result.stdout || ""}${result.stderr || ""}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function assertPlaceholderDetector() {
  const legitimatePlanningText = [
    "## Open Questions\n- Confirm whether comments require a later moderation flow.",
    "## Implementation Phases\n- The homepage can display a placeholder hero area as a planned module boundary.",
    "## Configuration\n- Provide environment variable templates such as DATABASE_URL and AUTH_SECRET."
  ].join("\n\n");
  if (hasTemplatePlaceholder(legitimatePlanningText)) {
    throw new Error("placeholder detector flagged legitimate planning language");
  }

  for (const placeholder of ["TBD", "waiting for Architect Agent", "fill this acceptance criteria section", "- "]) {
    if (!hasTemplatePlaceholder(placeholder)) {
      throw new Error(`placeholder detector missed template placeholder: ${placeholder}`);
    }
  }
}

function extractRunId(output) {
  const match = /(?:Harness run .*?|CrewUp run prepared)[:\uFF1A]\s*(.+)/.exec(output);
  return match?.[1]?.trim() ?? "";
}

function assertExists(target, label) {
  if (!existsSync(target)) throw new Error(`Missing ${label}: ${target}`);
}

function assertNotExists(target, label) {
  if (existsSync(target)) throw new Error(`Unexpected ${label}: ${target}`);
}

async function seedExistingHarnessState(appDir) {
  const files = [
    [".harness/runs/keep-run/state.json", "{}\n"],
    [".harness/knowledge/custom-note.md", "keep knowledge\n"],
    [".harness/project/custom-state.md", "keep project state\n"],
    [".harness/reports/custom-report.md", "keep report\n"],
    [".harness/dashboard/index.html", "<html>keep dashboard</html>\n"]
  ];
  for (const [relPath, content] of files) {
    const target = path.join(appDir, relPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

function assertExistingHarnessStatePreserved(appDir) {
  for (const relPath of [
    ".harness/runs/keep-run/state.json",
    ".harness/knowledge/custom-note.md",
    ".harness/project/custom-state.md",
    ".harness/reports/custom-report.md",
    ".harness/dashboard/index.html"
  ]) {
    assertExists(path.join(appDir, relPath), `preserved ${relPath}`);
  }
}

async function assertSealedCoreDriftDetected(appDir) {
  const target = path.join(appDir, ".harness", "scripts", "check.mjs");
  const original = await readFile(target, "utf8");
  await writeFile(target, `${original}\n// simulated user-project core drift\n`, "utf8");
  const output = runCliWithStatus(appDir, ["check"], { expectedStatus: 1 });
  assertIncludes(output, "CrewUp sealed core files changed", "check detects sealed core drift");
  await writeFile(target, original, "utf8");
  runCli(appDir, ["check"]);
}

function assertIncludes(output, expected, label) {
  if (!output.includes(expected)) {
    throw new Error(`Missing ${label}: expected "${expected}" in output:\n${output}`);
  }
}

function assertNotIncludes(output, unexpected, label) {
  if (output.includes(unexpected)) {
    throw new Error(`Unexpected ${label}: found "${unexpected}" in output:\n${output}`);
  }
}

function assertSameMembers(actual, expected, label) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(`${label} mismatch.\nExpected: ${expectedSorted.join(", ")}\nActual: ${actualSorted.join(", ")}`);
  }
}

function assertSameArray(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} order mismatch.\nExpected: ${expected.join(" -> ")}\nActual: ${actual.join(" -> ")}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listTaskNames(dir) {
  if (!existsSync(dir)) return [];
  const names = [];
  const tasks = await readdir(dir, { withFileTypes: true });
  for (const entry of tasks) {
    if (entry.isFile() && entry.name.endsWith(".task.md")) names.push(entry.name.replace(/\.task\.md$/, ""));
  }
  return names.sort();
}

function prereqsFor(plan, agent) {
  return plan.tasks.find((task) => task.agent === agent)?.requires_completed_agents ?? [];
}

function assertAgentModel(plan, agent, expected) {
  const task = plan.tasks.find((item) => item.agent === agent);
  if (!task) throw new Error(`Missing task for ${agent}`);
  if (task.model_hint !== expected.modelHint || task.reasoning_effort !== expected.reasoningEffort) {
    throw new Error(`${agent} model mismatch. Expected ${expected.modelHint}/${expected.reasoningEffort}, got ${task.model_hint}/${task.reasoning_effort}`);
  }
}

function renderValidRequirementPlanArtifact() {
  return `# Requirement Plan

## Original Request Summary
Plan a fullstack blog system.

## Historical Context
No historical context.

## Clarification Card
- Ready for user confirmation.

## Requirement Expansion
- Expand the request.

## Goals
- Clarify scope.

## Non-Goals
- Do not write business code.

## Boundary Decisions
- none

## Acceptance Criteria Draft
- Planning artifacts are clear.

## Impact Scope Candidates
- Frontend
- Admin
- API
- Database

## Clarification Questions
- none

## Selected Clarifications
- none

## Open Questions
- Confirm deployment target.
`;
}

function renderFrontendOnlyImplementationPlan() {
  return `# Implementation Plan

## Overview

- Implement only the frontend surface for this run.

## Agent Assignments

| Agent | Scope | Files |
| --- | --- | --- |
| frontend | Catalog UI only | src/**, package.json |

## Excluded Candidates

- backend is not assigned in this run.
- database is not assigned in this run.
- backend、database 暂不授权；只做前端，不改 API 契约或数据库 schema。

## Verification

- Tester verifies the frontend behavior and build.
`;
}

async function markNativeAgentsCompleted(runDir, agentIds) {
  const statePath = path.join(runDir, "logs", "native-subagents", "native-state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  for (const agent of state.agents ?? []) {
    if (!agentIds.includes(agent.agent)) continue;
    agent.handle = `${agent.agent}-handle`;
    agent.status = "waiting_review";
    agent.result_status = "completed";
    agent.result_captured_at = new Date().toISOString();
  }
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

async function seedRequirementsPlanResult(runDir, { status, userConfirmed, includePayload = true }) {
  const resultDir = path.join(runDir, "logs", "native-subagents");
  await writeFile(path.join(resultDir, "requirements-plan.result.md"), [
    "Agent: requirements-plan",
    `Status: ${status}`,
    "Summary: clarification required",
    "Files changed:",
    "Artifacts updated:",
    "Tests:",
    "Blockers:",
    "Handoff:"
  ].join("\n"), "utf8");
  const result = {
    agent: "requirements-plan",
    status,
    summary: "clarification required",
    artifactUpdates: [{ path: "artifacts/requirement-plan.md" }],
    artifactsUpdated: ["artifacts/requirement-plan.md"],
    clarificationQuestions: [
      {
        id: "Q-01",
        question: "Which scope should this run use?",
        type: "single_choice",
        required: true,
        recommendedOptionIds: ["A"],
        options: [
          { id: "A", label: "Tiny frontend only", description: "Smallest scope." },
          { id: "B", label: "Full stack", description: "Requires backend and database." },
          { id: "C", label: "Other", description: "User provides another scope." }
        ]
      }
    ],
    selectedClarifications: [],
    userConfirmationRequired: true,
    userConfirmed,
    confirmationSource: userConfirmed ? "user accepted Q-01:A" : "",
    tests: [],
    blockers: []
  };
  if (includePayload) {
    result.artifactPayloads = {
      "artifacts/requirement-plan.md": {
        title: "Requirement Plan",
        sections: {
          "Original Request Summary": "Plan a fullstack blog system.",
          "Historical Context": "No historical context.",
          "Clarification Card": "ACTION REQUIRED: choose Q-01.",
          "Requirement Expansion": "- Expand the request.",
          "Goals": "- Clarify scope.",
          "Non-Goals": "- Do not write business code.",
          "Boundary Decisions": "- pending",
          "Acceptance Criteria Draft": "- AC-01: Planning artifacts are clear.",
          "Impact Scope Candidates": "- frontend\n- backend",
          "Clarification Questions": "- Q-01: Which scope should this run use?",
          "Selected Clarifications": userConfirmed ? "- Q-01:A" : "- none",
          "Open Questions": userConfirmed ? "- none" : "- Q-01"
        }
      }
    };
  }
  await writeFile(path.join(resultDir, "requirements-plan.result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
