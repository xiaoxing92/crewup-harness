<p align="center">
  <img src="./assets/crewup-hero.svg" alt="CrewUp stable AI workflow architecture" width="780" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/crewup-harness"><img src="https://img.shields.io/npm/v/crewup-harness?color=1463ff" alt="npm version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-black" alt="MIT license" /></a>
  <a href="./docs/harness-workflow.md"><img src="https://img.shields.io/badge/workflow-strict-blue" alt="strict workflow" /></a>
  <a href="./docs/runbook.md"><img src="https://img.shields.io/badge/runbook-ready-black" alt="runbook" /></a>
</p>

<h3 align="center">面向严肃工程交付的 AI 工作流 Harness</h3>

<p align="center">
  <a href="./README.en.md">English</a>
  ·
  <a href="./docs/getting-started.md">快速开始</a>
  ·
  <a href="./docs/harness-workflow.md">工作流</a>
  ·
  <a href="./docs/command-governance.md">命令治理</a>
  ·
  <a href="./docs/test-matrix.md">测试矩阵</a>
</p>

---

CrewUp 是一套可复用的 AI engineering workflow harness。它不是 prompt 包，也不是让一个主 agent 什么都做的技巧集合，而是把一次 AI 交付拆成明确的 run、角色、产物、门禁、报告和归档。

它解决的是 vibe coding 里最容易失控的部分：需求没澄清就开写、主 agent 越权写业务代码、多个子 agent 乱序并发、tester/reviewer 反馈被直接绕过、上下文越堆越乱，以及“到底完成没有”说不清。

CrewUp 的当前设计原则很简单：

- 正式工作必须显式进入 CrewUp；用户可以指定 `crewup run --mode=lite|strict|plan|discovery`，也可以让 CLI 按请求风险选择默认 profile。
- 没有显式模式时，CrewUp 会输出自动选择的 mode/profile：小范围低风险默认走 `lite-v2`，宽范围或高风险默认走 strict/full；用户仍可用 `--mode` 或 `--profile` 覆盖。
- 主 agent 负责创建 run、调度、登记结果、跑 gate/report/archive，并向用户汇报状态。
- 正式产物由对应 owner agent 生成：需求、架构、实现、测试报告、评审报告和发布摘要都有明确归属。
- 非成功结果默认保持 run open；只有用户明确放弃或关闭时才 `archive --close`。
- 长期经验通过 Memory Hints 轻量沉淀，只有显式晋级的经验才进入后续上下文。
- 公共命令面保持精简，低价值历史入口已移除，日常只保留稳定主路径。

## 适合谁

CrewUp 更适合长期迭代的大型项目、团队项目、复杂重构、全栈系统，以及需要严格 AI 开发流程的代码库。

如果只是一次性小修、小问答、临时脚本或很小的个人实验，可以不启用 CrewUp。安装 CrewUp 不代表接管所有 AI 对话；只有用户明确说“使用 CrewUp / 按 harness 流程 / 继续某个 CrewUp run”时才进入正式流程。

## 快速开始

```bash
npm install -D crewup-harness
npx crewup install
npx crewup init --agent codex --yes
npx crewup check
```

已有项目建议先做无 AI 扫描：

```bash
npx crewup inspect --no-ai
npx crewup init --agent codex --yes
```

升级已安装项目：

```bash
npx crewup install --force
```

`--force` 会更新 `.harness` 可复用核心，同时保留：

- `.harness/runs/`
- `.harness/knowledge/`
- `.harness/project/`
- `.harness/reports/`
- `.harness/dashboard/`

只有在明确想清空旧 `.harness/` 时才使用：

```bash
npx crewup install --reset
```

## 第一次使用

CLI：

```bash
npx crewup run --mode=strict "使用 CrewUp 做一个最小 counter web app，跑完整 workflow。验收标准：页面显示 counter，初始值为 0；可以 +1、-1、reset；刷新后数值保留。范围：只做一个很小的前端实现。完成后请根据项目配置自行发现并执行必要验证。"
```

聊天里可以这样说：

```text
使用 CrewUp strict 做一个最小 counter web app，跑完整 workflow。验收标准：页面显示 counter，初始值为 0；可以 +1、-1、reset；刷新后数值保留。范围：只做一个很小的前端实现。完成后请根据项目配置自行发现并执行必要验证。
```

如果是在聊天里提出需求，用户可以明确 CrewUp 模式；没有说明模式时，主 agent 可以运行 `npx crewup run "<需求>"`，让 CrewUp 打印自动选择的 mode/profile。拿到 runId 后继续 `npx crewup next-agent <run-id>` 或 `npx crewup drive <run-id>`。用户不需要为了拿 runId 手动跑命令。

