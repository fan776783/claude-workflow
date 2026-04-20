# Plan: spec skills 对齐 Trellis 规范 (v2.2)

## Summary

把 claude-workflow 的 4 个 spec skills（bootstrap / update / review / before-dev）+ 模板体系重构到 v2.2，对齐 live Trellis 的实际写作形态。经过 3 轮 Codex review 收敛。本 plan 覆盖 Phase 1（对齐核心）+ Phase 2（质量扩展），并以 skymediafrontend 为验证基准。

## Metadata

- **Complexity**: XL（经过 Codex 评估仍建议分批）
- **Confidence**: 6/10（架构方向已稳，但 Phase 1+2 合并后文件面较大，按 TDD 逐段落地可升到 8）
- **Estimated Files**: 20+
- **Key Risk**: spec_bootstrap.js 的运行期 / bootstrap 期 layer 解析拆分可能破坏现有 skymediafrontend 已生成骨架的兼容性
- **Upgrade Suggestion**: 若希望有状态机管理逐 Change 的进度，建议落地前切 `/workflow-plan`。本 plan 可直接作为其 input。

---

## Mandatory Reading

| Priority | File | Lines | Why |
|----------|------|-------|-----|
| P0 | `/Users/ws/dev/claude-workflow/core/utils/workflow/spec_bootstrap.js` | 1-440 | 核心改造对象，layer/package 解析、模板生成全在此 |
| P0 | `/Users/ws/dev/claude-workflow/core/skills/spec-bootstrap/SKILL.md` | 1-108 | bootstrap skill 文档 |
| P0 | `/Users/ws/dev/claude-workflow/core/skills/spec-update/SKILL.md` | 1-111 | update skill 文档（6 类映射 + From→To 需删改） |
| P0 | `/Users/ws/dev/claude-workflow/core/skills/spec-review/SKILL.md` | 1-98 | review skill 文档（新增 no-examples/no-rationale） |
| P0 | `/Users/ws/dev/claude-workflow/core/skills/spec-before-dev/SKILL.md` | 1-151 | before-dev skill 文档（runtime 动态发现） |
| P0 | `/Users/ws/dev/claude-workflow/core/specs/spec-templates/code-spec-template.md` | 1-109 | contract 模板，需去 frontmatter |
| P0 | `/Users/ws/dev/claude-workflow/core/specs/spec-templates/layer-index-template.md` | 1-38 | index 模板，需改三列 + Status |
| P0 | `/Users/ws/dev/claude-workflow/core/specs/spec-templates/local-template.md` | 1-20+ | local 模板，需重构（去 coverage/baseline，改指向 .template-hashes.json）|
| P1 | `/Users/ws/dev/Trellis/.trellis/spec/cli/backend/index.md` | 1-70 | Trellis 实物参照：三列 index 结构 |
| P1 | `/Users/ws/dev/Trellis/.trellis/spec/cli/backend/error-handling.md` | 1-380 | Trellis 实物参照：convention 段落结构 |
| P1 | `/Users/ws/dev/Trellis/.trellis/spec/docs-site/docs/style-guide.md` | 1-220 | Trellis 实物：含 Quality Checklist 扩展块 |
| P1 | `/Users/ws/dev/Trellis/.trellis/scripts/create_bootstrap.py` | 1-200 | 00-bootstrap-guidelines 任务生成逻辑 |
| P1 | `/Users/ws/dev/Trellis/.trellis/tasks/archive/2026-03/03-11-improve-break-loop-update-spec/prd.md` | 9-30 | 基础/深度更新分流依据 |
| P1 | `/Users/ws/dev/Trellis/.trellis/tasks/archive/2026-03/03-09-monorepo-spec-adapt/prd.md` | 161-219 | layer 动态发现依据 |
| P2 | `/Users/ws/dev/claude-workflow/core/specs/spec-templates/manifests/v5.2.0.json` | 1-10 | manifest 格式参照 |

---

## Patterns to Mirror

### 三列 index.md（Guidelines Index）

// SOURCE: Trellis .trellis/spec/cli/backend/index.md:15

```markdown
| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization, file layout, design decisions | Done |
| [Error Handling](./error-handling.md) | Error types, handling strategies | Done |
```

### convention 主题文件段落

// SOURCE: Trellis .trellis/spec/cli/backend/error-handling.md:7,13,45,201,223

