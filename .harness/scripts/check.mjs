import { access, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { loadProjectProfile } from "./lib/project-profile.mjs";
import { planningAgentIds, verificationAgentIds, writeOwnerAgentIds } from "./lib/agent-roles.mjs";
import { verifyCoreLock } from "./lib/core-lock.mjs";

const root = process.cwd();
const defaultLocalRuleFile = null;
const discoveryExcludes = new Set([
  ".git",
  ".harness",
  ".next",
  ".playwright-cli",
  ".agents",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "output"
]);

const requiredPaths = [
  ".editorconfig",
  "AGENTS.md",
  ".harness/project/profile.yaml",
  ".harness/project/overlay.yaml",
  ".harness/project/agent.yaml",
  ".harness/project/agent-adapter.md",
  ".harness/project/agent-runtime.md",
  ".harness/AGENTS.md",
  ".harness/core-lock.json",
  ".harness/HARNESS-ARCHITECTURE-AND-USAGE.md",
  ".harness/HARNESS-WORKFLOW.md",
  ".harness/config/agents.yaml",
  ".harness/config/archive-policy.yaml",
  ".harness/config/delegation-policy.yaml",
  ".harness/config/feedback-policy.yaml",
  ".harness/config/model-policy.yaml",
  ".harness/config/native-subagents.yaml",
  ".harness/config/service-policy.yaml",
  ".harness/config/write-policy.yaml",
  ".harness/config/checks.yaml",
  ".harness/config/context-policy.yaml",
  ".harness/config/harness-scope-policy.yaml",
  ".harness/config/risk-policy.yaml",
  ".harness/config/artifact-schema.yaml",
  ".harness/config/generated-markdown-schema.yaml",
  ".harness/config/budget-policy.yaml",
  ".harness/config/desktop-runner.yaml",
  ".harness/config/document-policy.yaml",
  ".harness/config/encoding-policy.yaml",
  ".harness/config/skills.yaml",
  ".harness/config/workflow.yaml",
  ".harness/config/quality-gates.yaml",
  ".harness/orchestrator/README.md",
  ".harness/orchestrator/main-agent.md",
  ".harness/orchestrator/native-subagents.md",
  ".harness/orchestrator/routing-rules.md",
  ".harness/orchestrator/human-intervention.md",
  ".harness/orchestrator/codex-desktop-runner.md",
  ".harness/agents/frontend.md",
  ".harness/agents/requirements-plan.md",
  ".harness/rules/frontend.md",
  ".harness/agents/docs.md",
  ".harness/rules/docs.md",
  ".harness/agents/backend.md",
  ".harness/rules/backend.md",
  ".harness/rules/database.md",
  ".harness/rules/devops.md",
  ".harness/rules/tester.md",
  ".harness/rules/reviewer.md",
  ".harness/rules/security.md",
  ".harness/rules/api.md",
  ".harness/contracts/done-definition.md",
  ".harness/templates/requirement.md",
  ".harness/templates/requirement-plan.md",
  ".harness/templates/architecture.md",
  ".harness/templates/test-report.md",
  ".harness/templates/agent-task.md",
  ".harness/templates/main-summary.md",
  ".harness/scripts/run.mjs",
  ".harness/scripts/archive.mjs",
  ".harness/scripts/drive.mjs",
  ".harness/scripts/cancel.mjs",
  ".harness/scripts/continue-run.mjs",
  ".harness/scripts/context-pack.mjs",
  ".harness/scripts/clarify.mjs",
  ".harness/scripts/transition.mjs",
  ".harness/scripts/native-plan.mjs",
  ".harness/scripts/native-state.mjs",
  ".harness/scripts/orchestration-audit.mjs",
  ".harness/scripts/tool-fallback.mjs",
  ".harness/scripts/spec-freeze.mjs",
  ".harness/scripts/repair-state.mjs",
  ".harness/scripts/report.mjs",
  ".harness/scripts/dashboard.mjs",
  ".harness/scripts/knowledge.mjs",
  ".harness/scripts/knowledge-select.mjs",
  ".harness/scripts/archive-commit.mjs",
  ".harness/scripts/changed-files.mjs",
  ".harness/scripts/dev-service.mjs",
  ".harness/scripts/preview-smoke.mjs",
  ".harness/scripts/lib/delegation-guard.mjs",
  ".harness/scripts/lib/agent-runtime.mjs",
  ".harness/scripts/lib/artifact-provenance.mjs",
  ".harness/scripts/lib/script-root.mjs",
  ".harness/scripts/lib/json.mjs",
  ".harness/scripts/token-ledger.mjs",
  ".harness/scripts/test-install-flow.mjs",
  ".harness/scripts/test-flow.mjs",
  ".harness/scripts/doctor.mjs",
  ".harness/scripts/finish.mjs",
  ".harness/scripts/lib/context-mode.mjs",
  ".harness/scripts/lib/core-lock.mjs",
  ".harness/scripts/lib/project-profile.mjs",
  ".harness/scripts/lib/project-overlay.mjs",
  ".harness/scripts/lib/scope-negation.mjs",
  ".harness/scripts/lib/implementation-plan-scope.mjs",
  ".harness/scripts/lib/run-lifecycle.mjs",
  ".harness/scripts/lib/workflow-modes.mjs",
  ".harness/scripts/lib/terminal-encoding.mjs",
  ".harness/scripts/lib/workload-analysis.mjs",
  ".harness/scripts/lib/generated-markdown.mjs",
  ".harness/scripts/lib/runtime-verification.mjs",
  "docs/harness-core-boundary.md",
  "docs/harness-extension-guide.md",
  "docs/harness-script-map.md",
  "docs/harness-script-map.en.md",
  "docs/harness-agent-selection.md",
  "docs/harness-agent-capabilities.md",
  "docs/universal-agent-bridge.md",
  "docs/harness-workflow.md",
  "docs/runbook.md",
  "docs/runbook.en.md",
  "docs/local-testing.md",
  "docs/local-testing.en.md",
  "docs/troubleshooting.md",
  "docs/troubleshooting.en.md",
  "docs/test-matrix.md",
  "docs/test-matrix.en.md",
  "docs/optional-integrations.md",
  ".harness/skills/build.md",
  ".harness/skills/test.md",
  ".harness/skills/ui-verify.md",
  ".harness/skills/release-check.md",
  ".harness/knowledge",
  ".harness/project",
  ".harness/runs",
  "docs"
];

const configFiles = [
  ".harness/config/agents.yaml",
  ".harness/config/archive-policy.yaml",
  ".harness/config/artifact-schema.yaml",
  ".harness/config/budget-policy.yaml",
  ".harness/config/checks.yaml",
  ".harness/config/context-policy.yaml",
  ".harness/config/harness-scope-policy.yaml",
  ".harness/config/delegation-policy.yaml",
  ".harness/config/desktop-runner.yaml",
  ".harness/config/document-policy.yaml",
  ".harness/config/encoding-policy.yaml",
  ".harness/config/model-policy.yaml",
  ".harness/config/native-subagents.yaml",
  ".harness/config/quality-gates.yaml",
  ".harness/config/risk-policy.yaml",
  ".harness/config/skills.yaml",
  ".harness/config/workflow.yaml",
  ".harness/config/write-policy.yaml"
];

const textRootsToScan = [
  ".ai",
  ".harness/AGENTS.md",
  ".harness/HARNESS-WORKFLOW.md",
  ".harness/HARNESS-ARCHITECTURE-AND-USAGE.md",
  ".harness/agents",
  ".harness/config",
  ".harness/contracts",
  ".harness/orchestrator",
  ".harness/knowledge",
  ".harness/rules",
  ".harness/scripts",
  ".harness/templates"
];

const templateTextRootsToScan = [
  "README.md",
  "README.en.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "docs"
];

const errors = [];
const warnings = [];
const isTemplatePackage = await detectTemplatePackage();

await checkRequiredPaths();
await checkYaml();
await checkJson("package.json");
await checkJson("skills-lock.json", { optional: true });
await checkTextEncoding();
await checkCoreLock();
await checkSkills();
await checkProjectOverlay();
await checkAgentAdapter();
await checkAgentRuntime();
await checkKnowledge();
await checkNativeSubagents();
await checkWorkflow();
await checkHarnessScopePolicy();
await checkArtifactOwners();
await checkNativeExecutionGates();
await checkDelegationGuardWiring();

if (errors.length > 0) {
  console.error("Harness check failed:");
  for (const error of errors) console.error(`- ${error}`);
  if (warnings.length > 0) {
    console.warn("\nWarnings:");
    for (const warning of warnings) console.warn(`- ${warning}`);
  }
  process.exit(1);
}

console.log("Harness check passed.");
if (warnings.length > 0) {
  console.warn("Warnings:");
  for (const warning of warnings) console.warn(`- ${warning}`);
}

async function checkRequiredPaths() {
  for (const rel of requiredPaths) {
    if (isTemplatePackage && isProjectGeneratedPath(rel)) continue;
    if (!isTemplatePackage && isTemplateOnlyPath(rel)) continue;
    try {
      await access(path.join(root, rel));
    } catch {
      errors.push(`Missing required path: ${rel}`);
    }
  }
}

async function checkCoreLock() {
  if (isTemplatePackage) return;
  const result = await verifyCoreLock(root);
  if (!result.ok) errors.push(...result.problems);
}

async function checkYaml() {
  for (const rel of configFiles) {
    try {
      parseYaml(await readFile(path.join(root, rel), "utf8"));
    } catch (error) {
      errors.push(`Invalid YAML: ${rel}: ${error.message}`);
    }
  }
}

async function checkJson(rel, { optional = false } = {}) {
  const target = path.join(root, rel);
  if (optional && !existsSync(target)) return;
  try {
    JSON.parse(stripBom(await readFile(target, "utf8")));
  } catch (error) {
    errors.push(`Invalid JSON: ${rel}: ${error.message}`);
  }
}

async function checkTextEncoding() {
  const files = [];
  for (const rel of isTemplatePackage ? [...textRootsToScan, ...templateTextRootsToScan] : textRootsToScan) {
    const target = path.join(root, rel);
    if (!existsSync(target)) continue;
    const statFiles = await collectTextFiles(target);
    files.push(...statFiles);
  }
  files.push(...await collectLocalAiRuleFiles(root, await resolveConfiguredLocalRuleFile()));

  const suspicious = new RegExp(`[\\uFFFD${[
    0x6D93,
    0x9474,
    0x9354,
    0x93C2,
    0x4E63,
    0x4E7C,
    0x4E76,
    0x4E7A,
    0x9286,
    0x951B,
    0x9225,
    0x7039,
    0x20AC
  ].map((code) => `\\u${code.toString(16).padStart(4, "0")}`).join("")}]`);
  const mojibakeTokens = [
    0x6D93,
    0x6D63,
    0x5BF0,
    0x95C2,
    0x690B,
    0x9410,
    0x7441,
    0x7A0B,
    0x937E,
    0x4E63,
    0x4E7A,
    0x4E64,
    0x4E6E,
    0x4E7C,
    0x4E6B,
    0x9286,
    0x951B,
    0x9428,
    0x9359,
    0x93C4
  ].map((code) => String.fromCodePoint(code));
  for (const file of files) {
    const content = await readFile(file, "utf8");
    const tokenHits = mojibakeTokens.filter((token) => content.includes(token));
    if (suspicious.test(content) || tokenHits.length >= 2) {
      errors.push(`Suspicious mojibake or replacement characters: ${path.relative(root, file).replaceAll("\\", "/")}`);
    }
  }
}

async function collectTextFiles(target) {
  const entries = await readdir(target, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    return /\.(md|yaml|mjs|json)$/i.test(target) ? [target] : [];
  }

  const files = [];
  for (const entry of entries) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) files.push(...await collectTextFiles(child));
    if (entry.isFile() && /\.(md|yaml|mjs|json)$/i.test(entry.name)) files.push(child);
  }
  return files;
}

