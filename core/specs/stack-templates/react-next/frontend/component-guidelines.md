# Component Guidelines

> React 组件的结构、命名与协作convention。

<!-- 本文件由 stack-template react-next 预生成，按 00-bootstrap-guidelines 从本仓库挑真实例子填入。 -->

---

## Overview

(To be filled) — 本规范覆盖函数组件的编写convention。

---

## Rules

### 默认使用函数组件 + TypeScript

类组件仅在迁移旧代码时保留。

```tsx
export function UserCard({ name }: { name: string }) {
  return <div>{name}</div>;
}
```

**Why**: 函数组件 + hooks 是 React 18+ 的标准范式，类组件已不再是首选。

### props 必须声明类型

```tsx
interface Props {
  title: string;
  disabled?: boolean;
  onConfirm: (value: string) => void;
}

export function Dialog({ title, disabled, onConfirm }: Props) { /* ... */ }
```

**Why**: 显式 props 类型让调用方编辑器即可看到contract，避免 runtime 才发现误用。

---

## DO / DON'T

**DO**

- 用函数组件 + hooks
- props 带类型（`interface` 或 `type`）
- 组件文件名 PascalCase（`UserCard.tsx`）
- 自定义 hooks 放 `hooks/`，不塞进组件

**DON'T**

- 不混用函数组件与类组件
- 不在 JSX 中写复杂表达式（抽出变量或 useMemo）
- 不用 `any` 绕过类型检查

---

## Common Mistakes

### 在渲染中直接调用 setState

**Bad**

```tsx
function Bad({ count }: { count: number }) {
  const [doubled, setDoubled] = useState(0);
  setDoubled(count * 2);  // ❌ 渲染循环
  return <div>{doubled}</div>;
}
```

**Good**

```tsx
function Good({ count }: { count: number }) {
  const doubled = useMemo(() => count * 2, [count]);  // ✅ 派生值用 useMemo
  return <div>{doubled}</div>;
}
```

**Why it matters**: 渲染期调用 setState 会触发无限重渲染，派生值应当用 `useMemo` 或直接在渲染中计算。
