import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
export { implementationAgentIds } from "./agent-roles.mjs";
import { implementationAgentIds } from "./agent-roles.mjs";

const agentPatterns = {
  frontend: [/\bfrontend\b/i, /\bfront-end\b/i],
  docs: [/\bdocs\b/i, /\bdocumentation\b/i],
  backend: [/\bbackend\b/i, /\bback-end\b/i],
  database: [/\bdatabase\b/i, /\bdb\b/i],
  devops: [/\bdevops\b/i, /\bdeploy(?:ment)?\b/i, /\binfra(?:structure)?\b/i]
};

export function implementationPlanPath(root, runId) {
  return path.join(root, ".harness", "runs", runId, "artifacts", "implementation-plan.md");
}

export function readImplementationPlan(root, runId) {
  const file = implementationPlanPath(root, runId);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}

export function implementationPlanAssignsAgent(content, agentId) {
  if (!implementationAgentIds.has(agentId)) return true;
  const patterns = agentPatterns[agentId] ?? [new RegExp(`\\b${escapeRegExp(agentId)}\\b`, "i")];
  const lines = String(content ?? "")
    .split(/\r?\n/)
    .filter((line) => patterns.some((pattern) => pattern.test(line)));
  return lines.some((line) => isAssignmentLine(line, agentId) && !isExclusionLine(line));
}

export function isImplementationAgentUnassigned(agentId, { root = process.cwd(), runId = "" } = {}) {
  if (!implementationAgentIds.has(agentId)) return false;
  const plan = readImplementationPlan(root, runId);
  if (plan === null) return true;
  return !implementationPlanAssignsAgent(plan, agentId);
}

export function implementationPlanSkipReason(agentId) {
  return `artifacts/implementation-plan.md is missing or does not assign ${agentId}`;
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isExclusionLine(line) {
  return /\b(not assigned|not required|excluded|out of scope|skip|skipped|not needed|no changes?|no[- ]op|confirmation only|read[- ]only confirmation|no schema|no api)\b/i.test(line)
    || /(?:不需要|无需|不授权|暂不授权|排除|跳过|不改|不修改|无变更|只读确认|确认无变更|不涉及)/.test(line);
}

function isAssignmentLine(line, agentId) {
  if (/^\s*\|/.test(line)) {
    const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
    return cells[0]?.toLowerCase() === agentId.toLowerCase();
  }
  return /\b(assign(?:ed|ment)?|owner|agent|implement|change|modify|update|scope|files?)\b/i.test(line)
    || /(?:分配|负责|实现|修改|改造|范围|文件|owner|agent)/i.test(line);
}
