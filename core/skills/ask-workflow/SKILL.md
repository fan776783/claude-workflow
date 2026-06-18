---
name: ask-workflow
description: "路由地图——不知道用哪个 skill 时看这里。Use when 用户说「有哪些命令 / 从哪开始 / workflow 怎么走 / 不知道用哪个 / help / ask workflow」, or 新人上手想了解 skill 体系全貌。只画地图不干活,看完后用对应 /skill 继续。"
disable-model-invocation: true
---

# Ask Workflow

不知道用哪个 skill?这里画一张地图。本 skill 只做路由,不执行任何任务——看完地图后用对应的 `/skill` 继续。

## 主流程:需求 → 上线

完整需求走四步,每步产出一个状态机产物:

```
/workflow-spec  →  /workflow-plan  →  /workflow-execute  →  /workflow-archive
   spec.md           plan + task-dir       完成验证 + commit        归档总结
```

- 复杂需求(跨 module / 新子系统 / 需追溯)走完整四步
- 每步有 HARD-GATE,不跳步
- 状态丢了?→ `/workflow-status` 查当前进度和下一步建议
- 简单任务不想走状态机?→ `/quick-plan`(轻规划,一次性)

## on-ramp:外来需求接入

不在主流程里,但有需求要处理:

- **单个 bug** → `/fix-bug`(直接修)或先 `/diagnose`(定位根因再修)
- **一批 bug** → `/bug-batch`(全量分析找共享根因,成组修)
- **已有 workflow 遇到需求/PRD/API 变化** → `/workflow-delta`(影响分析 + 并入)

## 架构健康

顺手做,产出可喂回主流程:

- `/improve-architecture` — 找架构深化机会(shallow → deep),候选可变成新 spec 的输入

## 跨会话

context 要爆或要交接给别人:

- `/handoff` — 压缩当前对话成交接文档

## 独立 skill(不在主流程里)

| skill | 干什么 |
|-------|--------|
| `/grill` | 质询你的计划/设计,逐个分支追问到对齐 |
| `/research` | 外部证据收集(文档/代码/实验) |
| `/prototype` | 快速验证"跑起来才知道"的问题 |
| `/tdd` | 测试驱动开发(vertical slice + 红绿) |
| `/diff-review` | 代码评审(8 阶段管线) |
| `/resolve-merge-conflicts` | 逐 hunk 解决 git 合并冲突,保留双方意图 |
| `/teach` | 系统教学(跨 session,有 workspace) |
| `/scan` | 扫描项目现状(技能/规范/缺口) |
| `/write-a-skill` | 写新 skill 或审计现有 skill |
| `/ux-elaboration` | 前端设计深化(补 Spec §4.4) |
| `/spec-bootstrap` | 初始化 .claude/code-specs/ 骨架 |
| `/plan-archive` | 三阶段研发流程阶段三(回写技术方案 + 架构文档) |
| `/design-plan` | 设计规划(三阶段流程) |

## 上下文纪律

- 主流程的 spec → plan → execute 尽量保持同一会话(状态机依赖会话内 context)
- 每个 task 执行重开子会话(fresh subagent)
- `/handoff` 用于跨会话,fork 出新会话
