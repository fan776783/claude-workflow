---
name: system-design
description: "Use when 用户说「补充后端设计」「系统设计」「API 设计」「数据流」「服务边界」「补 §5.6」, or workflow-spec Step 5 确认需要后端设计深化, or 已有 Spec 需要补充 API Contract / Data Flow / Service Boundaries / Data Migration。"
---

<CONTEXT>
Read `core/specs/shared/glossary.md`（产出 normative spec 内容须用 canonical 术语）。
</CONTEXT>

# system-design

> 后端设计深化——在已有 Spec §5.1-5.5 基础上生成 §5.6 System Design。

<HARD-GATE>
1. 必须有已扩写的 Spec（含 §5.1 Module Responsibilities）作为输入
2. 主会话内完成，不派生子 Agent
3. API Contract 必须从 §4.1 Primary Flow 推导，不凭空设计
</HARD-GATE>

## Checklist

1. ☐ 定位 Spec 文件 + 验证前置章节
2. ☐ § 5.6.1 API Contract Summary
3. ☐ § 5.6.2 Data Flow（Mermaid）
4. ☐ § 5.6.3 Service Boundaries
5. ☐ § 5.6.4 Data Migration（条件）
6. ☐ Self-Review（后端一致性检查）

---

## Step 1: 定位 Spec + 验证前置

**输入来源**（按优先级）：
1. 活跃 workflow → 读取 `workflow-state.json` 中的 `spec_file`
2. 用户指定路径 → `/system-design path/to/spec.md`
3. 无参数 → 搜索 `~/.claude/workflows/{projectId}/specs/` 下最新 spec

**验证**：
- §4.1 Primary Flow 非空（推导 API 的依据）
- §5.1 Module Responsibilities 非空（确认模块划分）
- §5.6 章节为空或仅含模板占位（避免覆盖已有内容）

验证失败 → 告知用户缺少前置内容，建议先完成 Spec 核心章节。

## Step 2: § 5.6.1 API Contract Summary

从 §4.1 Primary Flow 推导接口清单：

```markdown
| 端点 | 方法 | 请求体要点 | 响应体要点 | 鉴权 |
|------|------|-----------|-----------|------|
```

要求：
- 覆盖 §4.1 中每个用户触发动作对应的后端接口
- RESTful 命名，路径含资源层级
- 标注需要鉴权的端点

Edit 写入 spec.md § 5.6.1。

## Step 3: § 5.6.2 Data Flow

Mermaid 数据流图，覆盖完整调用链路：

```
Client → API Gateway → Service → Repository → Storage
```

关注点：
- 异步操作标注（消息队列、事件）
- 缓存层位置
- 外部服务调用

Edit 写入 spec.md § 5.6.2。

## Step 4: § 5.6.3 Service Boundaries

基于 §5.1 Module Responsibilities 定义服务边界：

```markdown
| 服务/模块 | 职责 | 通信方式 | 关键约束 |
|----------|------|---------|---------| 
```

要求：
- 与 §5.1 模块一一对应
- 标注同步/异步通信方式
- 明确跨服务事务处理策略

Edit 写入 spec.md § 5.6.3。

## Step 5: § 5.6.4 Data Migration（条件）

**触发条件**：Spec 涉及 schema 变更（新表、字段变更、索引变更）。
**跳过条件**：无 schema 变更时删除本节占位。

填写内容：
- 迁移脚本描述（up/down）
- 数据回填策略
- 零停机部署约束（如有）

Edit 写入 spec.md § 5.6.4。

## Step 6: Self-Review（后端一致性）

设计深化完成后立即执行，发现问题直接修复：

- **API 覆盖** — §5.6.1 API Contract 覆盖 §4.1 Primary Flow 的所有触发点
- **数据流对齐** — §5.6.2 Data Flow 对应 §5.1 模块划分
- **边界一致** — §5.6.3 Service Boundaries 与 §5.1 模块边界一致
- **迁移完整** — 涉及 schema 变更时 §5.6.4 已填写
- **约束传递** — §3 Constraints 中的技术约束在设计中体现

---

## 与其他 skill 的关系

| skill | 关系 |
|-------|------|
| `workflow-spec` | 上游调用方；Step 5 确认需要后端深化后委托本 skill |
| `ux-elaboration` | 平行 skill；前端设计深化独立执行 |
| `api-smoke` | 下游消费方；可基于 §5.6.1 生成接口冒烟脚本 |
