import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { loadProjectProfile } from "./lib/project-profile.mjs";
import { decideContextMode } from "./lib/context-mode.mjs";
import { loadProjectOverlay, renderOverlayContext } from "./lib/project-overlay.mjs";
import { sortByExecutionOrder } from "./lib/execution-order.mjs";
import { completedNativePrerequisitesForAgent } from "./lib/delegation-guard.mjs";
import { isWriteOwnerAgent, writeOwnerAgentIds } from "./lib/agent-roles.mjs";
import {
  buildBridgeTaskManifest,
  isNativeAgentEnvironment,
  readAgentEnvironment,
  renderBridgeManifestMarkdown
} from "./lib/agent-runtime.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const runId = args.find((arg) => !arg.startsWith("--"));
const selectedAgentsArg = args.find((arg) => arg.startsWith("--agents="));
const selectedAgents = selectedAgentsArg
  ? new Set(selectedAgentsArg.replace("--agents=", "").split(",").map((item) => item.trim()).filter(Boolean))
  : null;

if (!runId) {
  console.error("Please provide runId, for example: npm run harness:native-plan -- 2026-05-14-001-blog-mvp");
  process.exit(1);
}

const runDir = path.join(root, ".harness", "runs", runId);
const tasksDir = path.join(runDir, "tasks");
const logsDir = path.join(runDir, "logs", "native-subagents");
const bridgeDir = path.join(runDir, "logs", "agent-bridge");

if (!existsSync(tasksDir)) {
  console.error(`Missing tasks/. Run first: npm run harness:prepare-run -- ${runId}`);
  process.exit(1);
}

await mkdir(logsDir, { recursive: true });
await mkdir(bridgeDir, { recursive: true });

const nativeConfig = parseYaml(await readFile(path.join(root, ".harness", "config", "native-subagents.yaml"), "utf8")).native_subagents;
const modelPolicy = parseYaml(await readFile(path.join(root, ".harness", "config", "model-policy.yaml"), "utf8"));
const contextPolicy = parseYaml(await readFile(path.join(root, ".harness", "config", "context-policy.yaml"), "utf8")).context;
const agentEnvironment = await readAgentEnvironment(root);
const { project_profile: projectProfile } = await loadProjectProfile(root);
const projectOverlay = await loadProjectOverlay(root, projectProfile.ai_overlay?.profile, { projectProfile });
const runState = await readJson(path.join(runDir, "state.json"), {});
const primaryLanguage = runState.primaryLanguage ?? projectProfile.language?.communication ?? "en";
const runInput = await readOptional(path.join(runDir, "input.md"));
const specFreeze = await readOptional(path.join(runDir, "artifacts", "spec-freeze.md"));
const artifactIndex = await readOptional(path.join(runDir, "logs", "context", "artifact-index.md"));
const taskFiles = (await readdir(tasksDir)).filter((name) => name.endsWith(".task.md")).sort();
const tasks = [];