```markdown
# Error Handling
> How errors are handled in this CLI project.

## Overview
## Error Handling Strategy        ← Strategy 为可选扩展块
## Error Patterns                  ← Patterns 为可选扩展块
## DO / DON'T
## Common Mistakes
## Examples                        ← Examples 为可选扩展块
```

### bootstrap 任务骨架（Document Reality, Not Ideals）

// SOURCE: Trellis .trellis/scripts/create_bootstrap.py:120,149,150

```markdown
Principles:
1. Document Reality, Not Ideals — 写真实存在的做法
2. 2-3 real code examples per guideline — 从本仓库挑，不要虚构
3. Anti-patterns documented — 至少一个"我们踩过的坑"
```

### 模板漂移 hash 记录

// SOURCE: Trellis .trellis/spec/cli/backend/migrations.md:128（机制参照）

```json
// .claude/code-specs/.template-hashes.json
{
  "version": "5.2.0",
  "baselines": {
    "convention-template.md": "sha256:abc...",
    "code-spec-template.md": "sha256:def...",
    "layer-index-template.md": "sha256:ghi..."
  },
  "recordedAt": "2026-04-20T..."
}
```

---

## Files to Change

### 模板（6 个）

| File | Action | Justification |
|------|--------|---------------|
| `core/specs/spec-templates/convention-template.md` | **CREATE** | v2.2 Change 2：必备 4 段 + 可选 Patterns/Examples/Quick Reference/Reference Tables/Strategy/Checklist |
| `core/specs/spec-templates/code-spec-template.md` | UPDATE | Change 3：去 frontmatter，加文件头提示"仅用于 API/DB/字段级契约" |
| `core/specs/spec-templates/layer-index-template.md` | UPDATE | Change 4(c)：Guidelines Index 改严格三列（Guide/Description/Status），去 "(To be filled)" 空表行 |
| `core/specs/spec-templates/local-template.md` | UPDATE | Change 5：去 Template Baseline 表（改由 .template-hashes.json 承载），去 coverage snapshot，保留精简 Changelog |
| `core/specs/stack-templates/vue-nuxt/frontend/index.md` | **CREATE** | Change 1(c.1) 最小 core scaffold：component-guidelines / directory-structure 两个 core 主题 |
| `core/specs/stack-templates/vue-nuxt/frontend/{component-guidelines,directory-structure}.md` | **CREATE** | 同上，各含 convention 模板必备段 |
| `core/specs/stack-templates/vue-nuxt/manifest.json` | **CREATE** | 声明 core/optional 主题清单 |
| `core/specs/stack-templates/{react-next,node-express,generic}/**` | **CREATE** | Phase 2：完整栈模板目录，各含 manifest + core 主题 |

### CLI 脚本（1 个）

| File | Action | Justification |
|------|--------|---------------|
| `core/utils/workflow/spec_bootstrap.js` | UPDATE | 重点改造：(a) `resolvePackages` 加 include/exclude 过滤 + single-pkg 自动推断；(b) 拆出 `resolveLayersForBootstrap` / `resolveLayersForRuntime`；(c) 栈模板目录加载（拷贝文件而非 render placeholder）；(d) bootstrap 完成后生成 00-bootstrap-guidelines.md；(e) 写入 `.template-hashes.json`；(f) 去掉 local.md 中的 Template Baseline 相关生成逻辑 |

### Skill 文档（4 个）

| File | Action | Justification |
|------|--------|---------------|
| `core/skills/spec-bootstrap/SKILL.md` | UPDATE | 新增 `--stack`、`--full`、`--minimal`、`--experimental-shared`；include 默认策略说明；00-bootstrap-guidelines 触发说明 |
| `core/skills/spec-update/SKILL.md` | UPDATE | 删掉"6 类硬映射到段落"表；改为基础/深度更新分流；index 表头固定三列；fuzzy 匹配主题（Phase 2） |
| `core/skills/spec-review/SKILL.md` | UPDATE | 新增 no-examples / no-rationale lint（仅必备段）；empty-layer 改 advisory；模板漂移改读 .template-hashes.json + manifests/；去 local.md 对账 |
| `core/skills/spec-before-dev/SKILL.md` | UPDATE | Step 3 layer 解析切到 `resolveLayersForRuntime`；--change-type 改成 index 表模糊匹配；废弃 change-type-map.json |

### 验证（1 个项目）

