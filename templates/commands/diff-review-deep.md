---
description: 深度 Diff 审查 - 基于 git diff 的多模型交叉代码审查
allowed-tools: Read(*), Grep(*), Glob(*), Bash(git *), mcp__codex__codex(*)
examples:
  - /diff-review-deep
    深度审查未提交的代码变更
  - /diff-review-deep --staged
    深度审查已暂存的变更
  - /diff-review-deep --branch main
    深度审查当前分支相对 main 的所有变更
---

# 深度 Diff 代码审查

基于 git diff 的多模型交叉审查，整合 Claude 与 Codex 双重视角。

## 与 /diff-review 的区别

| 特性 | /diff-review | /diff-review-deep |
|------|--------------|-------------------|
| 审查模型 | Claude 单独 | Claude + Codex 交叉 |
| 适用场景 | 快速日常检查 | 重要功能/PR 提交前 |
| 响应速度 | 快 | 较慢（多模型调用） |
| 审查深度 | 标准 | 深度（逻辑+安全+性能） |

## 输入格式

根据用户指定的来源获取 diff：

| 参数 | 来源 | git 命令 |
|------|------|----------|
| (默认) | 未暂存变更 | `git diff` |
| `--staged` | 已暂存变更 | `git diff --cached` |
| `--all` | 全部未提交 | `git diff HEAD` |
| `--branch <base>` | 对比分支 | `git diff <base>...HEAD` |

## 执行流程

```
┌─────────────────────────────────────────────────────────────┐
│                     Phase 1: 获取 Diff                       │
├─────────────────────────────────────────────────────────────┤
│  1. 根据参数执行 git diff 命令                                │
│  2. 解析变更文件列表和具体改动内容                             │
│  3. 若 diff 超过 8000 行，分片处理并标记截断                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Phase 2: Claude 初审                        │
├─────────────────────────────────────────────────────────────┤
│  按 /diff-review 标准进行首轮审查：                           │
│  - 代码准确性、安全性、可维护性                                │
│  - 识别本次变更引入的问题                                     │
│  - 输出初审 Findings                                         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Phase 3: Codex 交叉审查                     │
├─────────────────────────────────────────────────────────────┤
│  调用 mcp__codex__codex 进行深度审查：                        │
│  - 逻辑正确性验证                                            │
│  - 边界条件和异常处理                                         │
│  - 潜在 Bug 和安全隐患                                        │
│  - 性能与资源管理                                            │
│  - 兼容性与回归风险                                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Phase 4: 综合报告                           │
├─────────────────────────────────────────────────────────────┤
│  合并两轮审查结果：                                           │
│  - 按 P0→P3 排序，去重合并                                    │
│  - 标注问题来源（Claude/Codex/Both）                          │
│  - 生成最终 Verdict 和 Confidence                            │
└─────────────────────────────────────────────────────────────┘
```

## 审查指南

### Claude 审查重点

1. 显著影响代码的准确性、性能、安全性或可维护性
2. 问题是具体且可操作的（非泛泛的代码库问题）
3. 修复不需要超出代码库现有标准的严格程度
4. 问题是在本次变更中引入的（不是预先存在的）
5. 如果认为变更可能破坏其他部分，必须找到具体受影响的代码

### Codex 审查重点

1. **逻辑正确性**：算法实现、条件判断、循环边界
2. **异常处理**：错误传播、边界条件、空值处理
3. **安全隐患**：注入攻击、权限绕过、敏感信息泄露
4. **性能问题**：N+1 查询、内存泄漏、不必要的计算
5. **并发安全**：竞态条件、死锁风险、锁顺序、原子性
6. **资源管理**：文件句柄、连接池、事务、协程泄漏
7. **兼容性风险**：公共接口/协议/序列化格式变更的破坏面
8. **输入校验**：用户输入、反序列化、外部事件的合法性检查

### 忽略的问题

- 琐碎的风格问题（除非影响可读性或违反文档标准）
- 非阻塞问题（纯格式、拼写、文档补充）
- 预先存在的问题（非本次变更引入）

## 优先级与评分定义

### 优先级

| 级别 | 含义 | 标准 |
|------|------|------|
| P0 | 紧急阻塞 | 阻塞发布/运营，不依赖任何输入假设的普遍问题 |
| P1 | 紧急 | 应在下个周期处理 |
| P2 | 正常 | 最终需要修复 |
| P3 | 低优先级 | 有则更好 |

### 评分基准

| 分数区间 | 含义 |
|----------|------|
| 90-100 | 近乎无阻塞风险，可直接上线 |
| 70-89 | 可上线但建议修复发现的问题 |
| 50-69 | 存在明显缺陷，需要改动后再上线 |
| < 50 | 高风险，应阻塞上线 |

## Codex 调用规范

```typescript
// Phase 3: Codex 交叉审查
const codexResult = await mcp__codex__codex({
  PROMPT: `请对以下 git diff 进行深度代码审查。

## 重要约束
- **仅基于给定 diff 判断**，不要臆测未展示的代码
- 若需假设未给出的上下文，请标记为 [Uncertain] 并说明缺失信息
- 若输入被截断或不完整，先报告截断，再给出受限审查结果
- 仅评估 diff 引入的变更，避免评论未改动的代码

## 变更的文件
${modifiedFiles.join('\n')}

