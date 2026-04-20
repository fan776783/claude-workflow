# spec skills 跟进 Trellis 0.5beta 方案（P1 + P2）

> 基于 2026-04-20 对 Trellis 0.5beta 的对照分析。v2.2 已把写作规范层（convention / contract / index 三列 / 模板漂移治理）对齐到位，本次只处理剩下两件仍值得跟升级的事。
> 目标：让 claude-workflow 自己升版时用户有迁移路径，以及让 spec-before-dev 的读量随任务类型自然收窄。

## 来源（why 这份方案）

- `.claude/plans/spec-skills-trellis-alignment-v2.2.plan.md` 已验证完成，reelmate 端到端 bootstrap 路线走通
- Trellis 0.5beta 大动在命令/Hook/迁移体系，不在 spec 写作规范层，绝大部分不需要跟升级
- 但两件事值得补齐：**模板自升级机制**（Trellis 有 manifest + hash 保护，本仓只有 hash 对账没有迁移）、**按任务类型收窄预读范围**（Trellis `cli/backend/index.md` 已按任务分流，本仓 `spec-before-dev` 把整个 layer checklist 全读一遍）

v2.2 plan 里 P3（Platform/Tooling 维度）暂不纳入，等真实场景出现再议。

---

## P1：spec-update 接入模板迁移 manifest

### 现状

- `core/specs/spec-templates/manifests/v5.1.0.json` / `v5.2.0.json` 都是空壳（`migrations: []`、`breaking: []`、`protected_paths: []`）
- `.template-hashes.json` 由 bootstrap 写入，只用作漂移**检测**依据（`spec-review` 读它对账）
- 没有"检测到漂移 → 应用 migration → 写回新 hash"的闭环
- 结果：本仓 v5.3 把 `convention-template.md` 的 `## Rules` 改成 `## Guidelines` 时，老项目没有官方升级路径，只能人工 diff

### 方案

**A. 扩充 manifest schema，贴 Trellis 的四种操作**

`core/specs/spec-templates/manifests/{version}.json` 扩展为：

```json
{
  "version": "5.3.0",
  "previous": "5.2.0",
  "recommendMigrate": true,
  "migrations": [
    {
      "type": "rename-section",
      "file": "convention-template.md",
      "from": "## Rules",
      "to": "## Guidelines",
      "reason": "对齐 Trellis style-guide.md:45 命名"
    },
    {
      "type": "rename",
      "from": ".claude/code-specs/{pkg}/{layer}/conventions.md",
      "to": ".claude/code-specs/{pkg}/{layer}/coding-conventions.md",
      "reason": "5.3 起所有 convention 文件加明确前缀，避免和 7 段 contract 混淆"
    },
    {
      "type": "safe-file-delete",
      "path": ".claude/code-specs/{pkg}/local-changelog.md",
      "guard": { "hashBefore": "sha256:..." },
      "reason": "已并入 local.md 的 Changelog 段"
    },
    {
      "type": "delete",
      "path": ".claude/code-specs/.template-baseline.json",
      "reason": "已被 .template-hashes.json 取代（v2.2）"
    }
  ],
  "protected_paths": [
    ".claude/code-specs/{pkg}/{layer}/*.md"
  ]
}
```

四种操作沿用 Trellis 语义：

| 操作 | 行为 | 对用户改过的文件 |
|------|------|------------------|
| `rename` | 路径改名 / 目录改名（合并为一类，用 glob 区分） | 直接改，不校验 hash |
| `rename-section` | 在 convention/contract 文件内替换 H2 标题文本 | 全量替换，不碰段内正文 |
| `safe-file-delete` | 删除旧文件 | `guard.hashBefore` 与实际 sha256 不一致 → skip + 保留 + warning |
| `delete` | 无条件删 | 用户改过也删（仅限 claude-workflow 自产、用户不该动的路径） |

`protected_paths` 列出"一律走 safe 模式"的路径 glob，避免粗心写 `delete` 伤到用户内容。

**B. 新建 `core/utils/workflow/spec_migrate.js`**

对外导出两个入口：

- `planMigration({ fromVersion, toVersion, projectRoot })` → 返回 `{ apply: [...], skip: [...], conflicts: [...] }`（不写文件）
- `applyMigration(plan, projectRoot)` → 真正写，结束后更新 `.template-hashes.json` 的 `version` 字段

`apply` / `skip` / `conflicts` 分流：

- `apply`：hash 对得上（或 `type !== safe-file-delete`）、文件存在 → 可以执行
- `skip`：safe-file-delete 且用户改过 → 跳过并写入 `.claude/code-specs/.migration-skipped.json`（含原因 + 原 hash + 当前 hash）
- `conflicts`：rename 的目标路径已存在且内容不是期望值 → 标冲突，让用户人工决定

