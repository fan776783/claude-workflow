# PBT 属性系统

Property-Based Testing (PBT) 属性用于形式化定义系统行为的不变性约束。

## 概述

PBT 属性不同于普通测试用例：
- **测试用例**: 验证特定输入 → 期望输出
- **PBT 属性**: 验证所有输入都满足某种不变性

## 数据结构

```typescript
interface PBTProperty {
  id: string;                    // 如 "PBT001"
  name: string;                  // 如 "用户余额非负"
  category: PBTCategory;
  definition: string;            // 形式化定义
  boundaryConditions: string[];  // 边界条件
  falsificationStrategy: string; // 如何证伪
  verifyCmd?: string;            // 可选的验证命令
  targetFiles: string[];         // 关联的文件
  sourceModel: 'codex' | 'gemini' | 'claude' | 'user';
  verified: boolean;
}

type PBTCategory =
  | 'idempotency'      // 幂等性: f(f(x)) = f(x)
  | 'round_trip'       // 往返性: decode(encode(x)) = x
  | 'invariant'        // 不变性: P(state) 操作后仍成立
  | 'monotonicity'     // 单调性: x ≤ y → f(x) ≤ f(y)
  | 'bounds'           // 边界性: min ≤ x ≤ max
  | 'commutativity'    // 交换性: f(a,b) = f(b,a)
  | 'associativity';   // 结合性: f(f(a,b),c) = f(a,f(b,c))
```

## 属性类别详解

### 1. 幂等性 (Idempotency)

**定义**: 对同一输入重复执行操作，结果不变。

```
f(f(x)) = f(x)
```

**典型场景**:
- HTTP PUT/DELETE 请求
- 数据库 UPSERT 操作
- 配置文件写入
- 缓存更新

**示例**:
```typescript
{
  id: "PBT001",
  name: "用户状态更新幂等",
  category: "idempotency",
  definition: "updateUserStatus(updateUserStatus(user, status), status) = updateUserStatus(user, status)",
  boundaryConditions: ["status 为空时", "user 不存在时"],
  falsificationStrategy: "生成随机 user 和 status，执行两次更新，比较结果"
}
```

### 2. 往返性 (Round-trip)

**定义**: 编码后解码返回原值。

```
decode(encode(x)) = x
```

**典型场景**:
- JSON 序列化/反序列化
- Base64 编解码
- 加密/解密
- 压缩/解压

**示例**:
```typescript
{
  id: "PBT002",
  name: "用户数据序列化完整性",
  category: "round_trip",
  definition: "deserialize(serialize(user)) = user",
  boundaryConditions: ["包含特殊字符", "包含 null 字段", "嵌套对象"],
  falsificationStrategy: "生成随机用户对象，序列化后反序列化，深度比较"
}
```

### 3. 不变性 (Invariant)

**定义**: 某个条件在操作前后始终成立。

```
P(state) ∧ operation(state) → P(state')
```

**典型场景**:
- 账户余额非负
- 订单状态机转换
- 树结构平衡性
- 并发数据一致性

**示例**:
```typescript
{
  id: "PBT003",
  name: "账户余额非负",
  category: "invariant",
  definition: "∀ operation: balance(account) >= 0",
  boundaryConditions: ["并发扣款", "退款超过已付金额", "浮点精度"],
  falsificationStrategy: "生成随机交易序列，验证每步后余额 >= 0"
}
```

### 4. 单调性 (Monotonicity)

**定义**: 输入增大时输出不减（或不增）。

```
x ≤ y → f(x) ≤ f(y)  // 单调递增
x ≤ y → f(x) ≥ f(y)  // 单调递减
```

**典型场景**:
- 时间戳生成
- 版本号递增
- 排序算法稳定性
- 日志序号

**示例**:
```typescript
{
  id: "PBT004",
  name: "事件时间戳单调递增",
  category: "monotonicity",
  definition: "∀ event1, event2: event1.createdBefore(event2) → event1.timestamp < event2.timestamp",
  boundaryConditions: ["高并发创建", "跨时区", "时钟回拨"],
  falsificationStrategy: "并发生成事件，按创建顺序排序，验证时间戳递增"
}
```

### 5. 边界性 (Bounds)

**定义**: 值始终在指定范围内。

```
min ≤ value ≤ max
```

**典型场景**:
- 百分比 0-100
- 端口号 1-65535
- 数组索引
- 分页参数

**示例**:
```typescript
{
  id: "PBT005",
  name: "分页参数有效范围",
  category: "bounds",
  definition: "1 ≤ page ≤ totalPages ∧ 1 ≤ pageSize ≤ 100",
  boundaryConditions: ["page = 0", "pageSize = 0", "超大 pageSize"],
  falsificationStrategy: "生成边界值和随机值，验证 API 正确处理或拒绝"
}
```

### 6. 交换性 (Commutativity)

**定义**: 操作顺序不影响结果。

```
f(a, b) = f(b, a)
```

**典型场景**:
- 集合合并
- 数值加法
- 权限组合
- 过滤器组合

**示例**:
```typescript
{
  id: "PBT006",
  name: "权限合并交换性",
  category: "commutativity",
  definition: "mergePermissions(a, b) = mergePermissions(b, a)",
  boundaryConditions: ["空权限集", "重叠权限", "冲突权限"],
  falsificationStrategy: "生成随机权限集对，验证两种合并顺序结果相同"
}
```