| File | Action | Justification |
|------|--------|---------------|
| `/Users/ws/dev/skymediafrontend/.claude/code-specs/` | **RESET** | T14 验证步骤：删除现有骨架后以 v2.2 重新 bootstrap |
| `/Users/ws/dev/skymediafrontend/.claude/config/project-config.json` | UPDATE | 加 `codeSpecs.packages.include: ["reelmate"]` |

---

## Tasks

### T1: 创建 convention-template.md（Change 2）

- **Action**: 新建模板文件，含必备 4 段（Overview / Rules / DO-DONT / Common Mistakes）+ 可选扩展 6 块（Patterns / Examples / Quick Reference / Reference Tables / Strategy / Checklist），每个必备段附示意提示
- **File**: `core/specs/spec-templates/convention-template.md`
- **Mirror**: Trellis error-handling.md / style-guide.md 结构
- **Verify**: `cat core/specs/spec-templates/convention-template.md | grep -E "^## "` 输出至少 4 个必备 + 标注"可选扩展"分隔注释

### T2: 改造 code-spec-template.md（Change 3）

- **Action**: 删除文件开头的 frontmatter（`---name:---` 块）；保留 H1 + 一段"仅用于 API/DB/字段级契约"提示；保留 7 段结构；段内标注"必填"文案保持不变
- **File**: `core/specs/spec-templates/code-spec-template.md`
- **Mirror**: Trellis error-handling.md:1（直接 H1 起头）
- **Verify**: `head -5 core/specs/spec-templates/code-spec-template.md` 首行是 `# {{spec_name}}`，不是 `---`

### T3: 改造 layer-index-template.md（Change 4c）

- **Action**: Guidelines Index 表头改成 `| Guide | Description | Status |`；删除占位行 `| (To be filled) | | |`；Status 合法值注释为 `Not Started / Draft / Done`
- **File**: `core/specs/spec-templates/layer-index-template.md`
- **Mirror**: Trellis cli/backend/index.md:15
- **Verify**: `grep -c "| Guide | Description | Status |" core/specs/spec-templates/layer-index-template.md` = 1

### T4: 重构 local-template.md（Change 5）

- **Action**: 删除 Template Baseline 表（改由 .template-hashes.json 承载）；删除 Topic Coverage Snapshot 若有；保留精简 Changelog；顶部说明"模板漂移治理已切到 .template-hashes.json + manifests/"
- **File**: `core/specs/spec-templates/local-template.md`
- **Verify**: `grep -c "Template Baseline" core/specs/spec-templates/local-template.md` = 0

### T5: 创建 vue-nuxt 栈模板（Change 1c.1）

- **Action**: 创建目录 `core/specs/stack-templates/vue-nuxt/`；内含 `manifest.json`（声明 core: component-guidelines / directory-structure；optional: composable-guidelines / state-management / error-handling）；`frontend/index.md`（Guidelines Index 表预填 core 主题行）；`frontend/component-guidelines.md` 与 `frontend/directory-structure.md`（各用 convention 必备 4 段）
- **File**: 新目录 5 个文件
- **Mirror**: Trellis 文档站 specs-nextjs / specs-electron / specs-cf-workers 的目录形态
- **Verify**: `ls core/specs/stack-templates/vue-nuxt/frontend/` 列出 `index.md / component-guidelines.md / directory-structure.md`

### T6: 改造 spec_bootstrap.js——packages include/exclude + single-pkg 推断（Change 1a）

- **Action**: 在 `resolvePackages` 中优先读 `config.codeSpecs.packages.include`；未设置且 `project.type !== 'monorepo'` 时自动推断单包；`exclude` 永远过滤；include 为空数组 + monorepo 时报 `packages_include_required`
- **File**: `core/utils/workflow/spec_bootstrap.js`
- **Mirror**: Trellis 03-09 PRD:186,192（single-repo fallback）
- **Verify**: 新加单测脚本（tests/spec-bootstrap-packages.test.js）或手测两种 config 场景

### T7: 改造 spec_bootstrap.js——layer 解析拆分（Change 1b）

- **Action**: 新增 `resolveLayersForBootstrap(pkg, { stack, frameworks })`（栈模板 > frameworks > `['frontend']`）与 `resolveLayersForRuntime(pkg, { baseDir })`（扫描 `{baseDir}/{pkg}/*/index.md` > `codeSpecs.runtime.layersHint[pkg]` > soft warning）；导出两个函数
- **File**: `core/utils/workflow/spec_bootstrap.js`
- **Mirror**: Trellis 03-09 PRD:161,170,219
- **Verify**: 手测 frontend-only / frontend+backend / 不存在 index.md 三种场景

