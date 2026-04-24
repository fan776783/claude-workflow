---
name: spec-before-dev
description: "动手写代码前显式读一遍当前 package/layer 的 code-specs 检查清单。触发条件：用户调用 /spec-before-dev，或刚切换到某个 package/layer 准备开始实现时主动调用。把 index.md 的 Pre-Development Checklist 展开成一次具体的阅读动作，而不是依赖 hook 里的 advisory 摘要。"
---

# /spec-before-dev

> 本 skill 是"动手前显式读一遍"的入口。与 hook 注入的 `<project-code-specs role="advisory">` 互为补充：hook 给概览，本命令给**按 package/layer 展开后的具体指针**。

## 定位区分

| 知识入口 | 定位 | 何时生效 |
|---------|------|---------|
| `session-start` hook | `overview`：会话开始时的全树概览（收紧预算） | 每次会话启动 |
| `pre-execute` hook | `scoped context`：按 active task 的 package 注入 | 每次派发 Task 工具 |
| `/spec-before-dev` | `explicit digest`：主动按 package/layer 展开 checklist | 用户显式调用 |

## 流程（主任务直接执行，只读）

### Step 1. 解析作用域

参数解析顺序（对齐 `resolveActiveCodeSpecsScope`）：

1. `--package <name>` 显式指定
2. `codeSpecs.runtime.scope`（v3 Stage A3 新加）
   - `"active_task"` → 有 task 时等价 task.package；无 task 时返回 `scopeDenied`
   - `["pkg-a", "pkg-b"]` allowlist → task.package 命中才认可；未命中返回 `scopeDenied`
3. 当前活动 task 的 `Package` 字段（通过 `getCurrentTask(runtime).package`）
4. 项目配置推断的单包名：`project-config.json.project.name` → `package.json#name` → 仓库目录名
5. 以上都拿不到 → 输出一行 soft-fail 提示并退出（**不报错**）：
   ```
   ⚠️ 无法自动解析 package，请用 --package <name> 指定。
   ```

**scopeDenied 行为**：收到 `scopeDenied: true` 时不自动回退全树；本 skill 输出一行提示 + paths-only 清单（调用 `collectSpecFiles` + `renderSpecFiles({ mode: 'paths-only' })`），等用户显式加 `--package` 再展开。

若 monorepo 下没有 active task → 优先提示用户加 `--package`，不要擅自挑一个包。

### Step 1.5. 解析 layer（v2.2 运行期动态发现）

layer 解析走 `resolveLayersForRuntime({ baseDir, pkg, layersHint })`（来自 spec_bootstrap.js 的导出），优先级：

1. 扫描真实目录 `.claude/code-specs/{pkg}/*/index.md` → 取所有含 index 的子目录作为 layer
2. `project-config.json.codeSpecs.runtime.layersHint[pkg]`（配置显式提示）
3. 返回空 + soft warning → 提示用户 `--layer`

**不再**硬编码 frontend/backend；也**不**回退到 bootstrap 期的 frameworks 推断（runtime 以真实目录为准）。

### Step 2. 旧布局检测（soft warning）

若检测到 `.claude/code-specs/frontend/` 或 `.claude/code-specs/backend/` 这种**顶层 layer** 目录（旧版布局），输出一行：

```
⚠️ 检测到旧布局 .claude/code-specs/{frontend,backend}/。本命令按 {pkg}/{layer}/ 二维布局设计；
   如需切换请参考 /spec-bootstrap --reset。本次仍按现有结构尽力读取。
```

不阻断，继续往下走。

### Step 3. 读 layer index

若 `--layer` 指定 → 只读该 layer。
若未指定 → 用 Step 1.5 的 `resolveLayersForRuntime` 结果，读该 package 下所有实际存在的 layer（可能是 frontend / backend / unit-test / docs 等，取决于项目布局）。

```
.claude/code-specs/{package}/{layer}/index.md
```

读完后从每份 index 的 `## Pre-Development Checklist` 段解析条目。

### Step 4. 解析 checklist 的文件指针

checklist 条目可能含以下三种指针之一：

checklist 条目里允许以下任意一种指针写法（均会被解析，示例中用 `{file}.md` 占位避免被视为仓库内链接）：