## Diff 内容
\`\`\`diff
${diffContent}
\`\`\`

## 审查要求

请重点关注：
1. **逻辑正确性**：算法实现是否正确，条件判断是否完备
2. **边界条件**：空值、越界、溢出等边界情况处理
3. **异常处理**：错误是否被正确捕获和传播
4. **安全隐患**：是否存在注入、权限、信息泄露等风险
5. **性能影响**：是否引入性能退化（N+1、内存泄漏、长尾延迟）
6. **并发安全**：多线程/异步场景下的状态一致性、锁顺序、原子性
7. **资源管理**：文件句柄、连接池、事务、取消与超时传播
8. **兼容性风险**：公共接口/协议/序列化格式变更是否需要迁移
9. **输入校验**：用户输入、反序列化的合法性检查

## 输出格式

### Codex 审查评分
**Score**: X/100
> 评分基准：90+=无阻塞风险 | 70-89=可上线建议修复 | 50-69=明显缺陷 | <50=高风险阻塞

### 发现的问题

按 P0→P3 优先级排序，最多列出前 10 条。对每个问题：

#### [PX] 问题标题
- **文件**: \`文件路径\`
- **行号**: start-end（基于 diff hunk 位置）
- **类型**: 逻辑错误/安全隐患/性能问题/边界条件/资源泄漏/兼容性/其他
- **触发条件**: 最小可重现路径或触发场景
- **说明**: 问题描述和影响
- **建议**: 修复建议（可选代码片段，限 3 行内）
- **[Uncertain]**: （可选）若存在不确定性，说明缺失的信息

如无发现问题，输出：**No findings from Codex review.**`,
  cd: process.cwd(),
  sandbox: "read-only"
});
```

## 输出格式

```
# Deep Review Report

## Summary
| Field | Value |
|-------|-------|
| Verdict | ✅ CORRECT / ❌ INCORRECT |
| Confidence | 0.XX |
| Claude Score | XX/100 |
| Codex Score | XX/100 |
| Codex Status | success / degraded / failed |
| Truncated | true / false |

**Explanation**: <综合两轮审查的结论>

---

## Claude Findings

> 如无发现，输出：**No findings from Claude review.**

### [PX] <标题>
| Field | Value |
|-------|-------|
| File | `<文件路径>` |
| Lines | <start>-<end> 或 <line> |
| Source | Claude |
| Severity | P0/P1/P2/P3 |
| Confidence | 0.XX |

<问题说明>

```suggestion
<可选修复代码，限 3 行>
```

---

## Codex Findings

> 如无发现，输出：**No findings from Codex review.**
> 若 Codex 调用失败，输出：**Codex review degraded: <原因>**

### [PX] <标题>
| Field | Value |
|-------|-------|
| File | `<文件路径>` |
| Lines | <start>-<end> 或 <line> |
| Source | Codex |
| Severity | P0/P1/P2/P3 |
| Type | 逻辑错误/安全隐患/性能问题/边界条件/资源泄漏/兼容性 |
| Trigger | <触发条件> |

<问题说明>

**[Uncertain]**: <若有不确定性，说明缺失信息>

```suggestion
<可选修复代码，限 3 行>
```

---

## Cross-Review Consensus

> 两个模型都发现的问题（高置信度）
> 匹配规则：同一文件 + 行号区间重叠 + 问题类型相同或标题高相似

### [PX] <标题>
| Field | Value |
|-------|-------|
| File | `<文件路径>` |
| Lines | <start>-<end> |
| Source | Both |
| Severity | P0/P1/P2/P3 |
| Confidence | 0.XX (elevated +0.15) |

<综合说明>

---

## Review Statistics
| Metric | Value |
|--------|-------|
| Files Reviewed | X |
| Lines Changed | +X / -X |
| Claude Findings | X |
| Codex Findings | X |
| Consensus Issues | X |
| Codex Call Status | success/degraded/failed |
```

## 格式规则

1. **Summary 表格**：包含双模型评分、Codex 状态、截断标记
2. **分区输出**：Claude Findings、Codex Findings、Cross-Review Consensus 三个区块
3. **优先级排序**：所有 Findings 按 P0→P3 排序输出
4. **Source 标注**：每个 Finding 标注来源（Claude/Codex/Both）
5. **Consensus 匹配**：同一文件 + 行号区间重叠 + 问题类型相同或标题高相似度
6. **Confidence 提升**：Consensus 问题的 Confidence 自动提升 0.15
7. **Type 字段**：Codex Findings 额外标注问题类型
8. **Trigger 字段**：Codex Findings 必须说明触发条件
9. **Uncertain 标记**：信息不足时标注不确定性
10. **Statistics**：末尾统计审查覆盖范围和 Codex 状态

## 降级与容错

### Codex 调用失败

若 Codex 调用失败：
1. Summary 中 `Codex Status` 设为 `failed`
2. `Codex Score` 设为 `N/A`
3. Codex Findings 区块输出：`**Codex review failed: <错误原因>**`
4. 最终 Verdict 仅基于 Claude 审查结果
5. Confidence 降低 0.2

### 大 Diff 处理

若 diff 超过 8000 行：
1. Summary 中 `Truncated` 设为 `true`
2. 分片处理，每片独立审查
3. 在 Explanation 中说明截断情况和受影响的审查范围

## Verdict 综合规则

| 场景 | Verdict 规则 |
|------|-------------|
| 双模型均无 P0/P1 | ✅ CORRECT |
| 任一模型发现 P0 | ❌ INCORRECT |
| 任一模型发现 P1 且评分 < 70 | ❌ INCORRECT |
| Consensus 存在 P1+ | ❌ INCORRECT |
| Codex 失败，Claude 无 P0/P1 | ✅ CORRECT (degraded) |

**工作目录**：当前项目目录（自动识别 `process.cwd()`）
