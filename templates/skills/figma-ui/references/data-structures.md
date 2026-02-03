# 数据结构定义

## 目录

- [FigmaUrlParams](#figmaurlparams)
- [ElementManifest](#elementmanifest)
- [TokenMapping](#tokenmapping)
- [BuildPlan](#buildplan)
- [WorkflowState](#workflowstate)
- [ValidationConfig](#validationconfig)

## FigmaUrlParams

从 Figma URL 解析的参数。

```typescript
interface FigmaUrlParams {
  fileKey: string;    // /design/ 后的段，如 'kL9xQn2VwM8pYrTb4ZcHjF'
  nodeId: string;     // node-id 参数值，如 '42-15' 或 '42:15'
  fileName?: string;  // URL 中的文件名（可选）
}
```

### URL 解析示例

```typescript
// URL: https://figma.com/design/kL9xQn2VwM8pYrTb4ZcHjF/DesignSystem?node-id=42-15
const params: FigmaUrlParams = {
  fileKey: 'kL9xQn2VwM8pYrTb4ZcHjF',
  nodeId: '42-15',  // MCP 调用时可能需要转为 '42:15'
  fileName: 'DesignSystem'
};

// Branch URL: https://figma.com/design/kL9xQn2VwM8pYrTb4ZcHjF/branch/abcd1234/DesignSystem?node-id=1-2
// 使用 branchKey 'abcd1234' 作为 fileKey
```

## ElementManifest

元素清单，追踪所有需要实现的 UI 元素。

```typescript
interface ElementManifest {
  taskId: string;
  elements: Array<{
    nodeId: string;
    name: string;
    type: string;
    priority: 'P0' | 'P1' | 'P2';  // P0=必须, P1=重要, P2=可选
    status: 'pending' | 'implemented' | 'verified';
  }>;
  coverage: {
    requiredP0P1: number;      // P0 + P1 总数
    implementedP0P1: number;   // 已实现的 P0 + P1 数量
    ratio: number;             // implementedP0P1 / requiredP0P1
  };
}
```

### 优先级判断规则

| 类型 | 优先级 | 说明 |
|------|--------|------|
| FRAME（主容器） | P0 | 核心布局结构 |
| TEXT | P0 | 文本内容 |
| BUTTON | P0 | 交互元素 |
| INPUT | P0 | 表单元素 |
| IMAGE | P1 | 图片资源 |
| ICON | P1 | 图标 |
| VECTOR | P2 | 装饰性图形 |
| LINE | P2 | 分隔线等 |

## TokenMapping

Design Token 映射表。

```typescript
interface TokenMapping {
  colors: Record<string, string>;     // "#3B82F6" → "colors.primary.500"
  spacing: Record<string, string>;    // "16px" → "spacing.4"
  typography: Record<string, string>; // "14px/500" → "text.sm.medium"
  radius: Record<string, string>;     // "8px" → "rounded.lg"
  shadow: Record<string, string>;     // "0 4px 6px..." → "shadow.md"
}
```

### Token 映射示例

```typescript
// Tailwind 项目
const tailwindMapping: TokenMapping = {
  colors: {
    '#3B82F6': 'blue-500',
    '#EF4444': 'red-500',
    '#10B981': 'green-500'
  },
  spacing: {
    '4px': '1',
    '8px': '2',
    '16px': '4',
    '24px': '6'
  }
};

// CSS Variables 项目
const cssVarMapping: TokenMapping = {
  colors: {
    '#3B82F6': 'var(--color-primary)',
    '#EF4444': 'var(--color-error)'
  }
};
```

## BuildPlan

构建计划，描述如何实现组件。

```typescript
interface BuildPlan {
  component: {
    name: string;           // 组件名称
    filePath: string;       // 目标文件路径
    framework: string;      // vue/react/nuxt/next
  };
  layout: {
    strategy: 'flex' | 'grid';
    direction: 'row' | 'column';
    alignment?: string;     // items-center, justify-between 等
  };
  responsive: {
    approach: 'mobile-first' | 'desktop-first';
    breakpoints: string[];  // ['sm', 'md', 'lg']
  };
  componentReuse: {
    existing: string[];     // 可复用的现有组件
    newRequired: string[];  // 需要新建的组件
  };
  elements: {
    total: number;
    p0: number;
    p1: number;
    p2: number;
  };
}
```

### 组件复用原则

| 场景 | 策略 |
|------|------|
| 项目有 Button 组件 | 扩展 variant，不新建 |
| 项目有 Input 组件 | 添加新 props，不新建 |
| 项目无对应组件 | 新建，遵循项目命名规范 |
| 设计系统组件 | 优先使用，微调样式匹配设计 |

## WorkflowState

工作流状态，跨阶段持久化。

```typescript
interface WorkflowState {
  taskId: string;
  targetPath: string;
  figma: {
    url: string;
    fileKey: string;
    nodeId: string;
  };
  taskAssetsDir: string;
  phaseStatus: Record<'A' | 'B' | 'C', 'pending' | 'completed' | 'failed'>;
  project: {
    framework: string;
    cssFramework: string;
    designTokens: TokenMapping;
    existingComponents: string[];
  };
  designContext: object;           // Figma MCP 原始输出
  elementManifest: ElementManifest;
  buildPlan: BuildPlan | null;
  userApproved: boolean;
  validation: ValidationConfig;
}
```

## ValidationConfig

Chrome-MCP 验证配置。

```typescript
interface ValidationConfig {
  pageUrl: string;                  // 实际页面 URL
  designScreenshot: string;         // 设计稿截图路径（缓存）
  ignoreRegions: IgnoreRegion[];    // 忽略区域
  maxRetries: number;               // 最大修复循环次数（默认 3）
  currentRetry: number;             // 当前循环次数
  accessStrategy: PageAccessStrategy;
}

interface IgnoreRegion {
  type: 'header' | 'sidebar' | 'footer' | 'custom';
  selector?: string;                // CSS 选择器（custom 时使用）
  reason: string;
}

interface PageAccessStrategy {
  type: 'direct_url' | 'modal' | 'drawer' | 'nested_route';
  requiresAuth: boolean;
  requiresData: boolean;
  triggerAction?: {
    navigateTo: string;
    clickSelector?: string;
    waitForSelector?: string;
  };
  mockStrategy?: {
    type: 'msw' | 'fixture' | 'test_harness';
    endpoints?: string[];
    fixtureData?: object;
  };
}
```