### T8: 改造 spec_bootstrap.js——栈模板拷贝（Change 1c.1 / 1c.2）

- **Action**: 新增 `--stack <name>` 参数；`loadStackTemplate(name)` 读取 `core/specs/stack-templates/<name>/manifest.json`；bootstrap 时按 manifest 的 `layers[layer].core`（默认）或 `core+optional`（`--full`）或仅 index（`--minimal`）拷贝 `stack-templates/<name>/<layer>/` 下对应文件到 `.claude/code-specs/<pkg>/<layer>/`
- **File**: `core/utils/workflow/spec_bootstrap.js`
- **Mirror**: Trellis 模板目录机制
- **Verify**: 对 skymediafrontend 跑 `--stack vue-nuxt` 后 `.claude/code-specs/reelmate/frontend/` 含 3 个 core 文件

### T9: 改造 spec_bootstrap.js——00-bootstrap-guidelines 任务（Change 1d）

- **Action**: bootstrap 成功后生成 `.claude/tasks/00-bootstrap-guidelines.md`（若目录不存在则创建），内容对齐 create_bootstrap.py 原则（Document Reality / 2-3 real examples / Anti-patterns），列出本次实际生成的 core 主题文件路径，引导用户从项目代码库挑真实代码填入
- **File**: `core/utils/workflow/spec_bootstrap.js` + 新模板 `core/specs/spec-templates/bootstrap-task-template.md`
- **Mirror**: Trellis .trellis/scripts/create_bootstrap.py:3,68,120,149,150
- **Verify**: bootstrap 后存在 `.claude/tasks/00-bootstrap-guidelines.md`，内容含"Document Reality"短语与实际文件路径

### T10: 改造 spec_bootstrap.js——.template-hashes.json（Change 5 模板漂移）

- **Action**: bootstrap 完成时写入 `.claude/code-specs/.template-hashes.json`（记录本次使用的 convention-template / code-spec-template / layer-index-template 的 sha256 + 当前 canonical version）；去掉 local.md 中 Template Baseline 表的写入逻辑
- **File**: `core/utils/workflow/spec_bootstrap.js`
- **Mirror**: Trellis migrations.md:128 机制
- **Verify**: bootstrap 后存在 `.template-hashes.json`，local.md 无 Template Baseline 表

### T11: 更新 4 个 SKILL.md

- **Action**:
  - `spec-bootstrap/SKILL.md`: 加 `--stack/--full/--minimal/--experimental-shared` 参数、include 默认策略、00-task 说明
  - `spec-update/SKILL.md`: 删 6 类段落映射表；加基础/深度更新分流；index 表头固定三列；fuzzy 匹配章节
  - `spec-review/SKILL.md`: 加 no-examples / no-rationale lint 描述；empty-layer advisory；模板漂移改读 .template-hashes.json
  - `spec-before-dev/SKILL.md`: Step 3 改 `resolveLayersForRuntime`；删 change-type-map 描述；改模糊匹配 index 表
- **File**: 4 个 SKILL.md
- **Verify**: 每个 SKILL.md 的 description frontmatter 保持有效（1-2 句）；grep 确认废弃概念（From→To、spec_kind、coverage snapshot）已清除

### T12: Phase 2 扩展——其他栈模板

- **Action**: 复制 vue-nuxt 结构，创建 `react-next/` / `node-express/` / `generic/` 三个栈模板目录；各含 manifest.json（core 主题按栈特性挑 2 个）+ frontend/index.md + core 主题文件
- **File**: `core/specs/stack-templates/{react-next,node-express,generic}/**`
- **Verify**: 各目录 `manifest.json` 存在且 schema 一致

### T13: Phase 2 扩展——spec-update fuzzy 匹配 + 6 类标签

- **Action**: SKILL.md 增补一节"交互流程"描述主题 fuzzy 匹配逻辑（文件名 + 首段 Overview）；6 类标签仅用于建议模板类型 + 正文首行 `> Type: X` 注释，不进 index 表头、不进 frontmatter。此项因是 skill 文档变更，执行端由 Claude 交互实现，不需 CLI
- **File**: `core/skills/spec-update/SKILL.md`
- **Verify**: 文档 grep "fuzzy" 与 "基础更新 vs 深度更新" 各至少出现一次