**C. spec-update skill 增一段"模板升级"交互路径**

在 SKILL.md 当前 Step 1（基础 vs 深度更新分流）之前加一段：

```md
### Step 0: 模板版本检查（若 hashes 文件记录的版本 < 当前 canonical）

1. 读 .claude/code-specs/.template-hashes.json 的 version 字段
2. 对比 ~/.agents/agent-workflow/core/specs/spec-templates/manifests/ 下最新 manifest
3. 若落后且 recommendMigrate = true：
   - 提示"检测到模板升级：{from} → {to}，{n} 项变更"
   - 展示 planMigration 的 apply/skip/conflicts 预览
   - 询问"立即升级 / 跳过 / 查看 changelog"
   - 用户同意 → applyMigration，之后照常走基础/深度更新
4. 无落后 → 跳过，直接进 Step 1
```

**D. 回填首份真实 manifest**

`manifests/v5.2.0.json` 补上 v5.1 → v5.2 的真实变化（基于 v2.2 plan 实际改动）：

- `rename-section`：`code-spec-template.md` 内无实际段名变化，空
- `delete`：`.claude/code-specs/local.md` 的 `## Template Baseline` 段（单纯从 local.md 删段，**新增一种 `delete-section`** 操作）
- `protected_paths`：`.claude/code-specs/{pkg}/{layer}/*.md`

回填的目的是让"首次从空 hashes.json 升到 5.2.0"的老项目（v2.2 以前 bootstrap 的）能跑一次迁移，不必手工清理。

### 影响文件

- `core/utils/workflow/spec_migrate.js`（新建，约 200 行）
- `core/specs/spec-templates/manifests/v5.1.0.json` / `v5.2.0.json`（回填真实 migrations）
- `core/specs/spec-templates/manifests/README.md`（新建，说明 schema 与四种操作语义）
- `core/skills/spec-update/SKILL.md`（加 Step 0）
- `core/skills/spec-review/SKILL.md`（漂移 lint 命中时建议走 /spec-update 触发迁移）
- `core/utils/workflow/spec_bootstrap.js`（写 hashes 时附带当前 version，保持格式兼容）

### 兼容性

- 无 `version` 字段的旧 `.template-hashes.json` → 视为 5.2.0 baseline，首次迁移按"从 5.2.0 起"处理
- 没装最新 agent-workflow 的项目 → 读不到新 manifest，静默跳过 Step 0
- `delete` / `safe-file-delete` 只操作 `.claude/code-specs/.template-hashes.json` 记录为系统文件的路径；用户自己写的 `{pkg}/{layer}/*.md` 由 `protected_paths` 兜底一律走 safe

### 不做的

- **不做 3-way merge**：用户改过的 convention/contract 文件不自动合并新模板段落，只由 `protected_paths` 保护跳过，提示手工对照
- **不做自动触发**：迁移必须由用户显式走 `/spec-update`（或将来单独加 `/spec-migrate`），不挂在 session-start hook 里
- **不做降级**：manifest 只支持版本号单调向前

---

## P2：spec-before-dev 按任务类型收窄预读范围

### 现状

`spec-before-dev` Step 3 读完 `{pkg}/{layer}/index.md` 后，把整段 `## Pre-Development Checklist` 的所有条目都展开读。`--change-type` 只影响 Step 6（匹配 guide），不影响 checklist 自身的过滤。

在 Trellis `cli/backend/index.md` 的实际用法里，checklist 已按任务分流：

```
## Pre-Development Checklist
- 新增 CLI 命令 → directory-structure / script-conventions / error-handling
- 调试性能问题 → error-handling / logging / quality-check
- 改动公共接口 → cross-layer-checklist / code-reuse-checklist
```

本仓的 layer-index-template 目前只有单层 checklist，没有 profile 分流的位置。

### 方案

**A. layer-index-template 加一个可选段 Task Profiles**

`core/specs/spec-templates/layer-index-template.md` 在 `## Pre-Development Checklist` 下方新增可选段：

```markdown
## Task Profiles（可选）

> 按任务类型列出必读 / 可选主题。`/spec-before-dev --change-type <name>` 可按此段过滤读取范围。

| Profile | 必读 | 可选 |
|---------|------|------|
| 新增功能 | directory-structure, component-guidelines | error-handling |
| Bug 修复 | error-handling, common-mistakes | - |
| 性能优化 | logging, performance | - |
```

- Profile 名走中文（贴近用户文档实际写法），允许别名段在正文补一行
- "必读 / 可选" 两列的值是 checklist 条目里的文件主题名（不含 `.md`）
- 未写 Task Profiles 段的老 index.md → spec-before-dev 行为退回到现在的全读

**B. spec-before-dev 扩展 Step 3 / Step 4**