for (const taskFile of taskFiles) {
  const agentId = taskFile.replace(".task.md", "");
  if (selectedAgents && !selectedAgents.has(agentId)) continue;

  const task = await readFile(path.join(tasksDir, taskFile), "utf8");
  const allowedPatterns = extractAllowedPatterns(task);
  const contextPack = await readOptional(path.join(runDir, "logs", "context", `${agentId}.md`));
  const impactScopes = extractImpactScopes(task);
  const projectOverlayContext = await renderOverlayContext(root, projectOverlay, agentId, {
    maxChars: contextPolicy.prompt_budgets?.native_overlay_chars ?? contextPolicy.prompt_budgets?.project_overlay_chars ?? 1200,
    allowedPatterns,
    taskText: task,
    runInput,
    impactScopes
  });
  const contextDecision = decideContextMode({
    agentId,
    task,
    runInput,
    allowedPatterns,
    policy: contextPolicy
  });
  const profile = resolveProfile(modelPolicy, agentId);
  const agentType = nativeConfig.agent_type_by_role?.[agentId] ?? "default";
  const spawnName = `${runId}:${agentId}`;
  const resultPath = `.harness/runs/${runId}/logs/native-subagents/${agentId}.result.md`;
  const resultJsonPath = `.harness/runs/${runId}/logs/native-subagents/${agentId}.result.json`;
  const progressPath = `.harness/runs/${runId}/logs/native-subagents/${agentId}.progress.md`;
  const allowedPatternsWithResult = unique([
    ...allowedPatterns,
    progressPath,
    resultPath,
    resultJsonPath
  ]);
  const prerequisites = completedNativePrerequisitesForAgent(agentId, { root, runId });
  const prompt = renderSpawnPrompt({
    agentId,
    agentType,
    profile,
    primaryLanguage,
    prerequisites,
    task,
    specFreeze,
    allowedPatterns: allowedPatternsWithResult,
    contextPack,
    projectOverlayContext,
    artifactIndex,
    contextDecision,
    budgets: contextPolicy.prompt_budgets ?? {}
  });
  const promptPath = path.join(logsDir, `${agentId}.spawn.md`);
  await writeFile(promptPath, prompt, "utf8");

  tasks.push({
    agent: agentId,
    spawn_name: spawnName,
    agent_type: agentType,
    task_path: path.relative(root, path.join(tasksDir, taskFile)).replaceAll("\\", "/"),
    prompt_path: path.relative(root, promptPath).replaceAll("\\", "/"),
    result_path: resultPath,
    result_json_path: resultJsonPath,
    progress_path: progressPath,
    structured_artifact_payload: extractStructuredArtifactPayload(task),
    handoff_path: `.harness/runs/${runId}/logs/agent-bridge/${agentId}.handoff.md`,
    state: "planned",
    requires_completed_agents: prerequisites,
    wait_group: findGroupForAgent(agentId, nativeConfig),
    close_required: Boolean(nativeConfig.safety?.require_close_agent),
    retention: retentionForAgent(agentId, nativeConfig),
    context_mode: contextDecision.mode,
    context_reasons: contextDecision.reasons,
    model_hint: profile.codex_model_hint ?? profile.model,
    reasoning_effort: profile.reasoning_effort,
    allowed_patterns: allowedPatternsWithResult,
    write_owner: isWriteOwnerAgent(agentId)
  });
}

const orderedTasks = sortByExecutionOrder(tasks.map((task) => task.agent))
  .map((agent) => tasks.find((task) => task.agent === agent))
  .filter(Boolean);

