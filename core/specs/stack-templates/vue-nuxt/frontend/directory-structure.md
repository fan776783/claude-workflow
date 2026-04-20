# Directory Structure

> 前端目录组织与文件放置规则。

<!--
本文件由 stack-template vue-nuxt 预生成。
请按 `.claude/tasks/00-bootstrap-guidelines.md` 的执行步骤，从 apps/{{package_name}}/ 的真实目录挑 1–2 个例子替换下方 (To be filled)。
-->

---

## Overview

(To be filled) — 本规范定义 Vue/Nuxt 应用的目录层次，解决"新文件该放哪"这类反复出现的问题。

---

## Rules

### 按领域组织，不按文件类型

同一业务领域的组件、composable、类型、store 放在同一目录下，而不是按类型全局堆叠。

```
pages/
├── checkout/
│   ├── index.vue
│   ├── components/
│   │   └── PaymentForm.vue
│   └── composables/
│       └── usePayment.ts
└── profile/
    ├── index.vue
    └── ...
```

**Why**: 按领域组织降低跨目录跳转成本，业务模块可整块迁移或删除。

### 共享组件放 `components/`，页面私有组件放 `pages/*/components/`

```
components/UserAvatar.vue         # 全局复用
pages/checkout/components/...     # 只属于 checkout 页面
```

**Why**: 减少 `components/` 下的噪音，页面私有组件可随页面一起迁移或删除。

---

## DO / DON'T

**DO**

- 按领域组织目录
- 页面私有组件放在对应页面目录下
- 组合式函数统一放 `composables/`
- 类型定义放 `types/` 或各领域的 `types.ts`

**DON'T**

- 不把所有组件平铺在顶层 `components/`
- 不在 `utils/` 放业务逻辑（只放纯工具函数）
- 不跨目录深度引用私有组件

---

## Common Mistakes

### 把业务逻辑塞进 utils/

**Bad**

```
utils/
├── formatPrice.ts          ✅ 纯工具
├── fetchUserOrders.ts      ❌ 业务逻辑
└── updateCheckoutState.ts  ❌ 业务逻辑
```

**Good**

```
utils/
└── formatPrice.ts
pages/checkout/composables/
├── useCheckoutState.ts
└── useOrders.ts
```

**Why it matters**: `utils/` 一旦被当成什么都能放的桶，可发现性就会反向下降；业务逻辑混进来还会诱发循环依赖。