async function collectLocalAiRuleFiles(target, localRuleFile = defaultLocalRuleFile, depth = 0) {
  if (depth > 5) return [];
  if (!localRuleFile) return [];
  const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
  const files = [];
  const ruleFile = path.join(target, normalizeRelPath(localRuleFile));
  if (existsSync(ruleFile)) files.push(ruleFile);

  for (const entry of entries) {
    if (!entry.isDirectory() || discoveryExcludes.has(entry.name)) continue;
    files.push(...await collectLocalAiRuleFiles(path.join(target, entry.name), localRuleFile, depth + 1));
  }
  return files;
}

async function checkSkills() {
  const skillsPath = path.join(root, ".harness/config/skills.yaml");
  if (!existsSync(skillsPath)) return;

  const skillsConfig = parseYaml(await readFile(skillsPath, "utf8"));
  const candidates = skillsConfig.external_skill_candidates ?? {};
  for (const [name, candidate] of Object.entries(candidates)) {
    if (!candidate.install_command?.startsWith("npx skills add ")) {
      warnings.push(`External skill candidate has no standard install command: ${name}`);
    }
  }

  const lockPath = path.join(root, "skills-lock.json");
  if (!existsSync(lockPath)) return;

  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  for (const name of Object.keys(lock.skills ?? {})) {
    const skillFile = path.join(root, ".agents", "skills", name, "SKILL.md");
    if (!existsSync(skillFile)) {
      warnings.push(`skills-lock.json lists ${name}, but .agents/skills/${name}/SKILL.md is missing`);
    }
  }
}

