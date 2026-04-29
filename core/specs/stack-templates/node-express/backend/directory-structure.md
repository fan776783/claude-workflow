# Directory Structure

> 后端目录组织与文件放置规则。

<!-- 本文件由 stack-template node-express 预生成，按 00-bootstrap-guidelines 从本仓库挑真实例子填入。 -->

---

## Overview

(To be filled) — 本规范定义 Express 应用的module层次。

---

## Rules

### 按领域拆 module，不按类型

```
src/
├── modules/
│   ├── users/
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   ├── users.repository.ts
│   │   └── users.routes.ts
│   └── orders/
│       └── ...
├── middleware/
└── server.ts
```

**Why**: 按领域组织让一个功能的所有代码聚合在一起，便于独立理解与拆分服务。

### controller / service / repository 三层分离

**Why**: 让 HTTP 边界、业务逻辑、数据访问解耦，测试时易于 mock。

---

## DO / DON'T

**DO**

- 按领域拆 module
- controller / service / repository 三层
- 公共中间件放 `middleware/`

**DON'T**

- 不在 controller 直接写 DB 查询
- 不把路由注册塞进 service

---

## Common Mistakes

### controller 直接访问 DB

**Bad**

```ts
// users.controller.ts
app.get('/users/:id', async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);  // ❌
  res.json(user);
});
```

**Good**

```ts
// users.controller.ts
app.get('/users/:id', async (req, res) => {
  const user = await usersService.getById(req.params.id);  // ✅ 委托给 service
  res.json(user);
});
```

**Why it matters**: controller 混入 DB 逻辑后无法独立测试，且 DB schema 变化会直接打穿 HTTP 层。