```
- [x] 读 {file}.md                             # 纯文件名
- [x] 读 ./{file}.md                           # 相对路径
- [x] 读 ../../guides/{file}.md                # 跨目录相对路径
- [x] 读 `{file}.md`                           # 反引号
- [x] 读 (label)({file}.md)                    # markdown 链接（示意）
- [x] 读 (label)(./{file}.md)                  # markdown 链接 + 相对路径（示意）
```

解析规则：

- 三种形式都接受
- 支持 `./`、`../`、裸文件名
- 没有 `.md` 指针的条目视为"思考类"bullet（例如 "Trace read flow: DB → Service → API → UI"），单独归入 **Checklist items with NO pointer** 区域展示
- 指向不存在的文件 → 归入 **Files skipped** 区域

### Step 5. 读取目标文件（预算约束）

- 单文件上限 **200 行**
- 本次命令总预算 **4096 字符**
- 超预算时优先保留 layer index + checklist 内的前 N 个文件，剩余的只列出路径不读正文
- 所有读取受 `safeReadCodeSpecs` 的符号链接拒绝与 `.claude/code-specs/` 前缀保护

### Step 5.5. 主动扫 Common Mistakes

对 Step 5 读过的每个 convention/contract 文件，抽取 **Common Mistakes** 段下各 H3 子标题（convention-template 规定 H3 是反例的具体语义名，例如 `### Missing Why Comment`），注入 digest 的专门区域（见 Step 7 `Active Common Mistakes`）。

抽取与配额规则：

- 每条输出一行：`{文件名} § {H3 子标题}`；不复制 Bad/Good 代码块或 Why 正文，避免重复 Rules 段已读的内容
- 单文件最多抽 5 条，按文件内出现顺序从上到下取前 5
- 多文件配额采用轮询填充：第一轮每个文件抽第 1 条，第二轮每个文件抽第 2 条，以此类推，直到总数达到 10 条或所有文件穷尽；**不按"最新/最旧"排序**，spec 文件本身没有时间戳
- 命中预算上限（digest 总 4096 字符）时该区域退化为"文件名 + 条数"一行，不展开具体标题
- 文件缺少 `## Common Mistakes` 段 → 该文件跳过，不报错
- 本 package/layer 全部文件都无 Common Mistakes → 该区域整体省略，不输出空段

用意：不是再读一遍规则，而是让"即将写代码的人"先看一眼"本层踩过什么坑"。

### Step 6. 读 guides（按 trigger 匹配）

读 `.claude/code-specs/guides/index.md`，解析 `## Thinking Triggers` 段。

- 若 `--change-type` 给出：
  - **v3 Stage A2：先做 Task Profile 精确匹配（优先级高于 trigger 子串）**。若 `{pkg}/{layer}/index.md` 含 `## Task Profiles` 段：
    1. 把 `--change-type` 做大小写 + 连字符归一（`new-feature` / `New Feature` → `new-feature`）
    2. 查各 Profile 的 slug 和 aliases 做**精确匹配**（不再用子串 fuzzy 决定命中）
    3. 命中 → 只展开该 Profile 里"必读 + 可选"的 guideline 文件；checklist 其余条目归入 `Checklist skipped (profile filter)`
    4. 未命中 → 输出一行候选提示（例："did you mean: 性能优化 (slug: performance)?"），并退回全读
  - 再按 trigger 描述做子串匹配（命中 → guide fallback 链读取）
  - 再按 `{pkg}/*/index.md` 的 Guidelines Index 表做**主题名模糊匹配**（例如 `--change-type error-handling` 命中 `error-handling.md` / `logging-guidelines.md`），命中的主题文件额外读取（受预算约束）
- 若未给出 → 只列出所有 trigger + 所有可用 Profile slug，不自动挑 guide

**v2.2 废弃**：不再维护 `core/specs/spec-templates/change-type-map.json` 权威映射表。
**v3 新规则**：Task Profile 走 slug + aliases 精确归一化匹配；fuzzy 仅用于"未命中时的候选提示"，不直接决定命中。

**guide fallback 读取链**（按顺序取第一个存在的）：