async function checkProjectOverlay() {
  if (isTemplatePackage) return;

  const { project_profile: project } = await loadProjectProfile(root);
  const overlayRel = project?.ai_overlay?.profile ?? ".harness/project/overlay.yaml";
  const overlayPath = path.join(root, overlayRel);
  if (!existsSync(overlayPath)) {
    errors.push(`Missing project AI overlay: ${overlayRel}`);
    return;
  }

  const overlay = parseYaml(await readFile(overlayPath, "utf8"))?.ai_project;
  if (!overlay) {
    errors.push(`${overlayRel} must define ai_project`);
    return;
  }
  if (!overlay.language?.communication) warnings.push(`${overlayRel} should define language.communication`);
  if (!overlay.rules?.common && !overlay.rules?.roles && !overlay.rules?.scopes) {
    warnings.push(`${overlayRel} should define rules.common, rules.roles, or rules.scopes`);
  }

  const ruleFiles = [
    ...(overlay.rules?.common ?? []),
    ...Object.values(overlay.rules?.roles ?? {}).flat(),
    ...Object.values(overlay.rules?.scopes ?? {}).flatMap(scopeRuleFiles)
  ];
  for (const rel of new Set(ruleFiles)) {
    if (!existsSync(path.join(root, rel))) errors.push(`Project overlay rule file missing: ${rel}`);
  }

  for (const [scope, config] of Object.entries(overlay.rules?.scopes ?? {})) {
    if (typeof config !== "object" || Array.isArray(config)) {
      errors.push(`${overlayRel} rules.scopes.${scope} must be an object with files/paths/keywords`);
      continue;
    }
    const hasRuleFiles = scopeRuleFiles(config).length > 0;
    const hasPaths = Array.isArray(config.paths) ? config.paths.length > 0 : Boolean(config.paths);
    if (!hasRuleFiles && !hasPaths) {
      warnings.push(`${overlayRel} rules.scopes.${scope} has neither files nor paths`);
    }
  }
}