if (!isNativeAgentEnvironment(agentEnvironment)) {
  const bridgeTasks = [];
  for (const task of orderedTasks) {
    const bridgeResultPath = `.harness/runs/${runId}/logs/agent-bridge/${task.agent}.result.json`;
    const bridgeTask = {
      agent: task.agent,
      title: `${task.agent} bridge task`,
      task_path: task.task_path,
      handoff_path: task.handoff_path,
      result_path: bridgeResultPath,
      required_output_contract: {
        status_values: ["completed", "blocked", "needs_input"],
        summary_required: true,
        file_changes_required: true,
        artifact_updates_required: true,
        tests_required: true,
        blockers_required: true,
        handoff_required: true
      }
    };
    bridgeTasks.push(bridgeTask);
    await writeFile(
      path.join(root, bridgeTask.handoff_path),
      renderBridgeHandoff({ task, bridgeTask, agentEnvironment }),
      "utf8"
    );
  }

  const manifest = buildBridgeTaskManifest({
    runId,
    agentEnvironment,
    tasks: bridgeTasks
  });

  await writeFile(path.join(bridgeDir, "bridge-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(bridgeDir, "bridge-manifest.md"), renderBridgeManifestMarkdown(manifest), "utf8");
  await writeFile(path.join(bridgeDir, "bridge-state.json"), `${JSON.stringify({
    runId,
    mode: agentEnvironment.mode,
    agent_environment: agentEnvironment,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tasks: manifest.tasks.map((task) => ({
      agent: task.agent,
      task_path: task.task_path,
      handoff_path: task.handoff_path,
      result_path: task.result_path,
      status: "planned"
    }))
  }, null, 2)}\n`, "utf8");

  console.log(`Bridge task manifest written: ${path.relative(root, bridgeDir)}`);
  console.log(`- selected agent: ${agentEnvironment.id}`);
  for (const task of manifest.tasks) console.log(`- ${task.agent}: ${task.handoff_path}`);
  process.exit(0);
}

  const plan = {
  runId,
  generatedAt: new Date().toISOString(),
  mode: nativeConfig.mode,
  runtime: nativeConfig.runtime ?? {},
  max_parallel_subagents: nativeConfig.safety?.max_parallel_subagents ?? 4,
  retention_capacity: nativeConfig.retention?.capacity ?? {},
  lifecycle: nativeConfig.lifecycle,
  fallback_order: nativeConfig.fallback_order,
  groups: buildGroups(orderedTasks, nativeConfig),
  tasks: orderedTasks,
  tool_protocol: {
    spawn: "spawn_agent(agent_type, message)",
    wait: "wait_agent(targets)",
    close: "close_agent(target)",
    result_path: `.harness/runs/${runId}/logs/native-subagents/<agent>.result.md`,
    result_json_path: `.harness/runs/${runId}/logs/native-subagents/<agent>.result.json`
  }
};

await writeFile(path.join(logsDir, "native-subagent-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
await writeFile(path.join(logsDir, "native-subagent-plan.md"), renderPlanMarkdown(plan), "utf8");
await writeFile(path.join(logsDir, "native-state.json"), `${JSON.stringify(await mergeNativeState(plan), null, 2)}\n`, "utf8");

console.log(`Native subagent plan written: ${path.relative(root, logsDir)}`);
for (const task of orderedTasks) console.log(`- ${task.agent}: ${task.agent_type}, ${task.context_mode}, ${task.prompt_path}`);

function buildGroups(tasks, config) {
  const byAgent = new Map(tasks.map((task) => [task.agent, task]));
  return Object.entries(config.parallel_groups ?? {}).map(([id, group]) => ({
    id,
    parallel: Boolean(group.parallel),
    agents: sortByExecutionOrder((group.agents ?? []).filter((agent) => byAgent.has(agent)))
  })).filter((group) => group.agents.length > 0);
}

function findGroupForAgent(agentId, config) {
  for (const [id, group] of Object.entries(config.parallel_groups ?? {})) {
    if ((group.agents ?? []).includes(agentId)) return id;
  }
  return "unassigned";
}

function retentionForAgent(agentId, config) {
  const policy = writeOwnerAgentIds.has(agentId)
    ? config.retention?.implementation_agents
    : config.retention?.non_implementation_agents;
  return {
    retain_after_result: Boolean(policy?.retain_after_result),
    prefer_resume_before_respawn: Boolean(config.retention?.prefer_resume_before_respawn),
    retained_status_after_completed_result: policy?.retained_status_after_completed_result ?? "completed",
    close_status_before_close_agent: policy?.close_status_before_close_agent ?? "ready_to_close",
    max_idle_minutes: policy?.max_idle_minutes ?? null,
    keep_until: policy?.keep_until ?? []
  };
}

async function mergeNativeState(plan) {
  const statePath = path.join(logsDir, "native-state.json");
  const previous = existsSync(statePath) ? JSON.parse(await readFile(statePath, "utf8")) : {};
  const previousAgents = new Map((previous.agents ?? []).map((agent) => [agent.agent, agent]));
  return {
    runId,
    mode: plan.mode,
    generatedAt: plan.generatedAt,
    updatedAt: new Date().toISOString(),
    fallback: previous.fallback ?? null,
    runtime: plan.runtime,
    retention_capacity: plan.retention_capacity,
    agents: [
      ...(previous.agents ?? []).filter((agent) => !plan.tasks.some((task) => task.agent === agent.agent)),
      ...plan.tasks.map((task) => {
      const existing = previousAgents.get(task.agent) ?? {};
      return {
        agent: task.agent,
        spawn_name: task.spawn_name,
        agent_type: task.agent_type,
        prompt_path: task.prompt_path,
        result_path: task.result_path,
        result_json_path: task.result_json_path,
        progress_path: task.progress_path,
        wait_group: task.wait_group,
        requires_completed_agents: task.requires_completed_agents,
        status: existing.status ?? "planned",
        handle: existing.handle ?? null,
        spawned_at: existing.spawned_at ?? null,
        result_captured_at: existing.result_captured_at ?? null,
        closed_at: existing.closed_at ?? null,
        close_required: task.close_required,
        close_confirmed: existing.close_confirmed ?? false,
        retention: task.retention,
        result_status: existing.result_status ?? null,
        ready_to_close_at: existing.ready_to_close_at ?? null,
        resumed_at: existing.resumed_at ?? null,
        last_error: existing.last_error ?? null
      };
    })
    ]
  };
}

function renderSpawnPrompt({ agentId, agentType, profile, primaryLanguage = "en", prerequisites = [], task, specFreeze, allowedPatterns, contextPack, projectOverlayContext, artifactIndex, contextDecision, budgets = {} }) {
  const taskText = limitText(task, budgets.task_chars ?? 1200);
  const structuredArtifactPayload = extractStructuredArtifactPayload(task);
  const frozenText = limitText(specFreeze, budgets.document_policy_chars ?? 1200);
  const artifactText = limitText(artifactIndex, budgets.artifact_index_chars ?? 900);
  const contextText = limitText(contextPack, budgets.context_pack_chars ?? 900);
  const overlayText = contextPack
    ? "Already included in the context pack; read the overlay/rule files listed in task inputs only if more detail is needed."
    : limitText(projectOverlayContext || "No project overlay found.", budgets.native_overlay_chars ?? budgets.project_overlay_chars ?? 800);
  const lines = [
    `# Native Subagent Task: ${agentId}`,
    "",
    `- runId: ${runId}`,
    `- agent: ${agentId}`,
    `- agent_type: ${agentType}`,
    `- model_hint: ${profile.codex_model_hint ?? profile.model}`,
    `- reasoning_effort: ${profile.reasoning_effort}`,
    `- user_primary_language: ${primaryLanguage}`,
    `- context_mode: ${contextDecision.mode}`,
    `- context_reasons: ${contextDecision.reasons.join("; ")}`,
    `- requires_completed_agents: ${prerequisites.length ? prerequisites.join(", ") : "(none)"}`,
    "",
    "## Runtime Rules",
    "",
    `- Match the user's primary language (${primaryLanguage}) for human-facing summaries, handoff notes, blockers, and coordination comments unless the user requested another language.`,
    `- For requirements clarification, write user-facing card content, question text, option labels, and option descriptions in the user's primary language (${primaryLanguage}) unless the user requested another language.`,
    "- Keep artifact headings, JSON field names, file paths, commands, and status values in English exactly as required by the schema.",
    "- If requires_completed_agents is not `(none)`, the main agent must confirm those agents are completed and captured with `native-state mark-result` before starting you.",
    "- You are not the only agent working in this repository; other agents or the main agent may be progressing orchestration metadata in parallel.",
    "- Do not revert or overwrite changes made by other agents or the user.",
    "- Work only inside your responsibility and allowed write scope.",
    "- Formal Markdown artifacts owned by you must be provided as structured `artifactPayloads` in your result JSON; harness renders the Markdown from the schema.",
    "- Do not ask the main agent to copy artifact body text or manually fix artifact headings.",
    "- If you cannot write your owned artifact, return `blocked` or `needs_input`; do not ask the main agent to write it for you.",
    `- Progress checkpoint: before any long command or broad edit, and after each meaningful milestone, update ${progressPathFor(agentId)} with current step, files touched, command running, and next intended action.`,
    "- Keep progress checkpoints brief. They are for liveness and recovery, not final reporting.",
    "- If you hit a blocker, write the final result files immediately with `status: blocked` instead of continuing silently.",
    "- Result files are subagent-owned audit outputs; write them yourself. The main agent may only register them with `native-state mark-result` after they already exist.",
    "- Do not ask the main agent to create, summarize, or copy your `<agent>.result.md` / `<agent>.result.json` files.",
    "- JSON must use `artifactUpdates` and `artifactsUpdated`; do not use `artifacts` as a substitute.",
    "- `artifactUpdates` and `artifactsUpdated` may list only artifacts you actually wrote or updated.",
    "- If this result repairs or supersedes an earlier result, include `repairOf`, `repairReason`, and `previousResultPath` in the JSON result.",
    "- If you are tester/reviewer and feedback requires code changes, write clear `targetAgents` and `requiredFixes`; do not edit business code directly.",
    "- If you are an implementation agent handling tester/reviewer feedback, fix only issues inside your own scope and cite the feedback source.",
    "- If context is insufficient, return `needs_input` and name the exact missing file or decision.",
    "- If you are requirements-plan and user decisions are missing, return `needs_input` with structured `clarificationQuestions`; the main agent will transport those options to the user.",
    "- If you are requirements-plan on the first pass, return `needs_input` unless prior user answers and `userConfirmed: true` are already present; do not answer your own questions.",
    "- If you are requirements-plan, return at most 3 clarification questions per round, with concise lettered options where possible; keep the last option as `其它` / `Other` unless the choice is intentionally exhaustive.",
    "- If you are requirements-plan, make `artifacts/requirement-plan.md` include a scannable `Clarification Card` with an obvious `ACTION REQUIRED: 需要用户回答` section, compact tables for confirmed facts, needed decisions, non-goals, acceptance preview, ready-to-continue status, and a copyable reply format such as `Q-01:B; Q-02:A`.",
    "- Keep the final result concise and follow the output contract.",
    "",
    "## Allowed Write Scope",
    "",
    ...(allowedPatterns.length ? allowedPatterns.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Current Task",
    "",
    "### Spec Freeze Summary",
    "",
    frozenText || "No spec freeze has been generated yet; ask the main agent to run spec-freeze if needed.",
    "",
    "### Original Task",
    "",
    taskText,
    "",
    "### Structured Artifact Payload Contract",
    "",
    structuredArtifactPayload
      ? limitText(structuredArtifactPayload, budgets.task_chars ?? 1200)
      : "No schema-rendered artifact is owned by this agent.",
    "",
    "## Project Overlay Summary",
    "",
    overlayText,
    "",
    "## Artifact Index",
    "",
    artifactText || "No artifact index has been generated yet; ask the main agent to run context-pack if needed.",
    "",
    "## Context Pack",
    "",
    contextText || "No context pack has been generated yet; read only files inside the allowed scope when needed.",
    "",
    "## Output Contract",
    "",
    `Write the Markdown result file: ${resultPathFor(agentId, "md")}`,
    `Write the JSON result file: ${resultPathFor(agentId, "json")}`,
    `During work, update progress checkpoint: ${progressPathFor(agentId)}`,
    "",
    "For owned Markdown artifacts, do not write Markdown artifact bodies directly. Put section content in `artifactPayloads`; harness renders the artifact Markdown from schema.",
    "",
    "```text",
    `Agent: ${agentId}`,
    "Status: completed / blocked / needs_input",
    "Summary:",
    "Files changed:",
    "Artifacts updated:",
    "Tests:",
    "Blockers:",
    "Handoff:",
    "```",
    "",
    "```json",
    JSON.stringify({
      agent: agentId,
      status: "completed",
      summary: "one sentence result summary",
      filesChanged: [],
      artifactUpdates: [{ path: "artifacts/<owned-artifact>.md" }],
      artifactsUpdated: ["artifacts/<owned-artifact>.md"],
      artifactPayloads: {
        "artifacts/<owned-artifact>.md": {
          title: "Artifact Title",
          sections: {
            "Required Heading": "section content"
          }
        }
      },
      tests: [],
      clarificationQuestions: [],
      selectedClarifications: [],
      userConfirmationRequired: false,
      userConfirmed: false,
      confirmationSource: "",
      repairOf: [],
      repairReason: "",
      previousResultPath: "",
      fixRequired: false,
      targetAgents: [],
      requiredFixes: [],
      blockingIssues: [],
      blockers: [],
      handoff: "next handoff"
    }, null, 2),
    "```",
    ""
  ];

  return lines.join("\n");
}

function renderBridgeHandoff({ task, bridgeTask, agentEnvironment }) {
  const structuredArtifactPayload = task.structured_artifact_payload ?? "";
  return [
    `# Bridge Agent Handoff: ${task.agent}`,
    "",
    `- runId: ${runId}`,
    `- selected_agent: ${agentEnvironment.id}`,
    `- mode: ${agentEnvironment.mode}`,
    `- task_path: ${bridgeTask.task_path}`,
    `- result_path: ${bridgeTask.result_path}`,
    "",
    "## Instructions",
    "",
    "- Execute the task below as an independent agent.",
    "- Stay inside the allowed write scope.",
    "- Do not revert or overwrite unrelated user or agent changes.",
    "- Write the final result as JSON to the exact result_path above.",
    "- Match the user's primary language for human-facing summaries unless the user requested another language.",
    "- For owned Markdown artifacts, provide structured `artifactPayloads`; harness renders Markdown from schema. Do not include full Markdown artifact content in artifactUpdates.",
    "",
    "## Structured Artifact Payload Contract",
    "",
    structuredArtifactPayload || "No schema-rendered artifact is owned by this agent.",
    "",
    "## Required JSON Shape",
    "",
    "```json",
    JSON.stringify({
      agent: task.agent,
      status: "completed | blocked | needs_input",
      summary: "short result summary",
      artifactUpdates: [{ path: "artifacts/<owned-artifact>.md" }],
      artifactsUpdated: ["artifacts/<owned-artifact>.md"],
      artifactPayloads: {
        "artifacts/<owned-artifact>.md": {
          title: "Artifact Title",
          sections: {
            "Required Heading": "section content"
          }
        }
      },
      fileChanges: [{ path: "src/example.ts", mode: "update", reason: "why", content: "full file content" }],
      recommendedCodeChanges: [{ path: "src/example.ts", reason: "why", change: "patch or explanation" }],
      tests: ["command or manual verification"],
      clarificationQuestions: [],
      selectedClarifications: [],
      userConfirmationRequired: false,
      userConfirmed: false,
      confirmationSource: "",
      repairOf: [],
      repairReason: "",
      previousResultPath: "",
      fixRequired: false,
      targetAgents: [],
      requiredFixes: [],
      blockingIssues: [],
      blockers: [],
      handoff: "next step for main agent"
    }, null, 2),
    "```",
    "",
    "## Native Prompt Context",
    "",
    `Read the generated prompt for full context: ${task.prompt_path}`,
    "",
    "## Task Metadata",
    "",
    `- agent_type: ${task.agent_type}`,
    `- context_mode: ${task.context_mode}`,
    `- model_hint: ${task.model_hint}`,
    `- reasoning_effort: ${task.reasoning_effort}`,
    "",
    "## Allowed Write Scope",
    "",
    ...(task.allowed_patterns.length ? task.allowed_patterns.map((item) => `- ${item}`) : ["- none"]),
    ""
  ].join("\n");
}

function extractStructuredArtifactPayload(taskText) {
  const text = String(taskText ?? "");
  const start = text.indexOf("## Structured Artifact Payload");
  if (start < 0) return "";
  const afterStart = text.slice(start + "## Structured Artifact Payload".length).trim();
  const nextHeading = afterStart.search(/\n##\s+/);
  return (nextHeading >= 0 ? afterStart.slice(0, nextHeading) : afterStart).trim();
}

function limitText(text, maxChars) {
  const value = String(text ?? "");
  if (!maxChars || value.length <= maxChars) return value;
  return `${value.slice(0, maxChars).trim()}\n\n...(truncated by native prompt budget; read the source files listed above if details are needed)`;
}

function renderPlanMarkdown(plan) {
  const lines = [
    `# Native Subagent Plan: ${plan.runId}`,
    "",
    `- mode: ${plan.mode}`,
    `- max_parallel_subagents: ${plan.max_parallel_subagents}`,
    "- critical verification order: tester -> reviewer -> release",
    "- do not spawn reviewer before tester completes; do not spawn release before reviewer completes",
    "",
    "## Execution Groups",
    ""
  ];

  for (const group of plan.groups) {
    lines.push(`### ${group.id}`, "", `- parallel: ${group.parallel}`);
    for (const agent of group.agents) lines.push(`- ${agent}`);
    lines.push("");
  }

  lines.push("## Spawn Tasks", "");
  for (const task of plan.tasks) {
    lines.push(`### ${task.agent}`);
    lines.push(`- spawn_name: ${task.spawn_name}`);
    lines.push(`- agent_type: ${task.agent_type}`);
    lines.push(`- wait_group: ${task.wait_group}`);
    lines.push(`- requires_completed_agents: ${task.requires_completed_agents.length ? task.requires_completed_agents.join(", ") : "(none)"}`);
    lines.push(`- context_mode: ${task.context_mode}`);
    lines.push(`- reasons: ${task.context_reasons.join("; ")}`);
    lines.push(`- prompt: ${task.prompt_path}`);
    lines.push(`- result: ${task.result_path}`);
    lines.push(`- result_json: ${task.result_json_path}`);
    lines.push(`- progress: ${task.progress_path}`);
    lines.push(`- close_required: ${task.close_required}`);
    lines.push(`- retain_after_result: ${task.retention.retain_after_result}`);
    lines.push(`- write_owner: ${task.write_owner}`);
    lines.push("");
  }

  lines.push("## Lifecycle Checklist", "");
  lines.push("- Spawn only tasks that can run without blocking the main agent's current coordination work.");
  lines.push("- Do not start a task while its `requires_completed_agents` are incomplete or uncaptured.");
  lines.push("- Wait only when the next critical path step needs that agent's result.");
  lines.push("- Subagents must write `logs/native-subagents/<agent>.result.md/json` themselves; the main agent only registers existing results.");
  lines.push("- Formal artifacts must be written by their owner agents; the main agent captures results but does not author owner artifacts.");
  lines.push("- Keep only subagents with unresolved follow-up in `waiting_review`; completed subagents without follow-up may remain completed.");
  lines.push("- If retention capacity is tight, run `harness:native-state -- <run-id> recommend-close` before starting more agents, but do not retain finished agents just for habit.");
  lines.push("- Prefer resuming retained agents with `send_input`/`resume_agent` instead of spawning replacements.");
  lines.push("- Close an agent only after its result is captured and status is `ready_to_close`.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function resultPathFor(agentId, ext) {
  return `.harness/runs/${runId}/logs/native-subagents/${agentId}.result.${ext}`;
}

function progressPathFor(agentId) {
  return `.harness/runs/${runId}/logs/native-subagents/${agentId}.progress.md`;
}

function resolveProfile(policy, agentId) {
  const agentPolicy = policy.agent_model_policy?.[agentId] ?? policy.agent_model_policy?.main;
  const profileName = agentPolicy?.profile ?? "standard_analysis";
  const profile = policy.model_profiles?.[profileName] ?? policy.model_profiles?.standard_analysis;
  return {
    profile: profileName,
    model: profile?.model ?? "gpt-5.4",
    codex_model_hint: profile?.codex_model_hint ?? profile?.model ?? "gpt-5.4",
    reasoning_effort: profile?.reasoning_effort ?? "medium"
  };
}

function extractAllowedPatterns(task) {
  const lines = task.split(/\r?\n/);
  const patterns = [];
  let inAllowed = false;
  for (const line of lines) {
    if (line.startsWith("## ") && /Allowed Write Scope|Allowed/i.test(line)) {
      inAllowed = true;
      continue;
    }
    if (inAllowed && line.startsWith("## ")) break;
    if (inAllowed && line.trim().startsWith("- ")) patterns.push(normalizeRelPath(line.trim().slice(2)));
  }
  return patterns.filter(Boolean);
}

function extractImpactScopes(task) {
  const line = task.split(/\r?\n/).find((item) => item.trim().startsWith("- impact_scopes:"));
  if (!line) return [];
  return line
    .split(":")
    .slice(1)
    .join(":")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && item !== "(none)");
}

function normalizeRelPath(inputPath) {
  return inputPath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "").trim();
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

async function readOptional(target) {
  if (!existsSync(target)) return "";
  return readFile(target, "utf8");
}

async function readJson(target, fallback = {}) {
  if (!target || !existsSync(target)) return fallback;
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch {
    return fallback;
  }
}