如果没有明确模式，`npx crewup run "..."` 会按请求内容选择保守默认值并创建 run。小修、小 UI、单模块 bug 默认走直接轻量 `lite-v2`；完整功能、跨模块、高风险或明确 strict 的请求默认走 strict/full。

## 模式怎么选

用户只需要选择“这次工作想要什么交付契约”，不需要告诉 AI 应该跑 `build`、`test`、`lint` 还是启动哪个服务。CrewUp 会要求 agent 从项目证据里自己发现验证方式，例如 `package.json`、README、CI 配置、框架配置、测试目录和已有脚本。

| 你想要的结果 | 选择 | 适合说法 | 会不会改业务代码 |
| --- | --- | --- | --- |
| 先把需求、架构、验收标准和实施步骤想清楚 | `plan` | `使用 CrewUp plan，只规划，不写代码。` | 不会 |
| 修一个小 bug、小 UI、文案、单个组件或一个明确小阶段 | `lite` | `使用 CrewUp lite，修复这个小问题，并自行完成必要验证。` | 会 |
| 做一个完整功能、跨模块改造、全栈需求，或需要 tester/reviewer/release 证据 | `strict` | `使用 CrewUp strict，完整实现这个需求。` | 会 |
| 权限、数据库、安全、部署、数据迁移、大范围重构 | `strict --risk=high` | `使用 CrewUp strict，高风险，完成这个改造。` | 会 |
| 先盘点一个陌生项目、模块、技术栈和风险 | `discovery` | `使用 CrewUp discovery，盘点这个项目并给后续 run 建议。` | 不会 |

最常用的判断：

- 不确定怎么做，只想先要方案：用 `plan`。
- 已经明确只是小修小改：用 `lite`。
- 要交付一个完整需求：用 `strict`。
- 涉及安全、权限、数据库、部署或很多模块：用 `strict --risk=high`。

`plan` run 成功后不会自动开始实现。后续要实现时，基于这个 plan 创建新的 continuation run：

```bash
npx crewup continue <plan-run-id> --mode=lite "按计划只实现第一阶段"
npx crewup continue <plan-run-id> --mode=strict "按已批准计划完整实现"
```

如果你没有写 `--mode`：

```bash
npx crewup run "把博客项目全站中文化"
npx crewup continue <run-id> "继续实现"
```

CrewUp 会显示自动选择的 mode/profile 并创建 run。小范围低风险实现通常默认走 `lite-v2`；如果请求宽泛、涉及高风险范围，或明确要求完整交付，则默认走 strict/full。想强制某条路径时仍建议显式写 `--mode=plan|lite|strict|discovery` 或 `--profile=lite-v2`。

## 工作流一览

默认 strict 流程：

```text
requirements-plan
  -> requirements
  -> architect
  -> implementation agents assigned by implementation-plan.md
  -> tester
  -> reviewer
  -> release
```

关键规则：

- 初始 `next-agent` 只应该允许 `requirements-plan`。
- `requirements` 必须等 `requirements-plan` 完成并登记结果。
- `architect` 必须等正式需求完成。
- 实现类 agent 只是候选；只有 `implementation-plan.md` 明确分配后才启动。
- tester/reviewer 的阻塞反馈必须回派给对应 owner agent。
- 主 agent 不粘贴长结果，不代写 owner artifact，不代修业务代码。

## 常用命令

普通使用者不需要记住所有 `.harness/scripts`。日常主路径优先使用：

| 命令 | 作用 |
| --- | --- |
| `npx crewup doctor` | 检查环境、编码、可选能力和 sealed core |
| `npx crewup install` | 安装 CrewUp harness 模板 |
| `npx crewup install --force` | 安全升级 harness core，保留运行态数据 |
| `npx crewup inspect --no-ai` | 无 AI 扫描项目结构 |
| `npx crewup init --agent codex --yes` | 生成项目适配层 |
| `npx crewup check` | 校验配置、脚本、模板、文档和 sealed core |
| `npx crewup run --mode=lite "..."` | 创建轻量实现 run |
| `npx crewup run --mode=strict "..."` | 创建正式多 agent run |
| `npx crewup run --mode=strict --risk=high "..."` | 创建高风险 full profile run |
| `npx crewup run --mode=plan "..."` | 创建只规划、不改业务代码的 run |
| `npx crewup run --mode=discovery "..."` | 创建项目/模块盘点 run |
| `npx crewup status` / `npx crewup runs` | 列出所有 run，查找 runId |
| `npx crewup explain <run-id>` | 解释 run 为什么卡住、是否完成、下一步做什么 |
| `npx crewup drive <run-id>` | 自动执行可脚本化的推进、检查和收口步骤 |
| `npx crewup next-agent <run-id>` | 查看当前真正可启动的子 agent |
| `npx crewup native-state <run-id> diagnose` | 诊断子 agent handle、result 和状态差异 |
| `npx crewup native-state <run-id> reconcile-results` | 对账已存在但漏登记的子 agent result |
| `npx crewup audit <run-id>` | 审计调度顺序、owner 边界、上下文压力和返工 |
| `npx crewup gate-check <run-id>` | 检查 gate、产物归属和越权风险 |
| `npx crewup preview-smoke <run-id> --url=http://localhost:3000` | 验证预览 URL 并写入 smoke 证据 |
| `npx crewup report <run-id>` | 生成结构化交付报告 |
| `npx crewup finish <run-id>` | 成功完成并按策略归档 run |
| `npx crewup archive <run-id> --outcome=blocked --reason="..."` | 标记非成功状态但默认保持 run open |
| `npx crewup archive <run-id> --outcome=blocked --reason="..." --close` | 用户明确放弃/关闭时才归档非成功 run |
| `npx crewup cancel <run-id> --reason="..."` | 取消 run 并保留证据 |
| `npx crewup continue <run-id> --mode=lite "..."` | 基于历史 run 创建小范围延续实现 run |
| `npx crewup continue <run-id> --mode=strict "..."` | 基于历史 run 创建完整延续交付 run |
| `npx crewup continue <run-id> --mode=plan "..."` | 基于历史 run 创建延续规划 run |
| `npx crewup learn <run-id>` | 从 run 中生成候选经验，不自动影响后续调度 |
| `npx crewup learn-promote <lesson-id>` | 将候选经验显式晋级为 Memory Hints |

