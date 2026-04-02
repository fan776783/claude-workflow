# @justinfan/agent-workflow

以 `workflow` command 入口 + 模块化 workflow skills 为核心的多 AI 编码工具工作流工具集。

它提供一套可移植的 Skills 体系，用于把需求从"自然语言描述"推进到"Spec / Plan / 可执行任务"，并支持 Claude Code、Cursor、Codex、Gemini CLI、Antigravity、Droid 等多种 AI 编码工具。

---

## 核心能力

### Workflow 主线

`/workflow` 是统一 command 入口，路由到 4 个专项 workflow skills：

| 命令 | 路由到 | 说明 |
|------|--------|------|
| `/workflow start` | `workflow-planning` | 代码分析、需求讨论、UX 设计审批、Spec / Plan 生成 |
| `/workflow execute` | `workflow-executing` | 治理决策、任务执行、验证、审查与状态推进 |
| `/workflow delta` | `workflow-delta` | 需求 / PRD / API 增量变更的影响分析与同步 |
| `/workflow status` | 共享运行时 | 查看当前进度、阻塞点与下一步建议 |
| `/workflow archive` | 共享运行时 | 归档已完成工作流 |

`workflow-reviewing`（两阶段审查协议）由 execute 内部在质量关卡处触发，不直接暴露为命令。

### 专项 Skills

| Skill | 功能 |
|-------|------|
| `scan` | 扫描项目技术栈并生成项目配置 |
| `analyze` | Codex 技术分析 + Claude 前端分析，交叉验证 |
| `fix-bug` | 结构化定位与修复单点问题 |
| `diff-review` | Quick / Deep 模式代码审查 |
| `write-tests` | 补齐单元测试 / 集成测试 |
| `bug-batch` | 批量缺陷分析、去重与修复编排 |
| `figma-ui` | Figma 设计稿到代码 |
| `visual-diff` | 像素级和语义级视觉对比 |
| `dispatching-parallel-agents` | 对同阶段 2+ 独立任务做并行子 Agent 分派 |
| `collaborating-with-codex` | 通过 Codex App Server 运行时委派编码、调试与审查任务 |

---

## workflow 的当前模型

当前 `workflow` 采用"**command 入口 + 4 个专项 workflow skills + 共享运行时**"的模块化结构：

```text
templates/
├── commands/workflow.md              # 统一 command 入口（路由层）
├── skills/
│   ├── workflow-planning/            # /workflow start
│   ├── workflow-executing/           # /workflow execute
│   ├── workflow-reviewing/           # 两阶段审查（execute 内部触发）
│   └── workflow-delta/               # /workflow delta
└── specs/
    ├── workflow-runtime/             # 状态机、共享工具、外部依赖语义
    └── workflow-templates/           # spec / plan 模板
```

在此结构下，工作流仍保持三层工件模型：
- `spec.md`：统一承载范围、架构、约束、验收标准与实施切片
- `plan.md`：可直接执行的原子步骤、文件清单与验证命令
- 执行层：按计划产出代码，并经过验证与两阶段审查

核心设计原则：

- 单一 `spec.md` 作为规划阶段的权威规范
- `plan.md` 必须可直接执行，禁止占位式描述
- `execute` 采用 budget-first governance，由 `ContextGovernor` 决定继续、暂停、并行边界或 handoff
- 质量关卡任务执行两阶段审查：先做 Spec 合规，再做代码质量

---

## 推荐安装方式

当前推荐直接克隆仓库后执行同步命令：

```bash
git clone <repo-url> claude-workflow
cd claude-workflow
npm install
npm run sync
```

如果你已经把包发布到私有 npm 仓库，也可以直接通过 `npx` 执行：

```bash
npx --yes --registry <private-registry-url> @justinfan/agent-workflow@latest sync -y
```

常用变体：

