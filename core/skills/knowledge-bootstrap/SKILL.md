---
name: knowledge-bootstrap
description: "初始化项目级 knowledge 目录骨架。触发条件：用户调用 /knowledge-bootstrap，或 /scan 在检测到未初始化时引导调用。根据 project-config.json 的 tech.frameworks 生成 frontend/backend/guides 的 index，并创建 local.md 记录模板基线。"
---

# /knowledge-bootstrap

用于在项目中建立 `.claude/knowledge/` 的初始骨架，对应 Trellis 的 meta + local 双层思路。

## 职责

- 生成根 `index.md` 与涉及层的 `{layer}/index.md`
- 创建 `local.md`（记录 canonical 模板基线、本项目裁剪、Changelog）
- 更新 `project-config.json` 的 `knowledge.bootstrapStatus`
- 不负责填充具体 code-spec（那是 `/knowledge-update` 的职责）

## 流程

1. 读取 `.claude/config/project-config.json`，取 `tech.frameworks`
2. 若无配置，提示用户先执行 `/scan --init`
3. 根据 framework 分类：
   - 前端框架 → 生成 `frontend/`
   - 后端框架 → 生成 `backend/`
   - guides 始终生成
4. 调用 CLI：
   ```bash
   node ~/.agents/agent-workflow/core/utils/workflow/knowledge_bootstrap.js init \
     --project-root "$(pwd)" \
     --frameworks "react,express"
   ```
5. 告知用户下一步：
   - `/knowledge-update` 捕获第一条规范
   - review & git commit 生成的骨架

## 用法

```
/knowledge-bootstrap              # 基于 project-config 自动判断分层
/knowledge-bootstrap --force      # 即使没有检测到框架，也生成 frontend + backend（适用于自定义栈）
```

## 与其他命令的关系

- `/scan` 在检测到未初始化时会引导调用本命令，或用户选择跳过（`bootstrapStatus: "skipped"`）
- `/knowledge-update` 在第一次写入 code-spec 时会要求骨架已存在
- `/knowledge-review` 检查骨架完整性和模板升级差异

## 注意

- 本命令**幂等**：已存在的文件不会被覆盖
- 若 `.claude/knowledge/` 已被用户手动创建，本命令仅补齐缺失文件