async function detectTemplatePackage() {
  const packagePath = path.join(root, "package.json");
  if (!existsSync(packagePath)) return false;
  try {
    const packageJson = JSON.parse(stripBom(await readFile(packagePath, "utf8")));
    return packageJson?.name === "crewup-harness";
  } catch {
    return false;
  }
}

function stripBom(text) {
  return String(text ?? "").replace(/^\uFEFF/, "");
}

function isProjectGeneratedPath(rel) {
  return rel === ".harness/project/profile.yaml"
    || rel === ".harness/project/overlay.yaml"
    || rel === ".harness/project/agent.yaml"
    || rel === ".harness/project/agent-adapter.md"
    || rel === ".harness/core-lock.json";
}

function isTemplateOnlyPath(rel) {
  return rel === ".editorconfig" || rel === "docs" || rel.startsWith("docs/");
}

async function checkAgentAdapter() {
  if (isTemplatePackage) return;
  const rel = ".harness/project/agent.yaml";
  const target = path.join(root, rel);
  if (!existsSync(target)) return;
  try {
    const config = parseYaml(await readFile(target, "utf8"))?.agent_environment;
    const id = config?.id;
    const allowed = new Set(["codex", "claude", "cursor", "trae", "manual"]);
    if (!allowed.has(id)) {
      errors.push(`${rel} agent_environment.id must be one of: ${[...allowed].join(", ")}`);
    }
    if (!config?.label) warnings.push(`${rel} should define agent_environment.label`);
    if (!["native", "experimental", "fallback"].includes(config?.support_level)) {
      errors.push(`${rel} agent_environment.support_level must be native, experimental, or fallback`);
    }
    if (!["native", "bridge", "manual"].includes(config?.mode)) {
      errors.push(`${rel} agent_environment.mode must be native, bridge, or manual`);
    }
    const capabilities = config?.capabilities ?? {};
    for (const key of ["subagents", "parallel_subagents", "command_execution", "file_editing", "structured_results", "state_writeback"]) {
      if (!(key in capabilities)) {
        errors.push(`${rel} agent_environment.capabilities.${key} is required`);
      }
    }
    if (config?.mode !== "native" && capabilities.subagents === true) {
      warnings.push(`${rel} declares subagents=true outside native mode; verify the adapter can really launch and collect subagents`);
    }
  } catch (error) {
    errors.push(`Invalid YAML: ${rel}: ${error.message}`);
  }
}

