# Directory Structure

> 前端目录组织与文件放置规则。

<!--
参考范例（不随 bootstrap 拷贝）：todo-list 场景下的完整填法，所有占位符都已给出具体值。
-->

---

## Overview

本规范定义 Vue 3 + Nuxt 4 应用的目录层次，用来回答"新文件该放哪"这类在评审里反复出现的问题。

---

## Rules

### 按领域组织，不按文件类型

同一业务领域的组件、composable、类型、store 放同一目录，不要按类型全局堆叠。

```
pages/
├── todos/
│   ├── index.vue
│   ├── [id].vue
│   ├── components/
│   │   └── TodoItem.vue
│   └── composables/
│       └── useTodos.ts
└── profile/
    ├── index.vue
    └── composables/
        └── useProfile.ts
```

**Why**: 按领域组织降低跨目录跳转成本，业务模块可整块迁移或删除，减少改动扇出。

### 共享组件放 `components/`，页面私有组件放 `pages/*/components/`

```
components/BaseButton.vue             # 全局复用
pages/todos/components/TodoItem.vue   # 只属于 todos 页面
```

**Why**: 减少 `components/` 噪音；页面私有组件跟页面一起迁移或删除，降低跨页面耦合。

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
├── formatDate.ts       ✅ 纯工具
├── fetchTodos.ts       ❌ 业务逻辑
└── toggleTodoDone.ts   ❌ 业务逻辑
```

**Good**

```
utils/
└── formatDate.ts
pages/todos/composables/
├── useTodos.ts
└── useToggleTodo.ts
```

**Why it matters**: `utils/` 一旦被当"什么都能放的桶"，可发现性反而变差；业务逻辑混进来还会诱发循环依赖。