Step 3 读完 index.md 后多一步：

```
3a. 若 index.md 含 ## Task Profiles 段且 --change-type 给出：
    - 解析 profile 表
    - 做 fuzzy 匹配（--change-type 对 profile 名做子串 + 同义词查表）
    - 命中 → 只把"必读 + 可选"里列出的主题纳入展开集
    - checklist 里不在集内的条目归入"checklist skipped (profile filter)"
    - 未命中 → 输出所有可选 profile 名，退回全读
3b. 若无 Task Profiles 段或未给 --change-type → 走现行全读
```

同义词映射（内置一个小表，不需要用户配置）：

```js
const CHANGE_TYPE_ALIASES = {
  'add-feature': '新增功能', 'feature': '新增功能', 'new-feature': '新增功能',
  'bug-fix': 'Bug 修复', 'bugfix': 'Bug 修复', 'fix': 'Bug 修复',
  'performance': '性能优化', 'perf': '性能优化',
  'refactor': '重构', 'cleanup': '重构',
  'cross-layer': '跨层改动',
}
```

表里没有的关键词直接走 fuzzy（子串），命中不了就退回全读。

**C. 栈模板 index.md 预填常见 Profile**

- `stack-templates/vue-nuxt/frontend/index.md`：新增功能 / Bug 修复 / 样式调整 / 状态管理调整
- `stack-templates/react-next/frontend/index.md`：同上
- `stack-templates/node-express/backend/index.md`：新增 API / Bug 修复 / 性能优化 / 数据迁移
- `stack-templates/generic/*/index.md`：留 Profile 段空表 + 注释引导用户按项目写

Profile 的具体内容引用 manifest 里的 core/optional 主题名，保持内聚。

**D. 输出 digest 调整**

现在的 Step 7 digest 加一段：

```
Profile: 新增功能（matched from --change-type=add-feature）
  必读: directory-structure, component-guidelines
  可选: error-handling

Checklist skipped (profile filter):
  - logging.md
  - performance.md
```

### 影响文件

- `core/specs/spec-templates/layer-index-template.md`（加 Task Profiles 可选段）
- `core/specs/stack-templates/*/{frontend,backend}/index.md`（各栈预填 Profile）
- `core/skills/spec-before-dev/SKILL.md`（扩展 Step 3 / Step 7）
- `core/utils/workflow/spec_bootstrap.js`（若 runtime 辅助函数要集中放这里，可加一个 `resolveTaskProfile(indexContent, changeType)` 导出；不放也行，skill 侧解析足够）

### 兼容性

- Task Profiles 是可选段，老 index.md 完全不受影响
- `--change-type` 未给 → 行为与现在一致
- profile fuzzy 未命中 → 退回全读 + 提示可用 profile 列表

### 不做的

- **不自动推断任务类型**：用户必须显式给 `--change-type`，避免误判
- **不把 Profile 变成硬约束**：和 Trellis 一样是 advisory，命中 profile 外的主题也不报错
- **不做跨语言 profile 同义词大表**：只维护英中常见 6–8 条，够覆盖 90%

---

## 优先级与顺序

先 **P2 → 后 P1**：

- P2 纯加法，风险为零，立刻能改善体感，栈模板预填是最大工作量但机械
- P1 涉及文件重命名/删除语义，需要更谨慎的 dry-run 设计，花时间

如果 P1 做到一半觉得 `rename-section` / `safe-file-delete` 实现成本不值，可以先只上 `rename` + `delete` + `protected_paths`，把段级编辑留到真正需要时再补。

## 可验证指标

**P1**：

- 构造一份 `v5.3.0.json` 含每种操作各一条，模拟跑 `planMigration`：输出能正确分到 apply / skip / conflicts
- 用户改过的 convention 文件在 safe-file-delete 场景下得到保留 + warning，`.migration-skipped.json` 有记录
- 迁移完成后 `.template-hashes.json.version` 更新为新版本

**P2**：

- 在 reelmate 跑 `/spec-before-dev --change-type bug-fix`，digest 里只展开 bug-fix profile 下的文件
- 未写 Task Profiles 的老 layer 上跑相同命令，输出与现在完全一致
- `--change-type unknown-xxx` → 退回全读，并列出该 layer 所有可选 profile 名

## 与 spec-bootstrap-improvement-plan.md 的关系

两份 plan 正交：

- 那份 plan 改的是"bootstrap 产出什么骨架 / 首任务怎么写"
- 本 plan 改的是"spec 体系升版怎么迁移 / 动手前怎么按任务选读"

建议先跑完那份的 3 / 2 / 1（高 ROI 三项）再碰本 plan 的 P2，最后做 P1。两份 plan 的 7 项工作合计 3–5 天实现量。