async function checkAgentRuntime() {
  if (isTemplatePackage) return;
  const rel = ".harness/project/agent.yaml";
  const target = path.join(root, rel);
  if (!existsSync(target)) return;
  try {
    const config = parseYaml(await readFile(target, "utf8"))?.agent_environment;
    if (config?.mode === "bridge" || config?.mode === "manual") {
      const allowed = new Set(["codex", "claude", "cursor", "trae", "manual"]);
      if (!allowed.has(config?.id)) {
        errors.push(`${rel} bridge/manual mode requires a known agent_environment.id`);
      }
      const resultHint = path.join(root, ".harness", "runs");
      if (!existsSync(resultHint)) {
        warnings.push(`${rel} bridge/manual mode is configured, but no runs directory exists yet.`);
      }
    }
  } catch (error) {
    errors.push(`Invalid YAML: ${rel}: ${error.message}`);
  }
}

async function checkKnowledge() {
  const knowledgeRoot = path.join(root, ".harness", "knowledge");
  if (!existsSync(knowledgeRoot)) {
    errors.push("Missing .harness/knowledge.");
    return;
  }
  for (const file of ["README.md", "lessons-learned.md"]) {
    const target = path.join(knowledgeRoot, file);
    if (!existsSync(target)) {
      errors.push(`Knowledge entry file missing: .harness/knowledge/${file}`);
    }
  }
  for (const file of ["dev-map.md", "module-index.json", "run-index.json", "decision-index.md", "task-board.md"]) {
    const target = path.join(knowledgeRoot, file);
    if (isTemplatePackage && !existsSync(target)) continue;
    if (!existsSync(target)) {
    warnings.push(`Generated knowledge file missing: .harness/knowledge/${file}. Run npm run harness:knowledge inside the target project when needed.`);
  }
}
}

function scopeRuleFiles(config) {
  if (!config) return [];
  if (Array.isArray(config)) return config;
  if (typeof config === "string") return [config];
  const files = config.files ?? config.rules ?? [];
  return Array.isArray(files) ? files : [files].filter(Boolean);
}

