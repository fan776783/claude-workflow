---
name: spec-update
description: "显式捕获学到的内容并写入 .claude/code-specs/（v2.2）。按主题写入 convention 或 contract 文件，分基础/深度更新两条路径。"
---

<PRE-FLIGHT>
**在继续之前,请用 `Read` 工具读 `core/specs/shared/pre-flight.md`**。沉淀新 convention 前不读 glossary 容易引入术语 drift(比如写成 "子 agent" 而不是 `subagent`)。
</PRE-FLIGHT>

# /spec-update

显式、用户驱动的 code-specs 沉淀入口，走交互式模式引导用户落笔。

## v2.2 核心变化

- **模板分两档**：convention（轻量必备 4 段 + 可选扩展）为主力，contract（7 段）仅用于 API/DB/字段级契约
- **基础更新 vs 深度更新**：简单追加不强制 7 段 checklist，避免沉淀成本过高
- **主题 fuzzy 匹配**：写入前查找 `{pkg}/{layer}/*.md` 相似主题，提示追加还是新建
- **6 类标签不进段落**：作为交互期语义标签，只用于"建议用哪个模板"+"正文首行 `> Type: X` 注释"
- **index.md 严格三列**：`| Guide | Description | Status |`，不加 Type 列、不做 From→To 日志

## v3 Stage C 新增

- **Step 0: 模板版本检查** — 检测 `.template-hashes.json.version` 落后于最新 manifest 时，走 `planMigration` / `applyMigration` 做显式迁移。支持链式（v5.1 → v5.2 → v5.3 连跳）与 partial failure 恢复路径。不做自动触发，必须用户在 `/spec-update` 时确认。
- **rename 后不自动修引用** — 迁移完成后 summary 会提示跑 `/spec-review` + 全仓 markdown 链接校验，旧引用由人工处理。

## 适用时机

| 触发 | 示例 | 目标 |
|------|------|------|
| 实现了新特性 | "新加了 template 下载" | `{pkg}/{layer}/{topic}.md`（7 段 code-spec） |
| 跨层协作决策 | "前后端字段命名映射表" | 对应 code-spec 的 Contracts + guides 的指针 |
| 修复了 bug | "错误处理的微妙漏洞" | 对应 code-spec 的 Validation & Error Matrix + Wrong vs Correct |
| 发现了新模式 | "更好的组织方式" | `{pkg}/{layer}/{topic}.md`（7 段） |
| 碰到 gotcha | "X 必须先于 Y" | 若是"怎么写"→ code-spec；若是"写之前想什么"→ guides |
| 建立了约定 | "命名模式统一" | `{pkg}/{layer}/conventions.md`（7 段） |

## 决策规则：convention / contract / guide

| 类型 | 位置 | 模板 | 适用内容 |
|------|------|------|---------|
| **Convention** | `{pkg}/{layer}/*.md` | `convention-template.md`（必备 4 段 + 可选扩展） | 代码风格、目录约定、命名规则、组件/模块写法 |
| **Contract** | `{pkg}/{layer}/*.md` | `code-spec-template.md`（7 段） | API 请求/响应字段、DB schema、错误码矩阵、字段级契约 |
| **Guide** | `guides/*.md` | `guide-template.md` | 思考清单（写代码前想什么），指向 convention/contract 的指针，不复述具体规则 |

问自己：

- "这是**代码风格 / 约定 / 组织**" → convention
- "这是**字段级契约 / API 契约**" → contract
- "这是**写代码前想什么**" → guide

不确定时优先 convention（轻量）；只有真正涉及严格字段契约才升到 contract。

## 模板结构

### Convention 模板（主力，必备 4 段 + 可选扩展）

基于 `core/specs/spec-templates/convention-template.md`：

**必备段**（缺任一段 → `/spec-review` 标记 missing）：

1. **Overview** — 1–2 段说明覆盖范围与存在原因
2. **Rules** — 每条 Rule 含标题 + 规则正文 + 真实代码示例 + **Why**
3. **DO / DON'T** — 正反要点清单
4. **Common Mistakes** — 至少 1 个 Bad/Good 对比 + Why it matters

**可选扩展**（按需加）：Patterns / Examples / Quick Reference / Reference Tables / Strategy / Checklist

### Contract 模板（仅字段级契约）

基于 `core/specs/spec-templates/code-spec-template.md`，7 段结构保持不变：Scope / Signatures / Contracts / Validation & Error Matrix / Good-Base-Bad Cases / Tests Required / Wrong vs Correct。  
**仅在涉及严格 API/DB/字段契约时升级到 contract**；日常约定都走 convention。

## 流程

### Step 0: 模板版本检查（v3 Stage C）

在进入 Step 1 的"基础/深度更新分流"前，先检查 code-specs 的 template 版本：

1. 读取 `.claude/code-specs/.template-hashes.json` 的 `version` 与 `migrationStatus`
2. 若 `migrationStatus === 'failed_partial'` → **立即终止**，输出恢复路径提示：
   ```
   ⚠️ 检测到上次模板迁移失败并停在 {rollbackKey} 的第 {step} 步。
   请先：
     1. 查看 .claude/code-specs/.migration-rollback.json
     2. 运行 `git diff .claude/code-specs/` 检查已修改文件
     3. 手工回退 / 补齐改动后，重跑 `/spec-update` 继续
   ```
