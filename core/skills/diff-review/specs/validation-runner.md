# Validation Runner 规范

> 为 `diff-review` 提供可选的项目级自动验证能力。

## 何时读取

- `diff-review` 的 Quick / Deep / PR 模式在 Severity Calibration 后、Report Synthesis 前

## 执行条件

- 可选执行：模型根据变更内容判断是否有价值
- 若变更仅涉及文档/注释/配置，可跳过

## 项目类型检测

按以下优先级检测：

| 检测依据                                   | 项目类型                                       |
| ------------------------------------------ | ---------------------------------------------- |
| `project-config.json` 存在                 | 读取 `tech.packageManager` 和 `tech.buildTool` |
| `package.json` 存在                        | Node.js / TypeScript                           |
| `Cargo.toml` 存在                          | Rust                                           |
| `go.mod` 存在                              | Go                                             |
| `pyproject.toml` / `requirements.txt` 存在 | Python                                         |

## 命令映射

| 项目类型 | Type Check         | Lint           | Test            | Build            |
| -------- | ------------------ | -------------- | --------------- | ---------------- |
| Node/TS  | `npx tsc --noEmit` | `npm run lint` | `npm test`      | `npm run build`  |
| Rust     | —                  | `cargo clippy` | `cargo test`    | `cargo build`    |
| Go       | —                  | `go vet ./...` | `go test ./...` | `go build ./...` |
| Python   | —                  | `ruff check .` | `pytest`        | —                |

优先使用 `package.json` scripts 中已定义的命令。

## 执行策略

- 每个命令**独立运行**，记录 pass/fail
- 单项失败**不阻断**整个审查
- 超时限制：单个命令最多 60 秒

## 报告集成

在 report-schema Summary 新增：

| Field      | Required | 说明                           |
| ---------- | -------- | ------------------------------ |
| Validation | optional | `pass` / `partial` / `skipped` |

Findings 之后可新增 `## Validation Results` section：

```markdown
## Validation Results

| Check      | Status        | Notes        |
| ---------- | ------------- | ------------ |
| Type Check | ✅ Pass       | 0 errors     |
| Lint       | ⚠️ 3 warnings | non-blocking |
| Tests      | ✅ Pass       | 42 passed    |
| Build      | ✅ Pass       |              |
```