async function checkNativeSubagents() {
  const rel = ".harness/config/native-subagents.yaml";
  const configPath = path.join(root, rel);
  if (!existsSync(configPath)) return;

  const config = parseYaml(await readFile(configPath, "utf8"))?.native_subagents;
  if (!config) {
    errors.push(`${rel} must define native_subagents`);
    return;
  }

  if (config.mode !== "codex_spawn_agent") {
    warnings.push(`${rel} mode is ${config.mode}; expected codex_spawn_agent for native lifecycle`);
  }

  for (const role of writeOwnerAgentIds) {
    if (config.agent_type_by_role?.[role] !== "worker") {
      errors.push(`${rel} must map ${role} to worker`);
    }
  }

  for (const role of [...planningAgentIds, ...verificationAgentIds].filter((role) => role !== "tester")) {
    if (!["explorer", "default"].includes(config.agent_type_by_role?.[role])) {
      errors.push(`${rel} must map ${role} to explorer or default`);
    }
  }

  const maxParallel = Number(config.safety?.max_parallel_subagents);
  if (!Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > 8) {
    errors.push(`${rel} safety.max_parallel_subagents must be an integer between 1 and 8`);
  }

  if (config.safety?.require_close_agent !== true) {
    errors.push(`${rel} safety.require_close_agent must be true`);
  }

  if (!config.runtime?.state_file || !config.runtime?.result_file_pattern || !config.runtime?.close_audit_required) {
    errors.push(`${rel} runtime must define state_file, result_file_pattern, and close_audit_required`);
  }

  const slowMinutes = Number(config.runtime?.slow_result_capture_minutes);
  if (!Number.isInteger(slowMinutes) || slowMinutes < 15 || slowMinutes > 180) {
    errors.push(`${rel} runtime.slow_result_capture_minutes must be an integer between 15 and 180`);
  }

  const statuses = new Set(config.runtime?.status_values ?? []);
  for (const status of ["waiting_review", "ready_to_close", "closed"]) {
    if (!statuses.has(status)) errors.push(`${rel} runtime.status_values must include ${status}`);
  }

  if (config.retention?.prefer_resume_before_respawn !== true) {
    errors.push(`${rel} retention.prefer_resume_before_respawn must be true`);
  }

  const planningGroups = [
    ["requirements_planning", ["requirements-plan"]],
    ["requirements_confirmation", ["requirements"]],
    ["architecture_planning", ["architect"]]
  ];
  for (const [groupId, requiredAgents] of planningGroups) {
    const group = config.parallel_groups?.[groupId];
    if (!group) {
      errors.push(`${rel} parallel_groups.${groupId} is required`);
      continue;
    }
    if (group.parallel !== false) {
      errors.push(`${rel} parallel_groups.${groupId}.parallel must be false`);
    }
    const agents = new Set(group.agents ?? []);
    for (const agent of requiredAgents) {
      if (!agents.has(agent)) errors.push(`${rel} parallel_groups.${groupId}.agents must include ${agent}`);
    }
  }
  const verificationGroups = [
    ["verification_tester", "tester"],
    ["verification_reviewer", "reviewer"],
    ["verification_release", "release"]
  ];
  for (const [groupId, role] of verificationGroups) {
    const group = config.parallel_groups?.[groupId];
    if (!group) {
      errors.push(`${rel} parallel_groups.${groupId} is required`);
      continue;
    }
    if (group.parallel !== false) {
      errors.push(`${rel} parallel_groups.${groupId}.parallel must be false`);
    }
    const agents = new Set(group.agents ?? []);
    if (!agents.has(role) || agents.size !== 1) {
      errors.push(`${rel} parallel_groups.${groupId}.agents must contain only ${role}`);
    }
  }

  const capacity = config.retention?.capacity ?? {};
  const maxRetained = Number(capacity.max_retained_subagents);
  const maxRetainedImplementation = Number(capacity.max_retained_implementation_agents);
  const maxRetainedNonImplementation = Number(capacity.max_retained_non_implementation_agents);
  if (!Number.isInteger(maxRetained) || maxRetained < 1 || maxRetained > 8) {
    errors.push(`${rel} retention.capacity.max_retained_subagents must be an integer between 1 and 8`);
  }
  if (!Number.isInteger(maxRetainedImplementation) || maxRetainedImplementation < 1 || maxRetainedImplementation > maxRetained) {
    errors.push(`${rel} retention.capacity.max_retained_implementation_agents must be an integer between 1 and max_retained_subagents`);
  }
  if (!Number.isInteger(maxRetainedNonImplementation) || maxRetainedNonImplementation < 1 || maxRetainedNonImplementation > maxRetained) {
    errors.push(`${rel} retention.capacity.max_retained_non_implementation_agents must be an integer between 1 and max_retained_subagents`);
  }
  if (!Array.isArray(capacity.close_recommendation_priority) || capacity.close_recommendation_priority.length === 0) {
    errors.push(`${rel} retention.capacity.close_recommendation_priority must be a non-empty list`);
  }

  const implementationRetention = config.retention?.implementation_agents;
  if (typeof implementationRetention?.retain_after_result !== "boolean") {
    errors.push(`${rel} retention.implementation_agents.retain_after_result must be a boolean`);
  }
  const implementationRetainedStatus = implementationRetention?.retain_after_result ? "waiting_review" : "completed";
  if (implementationRetention?.retained_status_after_completed_result !== implementationRetainedStatus) {
    errors.push(`${rel} retention.implementation_agents.retained_status_after_completed_result must be ${implementationRetainedStatus}`);
  }
  if (implementationRetention?.close_status_before_close_agent !== "ready_to_close") {
    errors.push(`${rel} retention.implementation_agents.close_status_before_close_agent must be ready_to_close`);
  }

  const nonImplementationRetention = config.retention?.non_implementation_agents;
  if (typeof nonImplementationRetention?.retain_after_result !== "boolean") {
    errors.push(`${rel} retention.non_implementation_agents.retain_after_result must be a boolean`);
  }
  const nonImplementationRetainedStatus = nonImplementationRetention?.retain_after_result ? "waiting_review" : "completed";
  if (nonImplementationRetention?.retained_status_after_completed_result !== nonImplementationRetainedStatus) {
    errors.push(`${rel} retention.non_implementation_agents.retained_status_after_completed_result must be ${nonImplementationRetainedStatus}`);
  }
}