3. 若 version 缺失（老项目）→ 视为 `pre-5.2`
4. 对比 agent-workflow 包内 `core/specs/spec-templates/manifests/` 的最新 manifest 版本：
   - version 持平 → 跳过 Step 0，进入 Step 1
   - version 落后且最新 manifest 的 `recommendMigrate === true` → 调用 `planMigration({ fromVersion, toVersion, projectRoot })`
     - `terminated === true` → 展示 reason（`unknown_baseline` / `manifest_not_published` / `chain_not_reachable`），要求用户手工指定基准或更新 agent-workflow 后重跑
     - 否则展示预览：`chain` / `apply` 条数 / `skip` 条数 / `conflicts` 条数
     - 若 `conflicts` 非空 → 默认终止（不迁移），要求用户手工清理冲突后重跑
     - 否则询问用户：`立即升级 / 跳过本次 / 查看 changelog / 终止`
       - 用户选"立即升级" → 调用 `applyMigration(plan, { projectRoot })`
         - 返回 `status === 'ok'` → 把 `.template-hashes.json.version` 更新到目标版本，继续 Step 1
         - 返回 `status === 'failed_partial'` → 把 `.template-hashes.json.migrationStatus` 写为 `failed_partial`、`version` 不改，输出 rollback 路径，终止
       - 用户选"跳过本次" → 记录一次 skip，继续 Step 1（下次仍会提示）
       - 用户选"查看 changelog" → 展示 manifest 的 `notes` / `breaking` / `migrations` 摘要后再问一次
       - 用户选"终止" → 不进 Step 1
5. **关键**：`rename` / `rename-section` 成功后不自动修 markdown 链接引用；用户在迁移完成的 summary 里会看到提示"请跑一次 `/spec-review` + 全仓链接校验，旧引用由人工处理"

### Step 1: 基础 vs 深度更新分流

先问一次：

| 路径 | 适用场景 | 流程 |
|------|---------|------|
| **基础更新** | 补一条 Rule / 加一个 Mistake / 追加一段代码 | 直接追加，只检查"有代码示例 + 有 Why + 放对文件" |
| **深度更新** | 新主题 / 重写已有主题 / 补字段契约 | 走完整 checklist：Overview/Rules/DO-DONT/Common Mistakes 都要过 |

### Step 2: 交互收集

1. **学到了什么？**（一句话）
2. **语义类别**（6 类，仅用于建议模板类型与正文注释，**不进 index 表头，不进 frontmatter**）：

   | 类别 | 建议模板 |
   |------|---------|
   | Design Decision | convention 或追加到现有 Overview |
   | Convention | convention（Rules 段） |
   | Pattern | convention + 可选 Patterns 扩展块 |
   | Forbidden | convention（DO/DON'T 的 DON'T 侧） |
   | Common Mistake | convention（Common Mistakes 段） |
   | Gotcha | convention Rules 首行 `> Gotcha: ...` 注释 |
   | （字段契约） | **contract 模板（7 段）** |

3. **位置**：哪个 package / layer？（单包项目默认推断，monorepo 列出可选）
4. **目标文件**（Step 3 fuzzy 匹配后确认）

### Step 3: 主题 fuzzy 匹配

写入前扫 `{pkg}/{layer}/*.md`：

1. 读每个文件的 H1 + Overview 首段
2. 对用户输入的主题做子串/关键词模糊匹配
3. 若命中候选：询问"追加到 `existing.md` 还是新建？"
4. 若新建：建议文件名（kebab-case，对齐已存在命名风格）

### Step 4: 写入

1. Read 目标文件避免重复
2. 按基础/深度路径执行：
   - 基础：追加到对应段，保持段内有序
   - 深度：逐段引导填充必备 4 段（或 contract 7 段）
3. 若是 Gotcha/Forbidden 等语义标签 → 正文首行加 `> Type: {类别}` 注释，便于阅读识别
4. **不**在 frontmatter 加 `spec_kind`
5. **不**在 index 表头加 Type 列

### Step 5: 副作用更新

- 更新 `{pkg}/{layer}/index.md` 的 Guidelines Index 表：
  - 新文件 → 追加一行，格式为：`| name](<filename>.md) | 描述 | Draft |`（去掉空格与占位符后即可直接使用）
  - 表头严格三列（Guide / Description / Status）
  - Status 合法值：`Not Started / Draft / Done`
- 更新 `local.md` 的 Changelog 追加一行
- 不再维护 local.md 的 Template Baseline 表（已切到 `.template-hashes.json`）

## 质量检查（写入前）

### 基础更新
- [ ] 内容包含真实代码示例（非抽象描述）
- [ ] 有 Why 说明
- [ ] 放对了文件（convention vs contract vs guide）
- [ ] 不重复已有内容

### 深度更新（convention）
- [ ] Overview / Rules / DO-DONT / Common Mistakes 4 段都有内容
- [ ] Rules 每条含代码示例 + Why
- [ ] Common Mistakes 至少 1 对 Bad/Good
- [ ] `{pkg}/{layer}/index.md` 的 Status 已更新

### 深度更新（contract）
- [ ] 7 段都有具体内容（非占位符/非抽象描述）
- [ ] Signatures 含具体文件路径
- [ ] Contracts 是字段级清单
- [ ] Tests Required 指向具体测试文件和 test case
- [ ] Wrong vs Correct 至少一对对比

## 用法

```
/spec-update             # 交互式走完整流程
```

## 与其他命令的关系

- 执行前建议先 `/spec-bootstrap` 确保骨架存在
- 写入后建议 `/spec-review` 跑一次 7 段 lint，确认所有段都填充完整
- 不再有机读规则 / 硬卡口；约束靠 code-spec 的声明式内容 + review 阶段的人工对照