完整分层见 [命令与完成态治理](./docs/command-governance.md)。

## Memory Hints

CrewUp 的知识层不会把每次 run 的长日志都塞进后续上下文。归档和学习流程会先生成候选经验，再由维护者显式晋级：

```bash
npx crewup learn <run-id>
npx crewup learn-promote <lesson-id>
```

晋级后的经验会进入 `.harness/knowledge/memory-hints.md`，后续只按相关性选择短提示，降低 token 消耗并减少重复踩坑。详见 [Memory Hints](./docs/memory-hints.md)。

## 本地验证

```bash
npm run harness:check
npm test
npm run test:pack-install
npm run release:preflight
```

`release:preflight` 会运行 harness 校验、示例测试、临时项目 pack-install flow 测试和 `npm pack --dry-run`。发包前建议完整跑一遍。

## 文档

| 文档 | 内容 |
| --- | --- |
| [快速开始](./docs/getting-started.md) | 安装、API key、第一次 run 和排查 |
| [工作流](./docs/harness-workflow.md) | 阶段、owner artifact、调度和 gate |
| [模式治理](./docs/mode-governance.md) | 聊天怎么指定模式、每种模式生成什么、怎么判断完成 |
| [默认模式选择](./docs/mode-picker.md) | 没有显式 mode 时如何选择默认 profile，以及如何覆盖 |
| [Lite](./docs/lite-v2.md) | 默认直接轻量流程和显式 lightweight 模式 |
| [Runbook](./docs/runbook.md) | 怎么判断正常、完成、卡住、取消和继续 |
| [命令治理](./docs/command-governance.md) | 命令分层和完成态治理 |
| [Memory Hints](./docs/memory-hints.md) | 候选经验、显式晋级和低 token 复用 |
| [Troubleshooting](./docs/troubleshooting.md) | 终端编码、乱码判断和跨平台修复 |
| [本地测试](./docs/local-testing.md) | 使用 `npm pack` 和临时项目测试 CrewUp |
| [测试矩阵](./docs/test-matrix.md) | 不同改动应该跑哪些验证 |
| [核心边界](./docs/harness-core-boundary.md) | `.harness` 核心、项目适配层和运行态边界 |
| [Agent 能力矩阵](./docs/harness-agent-capabilities.md) | Codex/Claude/Cursor/Trae/Manual 支持边界 |
| [Agent 选择](./docs/harness-agent-selection.md) | `init` 选择项和适配层策略 |
| [Universal Agent Bridge](./docs/universal-agent-bridge.md) | 外部 agent handoff 和 result JSON 契约 |
| [脚本地图](./docs/harness-script-map.md) | 公开命令、核心流水线和维护脚本边界 |

## API Key 和子 Agent

CrewUp 是工作流 harness，不提供模型额度、API key 或内置云端 runner。

- `codex` native 模式依赖当前 Codex Desktop / CLI 的登录状态和 native subagent 能力。
- SDK/API 路径和 `inspect --ai` 需要 `OPENAI_API_KEY`。
- `claude`、`cursor`、`trae` 当前通过 Universal Agent Bridge 接入，使用各自工具的登录状态或 API key。
- `manual` 不需要 AI API key，由人或外部工具执行 handoff 并写回结果。

PowerShell：

```powershell
$env:OPENAI_API_KEY="sk-..."
```

macOS / Linux：

```bash
export OPENAI_API_KEY="sk-..."
```