async function checkWorkflow() {
  const workflowPath = path.join(root, ".harness/config/workflow.yaml");
  if (!existsSync(workflowPath)) return;

  const workflow = parseYaml(await readFile(workflowPath, "utf8"))?.workflow;
  const { project_profile: project } = await loadProjectProfile(root);
  if (!workflow?.stages?.length) errors.push(".harness/config/workflow.yaml must define workflow.stages");
  if (!workflow?.transitions) errors.push(".harness/config/workflow.yaml must define workflow.transitions");
  if (!workflow?.stage_entry_gates) errors.push(".harness/config/workflow.yaml must define workflow.stage_entry_gates");
  for (const stage of ["intake", "requirements_plan", "requirements_confirm", "plan", "implement", "verify", "review", "release", "done"]) {
    if (!(workflow.stages ?? []).some((item) => item.id === stage)) {
      errors.push(`workflow.stages must include ${stage}`);
    }
  }
  for (const stage of ["requirements_confirm", "plan", "implement", "verify", "review", "release", "done"]) {
    if (!workflow?.stage_entry_gates?.[stage]) {
      errors.push(`workflow.stage_entry_gates must include ${stage}`);
    }
  }
  for (const stage of ["requirements_confirm", "plan", "implement", "review", "release", "done"]) {
    if (workflow?.stage_entry_gates?.[stage]?.require_artifact_provenance !== true) {
      errors.push(`workflow.stage_entry_gates.${stage}.require_artifact_provenance must be true`);
    }
  }
  if (!project?.impact_scopes) {
    const localRuleFile = await resolveConfiguredLocalRuleFile();
    const localRules = await collectLocalAiRuleFiles(root, localRuleFile);
    if (localRules.length === 0) {
      warnings.push(`Project profile has no impact_scopes and no local ${localRuleFile} files were discovered`);
    }
  }

  const liteDescription = workflow?.workflow_profiles?.lite?.description ?? "";
  if (!/not quick mode/i.test(liteDescription)) {
    errors.push("workflow_profiles.lite.description must state that lite is not quick mode");
  }
  const liteAgents = new Set(workflow?.workflow_profiles?.lite?.default_agents ?? []);
  for (const role of ["tester", "reviewer", "release"]) {
    if (!liteAgents.has(role)) {
      errors.push(`workflow_profiles.lite.default_agents must include ${role} for strict narrow formal runs`);
    }
  }

  const standardAgents = new Set(workflow?.workflow_profiles?.standard?.default_agents ?? []);
  for (const role of ["tester", "reviewer", "release"]) {
    if (!standardAgents.has(role)) {
      errors.push(`workflow_profiles.standard.default_agents must include ${role} for implementation closed-loop verification`);
    }
  }

  const verificationAgents = new Set(project?.default_agents?.verification ?? []);
  for (const role of ["tester", "reviewer", "release"]) {
    if (!verificationAgents.has(role)) {
      errors.push(`project_profile.default_agents.verification must include ${role} for tester -> reviewer -> release closure`);
    }
  }
}

async function checkHarnessScopePolicy() {
  const rel = ".harness/config/harness-scope-policy.yaml";
  const target = path.join(root, rel);
  if (!existsSync(target)) {
    errors.push(`Missing required path: ${rel}`);
    return;
  }

  const scope = parseYaml(await readFile(target, "utf8"))?.harness_scope;
  if (scope?.activation_policy?.default !== "inactive_until_explicit") {
    errors.push(`${rel} activation_policy.default must be inactive_until_explicit`);
  }
  if (scope?.once_run_created?.main_agent_code_write !== "forbidden") {
    errors.push(`${rel} once_run_created.main_agent_code_write must be forbidden`);
  }
  for (const key of ["delegation_required", "artifact_ownership_required", "gate_check_required", "report_required", "finish_required"]) {
    if (scope?.once_run_created?.[key] !== true) {
      errors.push(`${rel} once_run_created.${key} must be true`);
    }
  }
  if (scope?.profile_semantics?.lite && !/not quick mode/i.test(scope.profile_semantics.lite)) {
    errors.push(`${rel} profile_semantics.lite must state that lite is not quick mode`);
  }
}

