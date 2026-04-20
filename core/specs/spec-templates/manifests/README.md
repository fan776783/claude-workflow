# code-specs template manifests

> 每份 `vX.Y.Z.json` 描述一次 agent-workflow 版本跳变对用户项目 `.claude/code-specs/` 骨架的影响，供 `/spec-update` 在检测到版本落后时做自动/半自动迁移。
> 第一版克制，只落地五种核心操作 + `protected_paths` 兜底；链式迁移与 partial failure 语义见 `core/utils/workflow/spec_migrate.js`。

## Schema

```json
{
  "version": "5.3.0",
  "previous": "5.2.0",
  "recommendMigrate": true,
  "notes": "一句话说明这次跳变的目的",
  "breaking": [],
  "protected_paths": [".claude/code-specs/{pkg}/{layer}/*.md"],
  "migrations": [
    // 见下方操作类型
  ],
  "changelog": "Generated from v5.2.0..HEAD"
}
```

| 字段 | 必需 | 说明 |
|------|------|------|
| `version` | 是 | 目标版本号（与文件名同步） |
| `previous` | 是 | 上一版本号（构成迁移图的 `previous → version` 边） |
| `recommendMigrate` | 是 | `true` 时 `/spec-update` 会提示用户立即迁移；`false` 静默通过版本检查 |
| `notes` / `changelog` | 否 | 展示给用户的说明 |
| `breaking` | 否 | 人类可读的重大变更点列表 |
| `protected_paths` | 否 | glob 列表；凡命中的路径一律走 safe 模式（即使操作是 `delete` 也改为 `skip`） |
| `migrations` | 是 | 按序执行的迁移操作列表 |

## 操作类型（五种 + 兜底）

### `rename`

路径改名。

```json
{ "type": "rename", "from": "oldpath.md", "to": "newpath.md", "reason": "..." }
```

### `rename-dir`

目录改名（行为与 rename 相同，仅语义区分）。

```json
{ "type": "rename-dir", "from": "olddir/", "to": "newdir/", "reason": "..." }
```

### `rename-section`

在 convention / contract 文件内部替换 H2 标题文本。**仅限不含变量替换的静态模板文件**，否则第一版一律 skip。

```json
{ "type": "rename-section", "file": "convention-template.md", "from": "## Rules", "to": "## Guidelines", "reason": "..." }
```

### `delete-section`

从指定文件中删除某个 H2 段（从 `## SectionName` 开始，到下一个 H2 或文件末尾）。同样仅限静态模板文件。

```json
{ "type": "delete-section", "file": "local.md", "section": "## Template Baseline", "reason": "..." }
```

### `safe-file-delete`

删除旧文件，但执行前对比文件 sha256 与 `guard.hashBefore`（或 `allowed_hashes` 列表）。不一致 → 视为用户改过，跳过并记录。命中 `protected_paths` 也跳过。

```json
{
  "type": "safe-file-delete",
  "path": ".claude/code-specs/{pkg}/local-changelog.md",
  "guard": { "hashBefore": "sha256:..." },
  "reason": "已并入 local.md 的 Changelog 段"
}
```

### `delete`

无条件删除，**仅限 claude-workflow 自产路径**，凡命中 `protected_paths` 的会被强制降级为 `safe-file-delete`。

```json
{ "type": "delete", "path": ".claude/code-specs/.template-baseline.json", "reason": "..." }
```

## 非目标（第一版显式不支持）

以下能力**不**在第一版 schema 中，遇到需求先手工处理或拆回单独操作：

- `copy` / `split` / `merge`：多文件重组
- `link-rewrite`：markdown 链接目标改写（rename 后，旧引用失效由用户跑 `/spec-review` + 人工修）
- `checklist-pointer-rewriting`：layer-index 里指向某主题的 checklist 条目随主题改名同步改写
- 对含变量替换文件（如 `{{pkgName}}-spec.md`）的 `safe-file-delete` 自动判定：一律视为用户内容，skip

## Hash 语义

`guard.hashBefore` / `allowed_hashes` 比对的是 **canonical template 文件**的 sha256（`core/specs/spec-templates/{file}.md` 在 agent-workflow 包内的原始内容），**不是**用户项目里渲染后的实例文件 hash。

因此 `safe-file-delete` 的"用户改过"判定只对"从未被 spec-bootstrap 渲染过变量的静态模板"可靠。变量替换过的文件应当由 `protected_paths` 兜底，不参与自动 hash 比对。

## 链式迁移

`spec_migrate.js::planMigration({ fromVersion, toVersion })` 把 `manifests/` 下所有 manifest 按 `previous → version` 组成有向图，从 `fromVersion` 走最短路径到 `toVersion`，顺序 compose 每份 manifest 的 migrations。

- `fromVersion = null / undefined`（`.template-hashes.json` 无 version 字段）→ 视为 `pre-5.2`，从已知最早 manifest 起步
- `fromVersion` 在 manifests/ 找不到 → 终止并报 "unknown baseline"
- `toVersion` 比最新 manifest 还新 → 终止并报 "manifest not published yet"

## Partial failure

`applyMigration` 按序执行；任意一步失败：

1. 立即停止
2. 已完成的步骤写入 `.claude/code-specs/.migration-rollback.json`
3. `.template-hashes.json.version` 保持原基线不更新
4. `.template-hashes.json.migrationStatus` 标记为 `failed_partial`

下次 `/spec-update` Step 0 检测到 `failed_partial` 会输出恢复路径提示，而不是重新迁移。