1. 项目内：`.claude/code-specs/guides/<name>.md`
2. 仓库内置：`core/specs/guides/<name>.md`（仓库已随包分发 `cross-layer-checklist.md` / `code-reuse-checklist.md` / `ai-review-false-positive-guide.md`）
3. 都没有 → 只列出 checklist 文本，不读正文

### Step 7. 输出 inline digest

```
📚 spec-before-dev digest
Scope: {pkg}/{layer(s)}（来源: {source}）
Profile: 新增功能 (slug: add-feature, matched from --change-type=new-feature)
  必读: component-guidelines, directory-structure
  可选: -

Read (pre-dev checklist):
  - {pkg}/{layer}/index.md
  - {pkg}/{layer}/component-guidelines.md
  - {pkg}/{layer}/directory-structure.md

Active Common Mistakes（本层已记录的坑）:
  - component-guidelines.md § Missing Error Boundary
  - component-guidelines.md § Inline Store Mutation
  - directory-structure.md § Cross-Layer Types In Utils

Read (thinking guides):
  - guides/cross-layer-checklist.md (matched: change-type=cross-layer)

Triggers available (no change-type given):
  - cross-layer
  - reuse
  - cross-platform

Available profiles (未给 --change-type 时可选): add-feature, bug-fix, refactor

Checklist items with NO pointer (review manually):
  - 'Trace read flow: DB → Service → API → UI'

Checklist skipped (profile filter):
  - error-handling.md (不在 add-feature profile 的必读/可选里)

Files skipped (not found):
  - {pkg}/{layer}/migration-guide.md (listed in checklist but missing)

Notes:
  - 预算 {used}/4096 字符
  - 如果切换 package/layer，建议重新运行本命令
```

若 `--change-type` 未命中任何 slug / alias：

```
⚠️ change-type 'perf' 未命中本层 Task Profile
  did you mean: 性能优化 (slug: performance)?
  available slugs: add-feature, bug-fix, performance, refactor
（本次按全量 checklist 展开）
```

若 scope 返回 scopeDenied（runtime.scope 未命中当前任务）：

```
⚠️ codeSpecs.runtime.scope 未命中：{reason}
本次仅列出 scope 内可用路径，不展开内容。如需展开请显式加 --package <name>。

{paths-only 清单}
```

## 非交互行为

- `CLAUDE_NON_INTERACTIVE=1`：仍输出 digest，但不向用户追问（例如 soft-fail 时只打一行提示就退出）
- `--quiet`：压缩 digest，只输出已读文件列表 + 预算信息

## 参数契约速查

| 参数 | 必需 | 行为 |
|------|------|------|
| `--package <name>` | 否 | 显式覆盖 scope（最高优先级，可绕过 runtime.scope） |
| `--layer <frontend\|backend>` | 否 | 省略 = 读该 package 下所有已存在 layer |
| `--change-type <name>` | 否 | Task Profile slug / alias 精确匹配；未命中输出候选提示后退回全读 |
| `--quiet` | 否 | 精简输出 |

### Config 优先级表（v3 Stage A3）

| 来源 | 字段 | 优先级 |
|------|------|--------|
| flag | `--package <name>` | 1（最高） |
| project-config.json | `codeSpecs.runtime.scope` | 2 |
| workflow state | active task 的 `package` 字段 | 3 |
| project-config.json | `project.name` | 4 |
| package.json | `name`（去 scope 前缀） | 5 |
| repo 目录名 | `basename(projectRoot)` | 6（最低） |

`runtime.scope` 未命中时返回 `scopeDenied`，不自动回退到优先级更低的来源。

## 与 Change 1 的关系

本 skill 复用 `resolveActiveCodeSpecsScope(runtime, projectConfig, { package: flag.package })`。若 Change 1 的 resolver 尚未合并，在本 skill 内临时实现一个等价 fallback：`--package` → `getCurrentTask(runtime)?.package` → `project.name` → `package.json#name` → `basename(root)`。两种实现行为应保持一致，Change 1 合并后切回统一 helper。

## 与其他命令

- `/spec-bootstrap` 建立骨架后，本命令才能真正读到内容
- `/spec-update` 完成一次沉淀后，下次运行本命令即可读到新增条目
- 本命令不消耗任何预算，不写入状态文件
