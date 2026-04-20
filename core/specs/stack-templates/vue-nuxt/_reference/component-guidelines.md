# Component Guidelines

> Vue 3 组件的结构、命名与协作约定。

<!--
参考范例（不随 bootstrap 拷贝）：用 todo-list 作为虚拟项目场景，所有占位符都已填满，
你可以照这个样式来写自己的版本。
-->

---

## Overview

本规范覆盖 Vue 3 `<script setup lang="ts">` 单文件组件的组织方式。项目里主要解决"props/emits 类型不清、业务逻辑塞进 template"这类反复出现的可读性问题。

---

## Rules

### 使用 `<script setup>` + TypeScript

所有新组件默认 `<script setup lang="ts">`；Options API 仅在迁移旧代码时保留。

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Todo } from '~/types/todo'

const props = defineProps<{
  todo: Todo
}>()

const emit = defineEmits<{
  (e: 'toggle', id: string): void
}>()

const label = computed(() => props.todo.done ? '已完成' : '待办')
</script>
```

**Why**: Composition API + `<script setup>` 减少样板，类型推导覆盖模板；团队约定一律 setup 风格，避免评审时讨论"为什么这里用 Options"。

### props / emits 必须声明类型

用 `defineProps<T>()` 与 `defineEmits<T>()` 带类型声明，禁止裸写对象形式。

```vue
<script setup lang="ts">
const props = defineProps<{
  title: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm', value: string): void
  (e: 'cancel'): void
}>()
</script>
```

**Why**: 类型推导覆盖模板与调用方，字段错误能在编辑器阶段发现，不会漏到运行时。

---

## DO / DON'T

**DO**

- 用 `<script setup lang="ts">`
- props / emits 带类型
- 组件文件 PascalCase（`TodoItem.vue`）
- 组合式逻辑放 `composables/`，组件本身只做渲染与事件转发

**DON'T**

- 不混用 Options API 与 Composition API
- 不在 `<template>` 里写复杂表达式（抽 computed 或 composable）
- 不用 `any` 绕过类型检查
- 不在组件里直接做接口请求（走 composable）

---

## Common Mistakes

### 直接修改 props

**Bad**

```vue
<script setup lang="ts">
const props = defineProps<{ value: string }>()
props.value = 'new'  // ❌ props 是只读的
</script>
```

**Good**

```vue
<script setup lang="ts">
const props = defineProps<{ value: string }>()
const emit = defineEmits<{ (e: 'update:value', v: string): void }>()

function update(v: string) {
  emit('update:value', v)  // ✅ 通过 emit 通知父组件
}
</script>
```

**Why it matters**: props 的单向数据流是响应式模型的基石；直接赋值 dev 模式触发 warning，生产环境会出现"状态改了父组件不知道"的诡异 bug。
