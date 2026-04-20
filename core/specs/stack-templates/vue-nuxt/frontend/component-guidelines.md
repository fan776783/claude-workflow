# Component Guidelines

> Vue 3 组件的结构、命名与协作约定。

<!--
本文件由 stack-template vue-nuxt 预生成。
请按 `.claude/tasks/00-bootstrap-guidelines.md` 的执行步骤，从 apps/{{package_name}}/components/ 挑 2–3 段真实代码替换下方 (To be filled)。

对齐 Trellis live 风格：H3 标题用具体语义名（如 `### 使用 <script setup>`），不要保留 "Rule:" / "Mistake:" 前缀。
-->

---

## Overview

(To be filled) — 本规范覆盖 Vue 3 `<script setup>` 组件的编写约定。项目里主要解决 {{reason}} 问题。

---

## Rules

### 使用 `<script setup>` + TypeScript

所有新组件默认 `<script setup lang="ts">`；Options API 仅在迁移旧代码时保留。

```vue
<!-- TODO: 从 apps/{{package_name}}/components/ 挑 1 段真实组件代码填入 -->
<script setup lang="ts">
// ...
</script>
```

**Why**: Composition API + `<script setup>` 简洁、类型推导更好，与 Vue 官方推荐方向一致。

### props / emits 必须声明类型

用 `defineProps<T>()` 与 `defineEmits<T>()` 带类型声明，避免 runtime 才发现 prop 误用。

```vue
<script setup lang="ts">
const props = defineProps<{
  title: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'confirm', value: string): void;
}>();
</script>
```

**Why**: 类型推导覆盖模板与调用方，让编辑器能提前发现字段错误。

---

## DO / DON'T

**DO**

- 用 `<script setup lang="ts">`
- props / emits 带类型
- 单文件组件命名 PascalCase（`UserCard.vue`）
- 组合式逻辑放 `composables/`，不塞进组件

**DON'T**

- 不混用 Options API 与 Composition API
- 不在 `<template>` 里写复杂表达式（抽 computed 或 composable）
- 不用 `any` 绕过类型检查

---

## Common Mistakes

### 直接修改 props

**Bad**

```vue
<script setup lang="ts">
const props = defineProps<{ value: string }>();
props.value = 'new';  // ❌ props 是只读的
</script>
```

**Good**

```vue
<script setup lang="ts">
const props = defineProps<{ value: string }>();
const emit = defineEmits<{ (e: 'update:value', v: string): void }>();

function update(v: string) {
  emit('update:value', v);  // ✅ 通过 emit 通知父组件
}
</script>
```

**Why it matters**: props 的单向数据流是 Vue 响应式模型的基石，直接赋值会在 dev 模式触发 warning，也不会同步更新父组件。
