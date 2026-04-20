# Error Handling

> 后端错误处理策略与异常路径。

<!-- 本文件由 stack-template node-express 预生成，按 00-bootstrap-guidelines 从本仓库挑真实例子填入。 -->

---

## Overview

(To be filled) — 本规范覆盖路由 / 中间件 / service 层的错误处理范式。

---

## Rules

### 使用集中错误中间件

```ts
// server.ts
app.use(errorHandler);

// middleware/error-handler.ts
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
}
```

**Why**: 统一错误响应格式 + 统一日志记录点，避免散落在各路由。

### 业务错误用自定义 Error 子类

```ts
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
class NotFoundError extends HttpError {
  constructor(what: string) { super(404, `${what} not found`); }
}
```

**Why**: 带 status 的 Error 让中间件可以自动映射 HTTP 响应。

---

## DO / DON'T

**DO**

- 集中错误处理中间件
- 业务错误用 Error 子类带上 HTTP 状态
- 在 service 层 throw，在 controller 层 await

**DON'T**

- 不在 controller 每条路由都 try/catch
- 不直接把 `err.stack` 返回给客户端

---

## Common Mistakes

### 吞掉异常返回 null

**Bad**

```ts
async function getUser(id: string) {
  try {
    return await db.users.findById(id);
  } catch {
    return null;   // ❌ 调用方无法区分 "不存在" 与 "DB 错"
  }
}
```

**Good**

```ts
async function getUser(id: string) {
  const user = await db.users.findById(id);
  if (!user) throw new NotFoundError('User');
  return user;
}
```

**Why it matters**: 静默返回 null 会把"找不到"和"崩溃"混淆，排查时难以定位。
