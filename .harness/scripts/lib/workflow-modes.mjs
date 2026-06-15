export const publicModes = new Set(["lite", "strict", "plan", "discovery"]);

const profileByMode = {
  lite: "lite",
  strict: "standard",
  plan: "plan_only",
  discovery: "discovery"
};

const modeByProfile = {
  "lite-v2": "lite",
  lite_v2: "lite",
  standard: "strict",
  full: "strict",
  plan_only: "plan",
  discovery: "discovery"
};

export function profileFromMode(mode, risk = "normal") {
  const normalized = normalizeMode(mode);
  if (!normalized) return null;
  if (normalized === "strict" && String(risk ?? "normal").toLowerCase() === "high") return "full";
  return profileByMode[normalized] ?? null;
}

export function modeFromProfile(profile) {
  const normalized = String(profile ?? "").trim();
  return modeByProfile[normalized] ?? (normalized || "");
}

export function normalizeMode(mode) {
  const normalized = String(mode ?? "").trim().toLowerCase();
  if (!normalized) return "";
  return publicModes.has(normalized) ? normalized : "";
}

export function modeLabel({ mode = "", profile = "", risk = "normal" } = {}) {
  const publicMode = normalizeMode(mode) || modeFromProfile(profile);
  if (publicMode === "strict" && (profile === "full" || String(risk).toLowerCase() === "high")) return "strict high-risk";
  return publicMode || "(unknown)";
}

export function modeHelpText() {
  return [
    "CrewUp run can infer a default mode, or you can choose one explicitly.",
    "",
    "Choose one:",
    "  --mode=lite       formal lightweight implementation with delegated verification",
    "  --mode=strict     formal multi-agent delivery",
    "  --mode=plan       planning only, no business code",
    "  --mode=discovery  project/module discovery, no business code",
    "  --profile=lite-v2  direct scoped implementation without native subagents",
    "",
    "Examples:",
    '  npx crewup run --mode=lite "Fix a small UI issue"',
    '  npx crewup run --mode=strict --risk=high "Add permission system"',
    '  npx crewup run --mode=plan "Design the comments feature; do not write code"',
    "",
    "Chat examples:",
    "  Use CrewUp lite to fix a low-risk UI issue.",
    "  Use CrewUp strict, high risk, to add a permission system.",
    "  Use CrewUp plan only; do not write code.",
    "  Use CrewUp discovery to map the project structure."
  ].join("\n");
}

export function assertKnownMode(mode) {
  if (!mode || normalizeMode(mode)) return;
  throw new Error(`Unknown CrewUp mode: ${mode}. Expected one of: lite, strict, plan, discovery.`);
}
