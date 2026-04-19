---
name: knowledge-before-dev
description: "动手写代码前显式读一遍当前 package/layer 的 knowledge 检查清单。触发条件：用户调用 /knowledge-before-dev，或刚切换到某个 package/layer 准备开始实现时主动调用。对齐 Trellis `$before-dev`，把 index.md 的 Pre-Development Checklist 展开成一次具体的阅读动作，而不是依赖 hook 里的 advisory 摘要。"
---

# /knowledge-before-dev

> 本 skill 是"动手前显式读一遍"的入口。与 hook 注入的 `<project-knowledge role="advisory">` 互为补充：hook 给概览，本命令给**按 package/layer 展开后的具体指针**。

## 定位区分

| 知识入口 | 定位 | 何时生效 |
|---------|------|---------|
| `session-start` hook | `overview`：会话开始时的全树概览（收紧预算） | 每次会话启动 |
| `pre-execute` hook | `scoped context`：按 active task 的 package 注入 | 每次派发 Task 工具 |
| `/knowledge-before-dev` | `explicit digest`：主动按 package/layer 展开 checklist | 用户显式调用 |

## 流程（主任务直接执行，只读）

### Step 1. 解析作用域

参数解析顺序（对齐 `resolveActiveKnowledgeScope`）：

1. `--package <name>` 显式指定
2. 当前活动 task 的 `Package` 字段（通过 `getCurrentTask(runtime).package`）
3. 项目配置推断的单包名：`project-config.json.project.name` → `package.json#name` → 仓库目录名
4. 以上都拿不到 → 输出一行 soft-fail 提示并退出（**不报错**）：
   ```
   ⚠️ 无法自动解析 package，请用 --package <name> 指定。
   ```

若 monorepo 下没有 active task → 优先提示用户加 `--package`，不要擅自挑一个包。

### Step 2. 旧布局检测（soft warning）

若检测到 `.claude/knowledge/frontend/` 或 `.claude/knowledge/backend/` 这种**顶层 layer** 目录（旧版布局），输出一行：

```
⚠️ 检测到旧布局 .claude/knowledge/{frontend,backend}/。本命令按 {pkg}/{layer}/ 二维布局设计；
   如需切换请参考 /knowledge-bootstrap --reset。本次仍按现有结构尽力读取。
```

不阻断，继续往下走。

### Step 3. 读 layer index

若 `--layer` 指定 → 只读该 layer。
若未指定 → 读该 package 下所有已存在的 layer（通常是 frontend / backend），**单包单层任务会读到两份，这是预期行为**。

```
.claude/knowledge/{package}/{layer}/index.md
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
- 所有读取受 `safeReadKnowledge` 的符号链接拒绝与 `.claude/knowledge/` 前缀保护

### Step 6. 读 guides（按 trigger 匹配）

读 `.claude/knowledge/guides/index.md`，解析 `## Thinking Triggers` 段。

- 若 `--change-type` 给出 → 用它与 trigger 描述做子串匹配；匹配到的 guide 走同样的 fallback 链读取正文（见下）
- 若未给出 → **只列出所有 trigger**，不自动挑 guide。这是刻意设计，避免"随机命中"导致用户感知不一致

**guide fallback 读取链**（按顺序取第一个存在的）：

1. 项目内：`.claude/knowledge/guides/<name>.md`
2. 仓库内置：`core/specs/guides/<name>.md`（仓库已随包分发 `cross-layer-checklist.md` / `code-reuse-checklist.md` / `ai-review-false-positive-guide.md`）
3. 都没有 → 只列出 checklist 文本，不读正文

### Step 7. 输出 inline digest

```
📚 knowledge-before-dev digest
Scope: {pkg}/{layer(s)}（来源: {source}）

Read (pre-dev checklist):
  - {pkg}/{layer}/index.md
  - {pkg}/{layer}/error-handling.md
  - {pkg}/{layer}/conventions.md

Read (thinking guides):
  - guides/cross-layer-checklist.md (matched: change-type=cross-layer)

Triggers available (no change-type given):
  - cross-layer
  - reuse
  - cross-platform

Checklist items with NO pointer (review manually):
  - 'Trace read flow: DB → Service → API → UI'

Files skipped (not found):
  - {pkg}/{layer}/migration-guide.md (listed in checklist but missing)

Notes:
  - 预算 {used}/4096 字符
  - 如果切换 package/layer，建议重新运行本命令
```

## 非交互行为

- `CLAUDE_NON_INTERACTIVE=1`：仍输出 digest，但不向用户追问（例如 soft-fail 时只打一行提示就退出）
- `--quiet`：压缩 digest，只输出已读文件列表 + 预算信息

## 参数契约速查

| 参数 | 必需 | 行为 |
|------|------|------|
| `--package <name>` | 否 | 显式覆盖 scope |
| `--layer <frontend\|backend>` | 否 | 省略 = 读该 package 下所有已存在 layer |
| `--change-type <name>` | 否 | 有值才匹配 guide；无值只列 trigger |
| `--quiet` | 否 | 精简输出 |

## 与 Change 1 的关系

本 skill 复用 `resolveActiveKnowledgeScope(runtime, projectConfig, { package: flag.package })`。若 Change 1 的 resolver 尚未合并，在本 skill 内临时实现一个等价 fallback：`--package` → `getCurrentTask(runtime)?.package` → `project.name` → `package.json#name` → `basename(root)`。两种实现行为应保持一致，Change 1 合并后切回统一 helper。

## 与其他命令

- `/knowledge-bootstrap` 建立骨架后，本命令才能真正读到内容
- `/knowledge-update` 完成一次沉淀后，下次运行本命令即可读到新增条目
- 本命令不消耗任何预算，不写入状态文件