```bash
# 全局安装（默认）：会同步模板到用户目录
# Claude Code 的 Worktree hooks 也会自动注入到 ~/.claude/settings.json
npx --yes --registry <private-registry-url> @justinfan/agent-workflow@latest sync -y

# 同步到指定 Agent
npx --yes --registry <private-registry-url> @justinfan/agent-workflow@latest sync -a claude-code,cursor -y

# 项目级安装：只同步当前仓库下的模板，不会修改 ~/.claude/settings.json
npx --yes --registry <private-registry-url> @justinfan/agent-workflow@latest sync --project -y

# 从源码仓库同步
npm run sync -- -a claude-code,cursor
npm run sync -- --project
npm run sync -- -y
```

同步完成后，建议先执行：

```bash
/scan
/workflow start "需求描述"
/workflow execute
```

---

## workflow 主线命令

```bash
/workflow start "需求描述"
/workflow start docs/prd.md
/workflow start --no-discuss docs/prd.md

/workflow execute
/workflow execute --retry
/workflow execute --skip

/workflow status
/workflow status --detail

/workflow delta
/workflow delta docs/prd-v2.md
/workflow delta "新增导出功能，支持 CSV"

/workflow archive
```

含义如下：

- `start`：启动规划流程，生成 `spec.md` 与 `plan.md`
- `execute`：按 `plan.md` 推进执行，并经过验证与审查
- `status`：查看当前状态、进度与下一步建议
- `delta`：处理 PRD / API / 需求增量变更
- `archive`：归档已完成工作流

---

## 当前核心流程图

```mermaid
flowchart TD
    A["准备项目"] --> B["/scan 生成项目配置"]
    B --> C["/workflow start 输入需求"]
    C --> D["Phase 0 代码分析 + Git 检查"]
    D --> E{"是否需要澄清需求"}
    E -->|是| F["Phase 0.2 需求讨论"]
    E -->|否| G["Phase 0.3 UX 设计审批或跳过"]
    F --> G
    G --> H["Phase 1 生成 spec.md"]
    H --> I["Phase 1.1 用户确认 Spec"]
    I --> J["Phase 2 生成 plan.md + Self-Review"]
    J --> K["规划完成 Hard Stop"]
    K --> L["/workflow execute"]
    L --> M["ContextGovernor 评估预算 / 治理边界 / 并行边界"]
    M --> N["执行任务动作"]
    N --> O["Step 6.5 验证铁律"]
    O --> P["Step 6.6 自审查"]
    P --> Q["Step 6.7 Spec 合规检查"]
    Q --> R{"是否为质量关卡"}
    R -->|是| S["Stage 1 Spec 合规 → Stage 2 代码质量"]
    R -->|否| T["更新状态并进入下一步"]
    S --> T
    T --> U{"继续 / 暂停 / handoff / archive"}
    U -->|继续| M
    U -->|暂停| V["等待下次 execute"]
    U -->|handoff| W["生成 continuation artifact"]
    U -->|完成| X["/workflow archive"]
```

---

## 适用场景

优先使用 `workflow` 的场景：

- 新功能开发
- 多阶段交付
- 复杂重构
- 长 PRD 或高约束需求
- 需要显式用户确认 Spec 的任务
- 需要中断恢复、增量变更或并行子 Agent 分派的任务

如果只是单点问题，也可以直接使用专项 skill：

- 单 Bug：`/fix-bug`
- 单次审查：`/diff-review`
- 单次分析：`/analyze`
- 单次补测：`/write-tests`
- UI 还原：`/figma-ui`
- 批量缺陷：`/bug-batch`

---

## 支持的 AI 编码工具

当前支持 9 个 AI 编码工具，包括：

- Claude Code
- Cursor
- Codex
- Gemini CLI
- GitHub Copilot
- OpenCode
- Qoder
- Antigravity
- Droid

---

## 更多文档

如需查看更完整说明，可参考：

- `Claude-Code-工作流体系指南.md`
- `templates/commands/workflow.md`（统一 command 入口）
- `templates/skills/workflow-planning/SKILL.md`
- `templates/skills/workflow-executing/SKILL.md`
- `templates/skills/workflow-reviewing/SKILL.md`
- `templates/skills/workflow-delta/SKILL.md`
- `templates/specs/workflow-runtime/state-machine.md`

---

## 开发与发布

```bash
# 校验发布内容
npm run prepublishOnly

# 发布
npm run release:patch
npm run release:minor
npm run release:major
```
