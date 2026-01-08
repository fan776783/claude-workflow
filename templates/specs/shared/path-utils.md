# 路径安全工具函数

## resolveUnder

安全解析相对路径，防止路径遍历攻击。

```typescript
function resolveUnder(baseDir: string, relativePath: string): string | null {
  if (!relativePath ||
      path.isAbsolute(relativePath) ||
      relativePath.includes('..')) {
    return null;
  }
  if (!/^[a-zA-Z0-9_\-\.\/]+$/.test(relativePath)) {
    return null;
  }
  if (/^\/|\/\/|\/\s*$/.test(relativePath)) {
    return null;
  }
  const resolved = path.resolve(baseDir, relativePath);
  const normalizedBase = path.resolve(baseDir);
  if (resolved !== normalizedBase &&
      !resolved.startsWith(normalizedBase + path.sep)) {
    return null;
  }
  return resolved;
}
```

**安全检查**：
1. 拒绝空路径和绝对路径
2. 拒绝包含 `..` 的路径
3. 仅允许字母、数字、下划线、连字符、点和斜杠
4. 验证解析后的路径确实在 baseDir 下