### 7. 结合性 (Associativity)

**定义**: 分组方式不影响结果。

```
f(f(a, b), c) = f(a, f(b, c))
```

**典型场景**:
- 字符串拼接
- 数组连接
- 数据流管道
- 中间件链

**示例**:
```typescript
{
  id: "PBT007",
  name: "中间件链结合性",
  category: "associativity",
  definition: "compose(compose(a, b), c) = compose(a, compose(b, c))",
  boundaryConditions: ["空中间件", "副作用中间件", "异步中间件"],
  falsificationStrategy: "生成中间件序列，验证不同分组方式最终行为一致"
}
```

## 提取流程

### Phase 1.5: PBT 属性提取

在 workflow-start 的代码分析阶段后执行：

```typescript
// 调用 Codex 提取 PBT 属性
const pbtPrompt = `
分析以下需求和代码上下文，提取 Property-Based Testing 属性。

## 需求
${requirementContent}

## 相关代码
${analysisResult.relatedFiles.map(f => f.path).join('\n')}

## 现有约束
${analysisResult.constraints.join('\n')}

## 输出要求

请按以下 JSON 格式输出，只输出 JSON：
{
  "properties": [
    {
      "id": "PBT001",
      "name": "属性名称（中文）",
      "category": "idempotency|round_trip|invariant|monotonicity|bounds|commutativity|associativity",
      "definition": "形式化定义（使用数学符号）",
      "boundaryConditions": ["边界条件1", "边界条件2"],
      "falsificationStrategy": "如何证伪此属性",
      "targetFiles": ["相关文件路径"]
    }
  ]
}

## 提取原则

1. 优先提取业务核心属性（如资金、权限、状态）
2. 关注数据完整性和一致性
3. 考虑并发和边界情况
4. 每个属性应可测试/可验证
`;

const result = await callCodex(pbtPrompt, 'analyzer');
const pbtProperties = parsePBTProperties(result);
```

### 解析函数

```typescript
function parsePBTProperties(output: string): PBTProperty[] {
  // 提取 JSON
  const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (!jsonMatch) {
    console.log('⚠️ 无法从 Codex 输出中提取 PBT 属性');
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[1]);

    if (!Array.isArray(parsed.properties)) {
      return [];
    }

    // 验证并补充字段
    return parsed.properties.map((p: any, i: number) => ({
      id: p.id || `PBT${String(i + 1).padStart(3, '0')}`,
      name: p.name || '未命名属性',
      category: validateCategory(p.category) || 'invariant',
      definition: p.definition || '',
      boundaryConditions: Array.isArray(p.boundaryConditions) ? p.boundaryConditions : [],
      falsificationStrategy: p.falsificationStrategy || '',
      targetFiles: Array.isArray(p.targetFiles) ? p.targetFiles : [],
      sourceModel: 'codex',
      verified: false
    }));
  } catch (e) {
    console.log(`⚠️ PBT 属性 JSON 解析失败: ${e}`);
    return [];
  }
}

function validateCategory(category: string): PBTCategory | null {
  const valid: PBTCategory[] = [
    'idempotency', 'round_trip', 'invariant',
    'monotonicity', 'bounds', 'commutativity', 'associativity'
  ];
  return valid.includes(category as PBTCategory) ? category as PBTCategory : null;
}
```

## 集成到约束系统

```typescript
// 扩展 ConstraintSet
interface ConstraintSet {
  hard: Constraint[];
  soft: Constraint[];
  pbtProperties: PBTProperty[];   // 新增
  openQuestions: string[];
  successCriteria: string[];
}

// 在 workflow-state.json 中存储
state.constraints.pbtProperties = pbtProperties;
```

## 验证机制

### 质量关卡集成

```typescript
async function verifyPBTProperties(
  properties: PBTProperty[]
): Promise<{ passed: boolean; results: PBTVerifyResult[] }> {
  const results: PBTVerifyResult[] = [];

  for (const prop of properties) {
    if (!prop.verifyCmd) {
      results.push({
        propertyId: prop.id,
        passed: null,  // 未验证
        details: 'No verification command specified'
      });
      continue;
    }

    try {
      const result = await Bash({ command: prop.verifyCmd, timeout: 60000 });
      results.push({
        propertyId: prop.id,
        passed: result.exitCode === 0,
        details: result.exitCode === 0 ? 'Passed' : result.stderr
      });
    } catch (e) {
      results.push({
        propertyId: prop.id,
        passed: false,
        details: `Execution error: ${e}`
      });
    }
  }

  const allPassed = results.every(r => r.passed !== false);
  return { passed: allPassed, results };
}
```

## 文档输出

在 tech-design.md 中生成 PBT 章节：

```markdown
## 8. PBT 属性清单

| ID | 属性名 | 类别 | 定义 |
|----|--------|------|------|
| PBT001 | 用户余额非负 | invariant | ∀ op: balance >= 0 |
| PBT002 | 数据序列化完整 | round_trip | deserialize(serialize(x)) = x |

### 边界条件

- **PBT001**: 并发扣款、退款超额、浮点精度
- **PBT002**: 特殊字符、null 字段、嵌套对象

### 证伪策略

- **PBT001**: 生成随机交易序列，验证每步后余额 >= 0
- **PBT002**: 生成随机对象，序列化后反序列化，深度比较
```
