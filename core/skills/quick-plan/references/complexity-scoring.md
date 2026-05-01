# Complexity Scoring

quick-plan Step 1.2 的复杂度评估 + Step 4 的信心评分规则。

## 复杂度级别

| 级别 | 信号 | 范围 |
|------|------|------|
| Small | 单文件、局部delta | 1-3 个文件 |
| Medium | 多文件、遵循现有模式 | 3-10 个文件 |
| Large | 跨module、新模式 | 10+ 个文件 |
| XL | 架构delta、新子系统 | 建议切换 `/workflow-spec` |

判断时看两个维度取较高：
- **文件数**：预估需要 CREATE / UPDATE 的文件数量
- **模式新颖度**：是复用现有模式还是引入新架构 / 新依赖

边界情况：
- Small 但引入新依赖 → 升级到 Medium
- 大量文件但都是同一机械模式（批量改命名等）→ 降级到 Medium
- 跨 pkg 但每个 pkg 只改少量文件 → Medium 或 Large 取决于耦合

## Confidence 评分

| 分数 | 含义 | 典型特征 |
|------|------|----------|
| 9-10 | 非常高 | 代码库分析充分、需求清晰、能引用 mirror 代码、验证命令确定 |
| 7-8 | 高 | 需求清晰、模式存在但需少量适配、验证命令可写 |
| 5-6 | 中 | 需求基本清晰、有少量不确定性或非典型路径 |
| 3-4 | 低 | 需求存在多种合理解读、或缺关键上下文 |
| 1-2 | 很低 | 建议切 `/workflow-spec` 做完整 spec workflow |

评分纪律：
- Confidence < 5 → 主动建议 `/workflow-spec`，不要硬塞 quick-plan
- Confidence ≥ 8 但复杂度 XL → 仍建议切 workflow，因为追溯性价值大
- Medium + Confidence 6-8 是 quick-plan 最舒服的区间
