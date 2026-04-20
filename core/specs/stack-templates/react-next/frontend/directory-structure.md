# Directory Structure

> 前端目录组织与文件放置规则（Next.js App Router）。

<!-- 本文件由 stack-template react-next 预生成，按 00-bootstrap-guidelines 从本仓库挑真实例子填入。 -->

---

## Overview

(To be filled) — 本规范定义 Next.js 应用的目录层次。

---

## Rules

### App Router 下按 route segment 组织

```
app/
├── (marketing)/
│   └── page.tsx
├── dashboard/
│   ├── layout.tsx
│   ├── page.tsx
│   └── _components/
│       └── StatCard.tsx
└── api/
    └── users/route.ts
```

**Why**: App Router 的 route segment 是 Next.js 13+ 推荐结构，私有组件用 `_components/` 前缀排除路由解析。

### 共享 UI 放 `components/`，路由私有组件放 `_components/`

**Why**: `_components/` 下划线前缀让 Next.js 跳过路由解析，同时语义上标记"不被外部复用"。

---

## DO / DON'T

**DO**

- App Router 按 route segment 组织
- 路由私有组件放 `_components/`
- 共享 hooks 放 `hooks/`，pure 工具放 `lib/`

**DON'T**

- 不把业务逻辑塞进 `lib/`
- 不跨 route segment 深度引用私有组件

---

## Common Mistakes

### 把路由私有组件放到全局 components/

**Bad**

```
components/
└── DashboardStatCard.tsx   ❌ 只有 dashboard 用
```

**Good**

```
app/dashboard/_components/
└── StatCard.tsx            ✅ 随路由一起维护
```

**Why it matters**: 私有组件放全局目录会增加噪音，且路由删除时难以同步清理。
