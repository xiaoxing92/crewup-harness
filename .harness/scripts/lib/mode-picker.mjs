import { analyzeWorkload } from "./workload-analysis.mjs";

export function renderRunModePicker({ requestText, command = "run" }) {
  const recommendation = recommendRunMode(requestText);
  const quoted = quoteForCommand(requestText);
  return [
    "CrewUp can infer a default mode, or you can choose one explicitly.",
    "",
    "Available modes:",
    "",
    "A. plan",
    "   Only plan; do not change business code.",
    "   Use when requirements are unclear, you need a design/roadmap, or you want team/customer review first.",
    "",
    "B. lite-v2",
    "   Direct small scoped implementation without native subagents.",
    "   Use for a single bug, small UI/copy change, one component/API tweak, or one phase from an existing plan.",
    "",
    "C. lite",
    "   Formal lightweight implementation with delegated verification.",
    "   Use when you want tester/reviewer/release evidence but not the full strict planning chain.",
    "",
    "D. strict",
    "   Full delivery workflow.",
    "   Use for complete features, cross-module work, frontend/backend/database/auth changes, or work needing full provenance.",
    "",
    `Default: ${recommendation.mode}`,
    `Reason: ${recommendation.reason}`,
    "",
    "Examples:",
    `  npx crewup ${command} ${quoted}`,
    `  npx crewup ${command} --profile=lite-v2 ${quoted}`,
    `  npx crewup ${command} --mode=lite ${quoted}`,
    `  npx crewup ${command} --mode=strict ${quoted}`
  ].join("\n");
}

export function renderContinueModePicker({ sourceRunId, requestText, sourceState }) {
  const recommendation = recommendContinueMode(requestText, sourceState);
  const quoted = quoteForCommand(requestText);
  const planSource = sourceState?.workflowProfile === "plan_only";
  return [
    "CrewUp can infer a continuation mode, or you can choose one explicitly.",
    "",
    planSource
      ? `Source run ${sourceRunId} is a plan run. Choose how to use the approved plan:`
      : `Choose how to continue from source run ${sourceRunId}:`,
    "",
    "A. plan - continue planning only; do not change business code.",
    "B. lite-v2 - implement one small scoped part directly.",
    "C. lite - use delegated verification without the full strict chain.",
    "D. strict - use full follow-up delivery.",
    "",
    `Default: ${recommendation.mode}`,
    `Reason: ${recommendation.reason}`,
    "",
    "Examples:",
    `  npx crewup continue ${sourceRunId} ${quoted}`,
    `  npx crewup continue ${sourceRunId} --profile=lite-v2 ${quoted}`,
    `  npx crewup continue ${sourceRunId} --mode=lite ${quoted}`,
    `  npx crewup continue ${sourceRunId} --mode=strict ${quoted}`
  ].join("\n");
}

export function recommendedRunProfile(requestText) {
  return recommendRunMode(requestText).profile;
}

export function recommendedContinueProfile(requestText, sourceState) {
  return recommendContinueMode(requestText, sourceState).profile;
}

function recommendRunMode(requestText) {
  const analysis = analyzeWorkload(requestText, { requestedProfile: "auto" });
  if (analysis.signals.planOnly) return { mode: "plan", profile: "plan_only", reason: "The request explicitly asks for planning/no-code work." };
  if (analysis.signals.highRisk || analysis.signals.strictWorkflow || analysis.signals.deepPlanning || analysis.complexityScore >= 4) {
    return { mode: "strict", profile: analysis.signals.highRisk || analysis.signals.strictWorkflow ? "full" : "standard", reason: "The request appears broad or risky enough to need full delivery evidence." };
  }
  return { mode: "lite-v2", profile: "lite-v2", reason: "The request appears small enough for a direct scoped implementation run." };
}

function recommendContinueMode(requestText, sourceState) {
  const analysis = analyzeWorkload(requestText, { requestedProfile: "auto" });
  if (analysis.signals.planOnly) return { mode: "plan", profile: "plan_only", reason: "The follow-up explicitly asks for planning/no-code work." };
  if (sourceState?.workflowProfile === "plan_only") {
    if (/\bphase\b|first|only|small|part|slice|阶段|第一阶段|只做|先做|小范围/i.test(String(requestText ?? ""))) {
      return { mode: "lite-v2", profile: "lite-v2", reason: "The follow-up appears to implement one scoped part of the plan." };
    }
    return { mode: "strict", profile: "standard", reason: "Continuing from a plan run usually means implementing the approved plan." };
  }
  if (sourceState?.archived === true && sourceState?.outcome === "success" && analysis.complexityScore <= 2) {
    return { mode: "lite-v2", profile: "lite-v2", reason: "This looks like a small follow-up after a successful archived run." };
  }
  if (analysis.signals.highRisk || analysis.signals.strictWorkflow || analysis.signals.deepPlanning || analysis.complexityScore >= 4) {
    return { mode: "strict", profile: analysis.signals.highRisk || analysis.signals.strictWorkflow ? "full" : "standard", reason: "The follow-up appears broad or risky enough to need the full workflow." };
  }
  return { mode: "lite-v2", profile: "lite-v2", reason: "The follow-up appears small enough for a direct scoped implementation run." };
}

function quoteForCommand(value) {
  const text = String(value ?? "").trim();
  if (!text) return "\"...\"";
  return `"${text.replaceAll('"', '\\"')}"`;
}