async function checkArtifactOwners() {
  const schemaPath = path.join(root, ".harness/config/artifact-schema.yaml");
  const agentsPath = path.join(root, ".harness/config/agents.yaml");
  if (!existsSync(schemaPath) || !existsSync(agentsPath)) return;

  const schema = parseYaml(await readFile(schemaPath, "utf8"));
  const agents = parseYaml(await readFile(agentsPath, "utf8"))?.agents ?? {};
  const validOwners = new Set(["main", ...Object.keys(agents)]);
  for (const [artifact, rules] of Object.entries(schema?.artifacts ?? {})) {
    if (!rules.owner) {
      errors.push(`artifact-schema.yaml ${artifact} must declare owner`);
      continue;
    }
    if (!validOwners.has(rules.owner)) {
      errors.push(`artifact-schema.yaml ${artifact} owner is unknown: ${rules.owner}`);
    }
  }
}

async function checkNativeExecutionGates() {
  const workflowPath = path.join(root, ".harness", "config", "workflow.yaml");
  if (!existsSync(workflowPath)) return;
  const workflow = parseYaml(await readFile(workflowPath, "utf8"))?.workflow;
  const stages = new Set((workflow?.stages ?? []).map((item) => item.id));
  if (!stages.has("requirements_plan") || !stages.has("plan")) return;

  const mainAgentPath = path.join(root, ".harness", "orchestrator", "main-agent.md");
  if (!existsSync(mainAgentPath)) return;
  const mainAgent = await readFile(mainAgentPath, "utf8");
  if (!mainAgent.includes("native-plan") || !mainAgent.includes("spawn_agent")) {
    errors.push(".harness/orchestrator/main-agent.md must describe native-plan and spawn_agent as the primary execution path");
  }

  const nativePath = path.join(root, ".harness", "config", "native-subagents.yaml");
  if (!existsSync(nativePath)) return;
  const native = parseYaml(await readFile(nativePath, "utf8"))?.native_subagents;
  const lifecycle = native?.lifecycle ?? {};
  const afterResult = Array.isArray(lifecycle.after_result) ? lifecycle.after_result.join("\n") : "";
  if (!afterResult.includes("waiting_review") || !afterResult.includes("ready_to_close") || !afterResult.includes("completed subagents without follow-up")) {
    errors.push(".harness/config/native-subagents.yaml after_result must keep only follow-up subagents in waiting_review and require ready_to_close before closing retained agents");
  }
}

async function checkDelegationGuardWiring() {
  const guardPath = path.join(root, ".harness", "scripts", "lib", "delegation-guard.mjs");
  if (!existsSync(guardPath)) {
    errors.push("Missing delegation guard: .harness/scripts/lib/delegation-guard.mjs");
    return;
  }

  const requiredReferences = [
    [".harness/scripts/transition.mjs", "evaluateDelegationGuard"],
    [".harness/scripts/gate-check.mjs", "evaluateDelegationGuard"],
    [".harness/scripts/changed-files.mjs", "evaluateDelegationGuard"]
  ];

  for (const [rel, marker] of requiredReferences) {
    const target = path.join(root, rel);
    if (!existsSync(target)) {
      errors.push(`Delegation guard target missing: ${rel}`);
      continue;
    }
    const content = await readFile(target, "utf8");
    if (!content.includes(marker)) {
      errors.push(`${rel} must enforce delegated business-code writes via ${marker}`);
    }
  }

  const mainAgentPath = path.join(root, ".harness", "orchestrator", "main-agent.md");
  if (existsSync(mainAgentPath)) {
    const mainAgent = await readFile(mainAgentPath, "utf8");
    if (!mainAgent.includes("harness:changed-files") || !mainAgent.includes("native-state mark-fallback")) {
      errors.push(".harness/orchestrator/main-agent.md must document changed-files guard and native fallback handling");
    }
  }
}

async function resolveConfiguredLocalRuleFile() {
  try {
    const { project_profile: project } = await loadProjectProfile(root);
    const overlayRel = project?.ai_overlay?.profile ?? ".harness/project/overlay.yaml";
    const overlayPath = path.join(root, overlayRel);
    const overlay = existsSync(overlayPath)
      ? parseYaml(await readFile(overlayPath, "utf8"))?.ai_project
      : null;
    return project?.ai_overlay?.local_rule_file ?? overlay?.discovery?.local_rule_file ?? defaultLocalRuleFile;
  } catch {
    return defaultLocalRuleFile;
  }
}

function normalizeRelPath(inputPath) {
  return String(inputPath ?? "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "").trim();
}