### T14: 验证——skymediafrontend reset + bootstrap

- **Action**:
  1. 编辑 `/Users/ws/dev/skymediafrontend/.claude/config/project-config.json`，加 `codeSpecs.packages.include: ["reelmate"]`
  2. 跑 `node /Users/ws/dev/claude-workflow/core/utils/workflow/spec_bootstrap.js init --project-root /Users/ws/dev/skymediafrontend --frameworks "vue,nuxt" --stack vue-nuxt --reset`
  3. 人工检查：
     - `.claude/code-specs/reelmate/frontend/` 含 index.md + component-guidelines.md + directory-structure.md
     - 3 个文件都不是空占位符，含 convention 必备 4 段
     - index.md 表头是 `| Guide | Description | Status |`
     - `.claude/tasks/00-bootstrap-guidelines.md` 存在且指向 3 个真实路径
     - `.claude/code-specs/.template-hashes.json` 存在
     - `.claude/code-specs/local.md` 无 Template Baseline 表
- **Verify**: 上述 6 项人工核对全通过
- **Rollback**: 若失败，`cd /Users/ws/dev/skymediafrontend && git checkout .claude/` 还原

---

## Testing Strategy

- **模板层**：T1–T5 完成后，肉眼对照 Trellis 对应文件 diff，确认段落命名/结构不跑偏
- **CLI 层**：T6–T10 建议每个 Change 后跑一次临时测试项目（用 `/tmp/test-proj/` 建空项目），验证 package/layer/stack 三个维度
- **Skill 文档**：T11 后让 Codex 或另一个 review 跑一次，确认文档里无残留的废弃概念
- **集成**：T14 是唯一端到端验证；若失败要能定位到哪个 Change 的问题
- **回归**：现有 claude-workflow 自己的 `.claude/code-specs/`（如果存在）在升级后跑一次 `spec-review`，确认不会因为 schema 变化报错

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| spec_bootstrap.js 拆两套 resolveLayers 后，现有 skymediafrontend 骨架运行期被识别不一致 | High | T7 同步更新 before-dev / review 的调用点；增加向后兼容分支（runtime 找不到 index.md 时按 bootstrap 逻辑做 fallback） |
| 栈模板主题文件预填内容过于"Trellis 英文味"，不符合本仓库中文规范约束 | Medium | T5 落笔时明确模板正文用中文，代码示例注释用中文 |
| T9 生成的 00-bootstrap-guidelines.md 路径 `.claude/tasks/` 与项目已有 workflow task 目录冲突 | Medium | bootstrap 时先检查目录是否存在 workflow 任务文件，冲突时写入 `.claude/tasks/spec-bootstrap/00-bootstrap-guidelines.md` |
| 模板漂移切到 .template-hashes.json 后，历史项目（已有 local.md + Template Baseline）升级时信息丢失 | Medium | T10 在写入 .template-hashes.json 时自动迁移 local.md 中已有的 Template Baseline（只读不删，记 deprecated） |
| Phase 1 + Phase 2 合并后改动面大，容易出现半成品 | High | 强烈建议按 T1→T2→...→T14 顺序串行提交，每个 Task 单独 commit；或切换到 /workflow-plan 管理状态机 |
| skymediafrontend 当前已有 17 个 workspace 的空骨架，--reset 会删除所有内容 | Low | T14 第 1 步明确 git status 确认无未提交改动；`.claude/code-specs/` 先 `git add` commit 一版作为回滚点 |

---

## 与 workflow 的关系

本 plan 属于 XL 级跨模块重构，Confidence 6/10。`/quick-plan` 只负责出规划，不进入状态机。

**强烈建议下一步**：`/workflow-plan` 以本 plan 为输入，生成带状态机的 spec + tasks，分 Phase 1 / Phase 2 两个 stage 推进。`/workflow-execute` 严格按 Task 顺序执行，每个 T 通过后再推下一个。

若坚持用 `/quick-plan` + 手工执行，建议至少：
1. 先实现 T1–T4（纯模板改动，无风险）
2. 提 PR，让 Codex review 通过后再碰 T6–T10（CLI 改造）
3. T11 skill 文档更新放在 CLI 行为确认后
4. T14 验证在所有代码合并后单独跑

---

## Changelog

- 2026-04-20：基于 Codex v1 / v2 / v2.1 三轮 review 收敛到 v2.2，生成本 plan。
