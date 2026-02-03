# Chrome-MCP 页面验证

## 目录

- [验证流程](#验证流程)
- [页面访问策略](#页面访问策略)
- [视觉对比](#视觉对比)
- [循环修复](#循环修复)

## 验证流程

```
1. 缓存设计稿截图（首次）
2. 确定页面访问策略
3. 打开页面并截图
4. Gemini 视觉对比
5. 差异 → 修复 → 重新验证（最多 3 次）
```

## 页面访问策略

### 策略类型

| 类型 | 场景 | 处理方式 |
|------|------|----------|
| direct_url | 普通页面 | 直接导航 |
| modal | 弹窗组件 | 先导航到父页面，点击触发 |
| drawer | 抽屉组件 | 先导航到父页面，点击触发 |
| nested_route | 嵌套路由 | 逐级导航 |

### 策略 A：直接 URL 访问

```typescript
if (strategy.type === 'direct_url' && !strategy.requiresAuth) {
  await mcp__chrome-mcp__navigate_page({
    type: 'url',
    url: validation.pageUrl
  });
}
```

### 策略 B：需要认证的页面

```typescript
// 方案 1：复用已登录的浏览器会话（推荐）
// Chrome-MCP 连接到已打开的浏览器

// 方案 2：注入测试 token
await mcp__chrome-mcp__evaluate_script({
  function: `() => {
    localStorage.setItem('auth_token', '${testToken}');
    sessionStorage.setItem('user', JSON.stringify(${mockUser}));
  }`
});
await mcp__chrome-mcp__navigate_page({ type: 'reload' });
```

### 策略 C：弹窗/抽屉

```typescript
if (strategy.type === 'modal' || strategy.type === 'drawer') {
  // 1. 导航到父页面
  await mcp__chrome-mcp__navigate_page({
    type: 'url',
    url: strategy.triggerAction.navigateTo
  });

  // 2. 等待页面加载
  await mcp__chrome-mcp__wait_for({
    text: '页面标识',
    timeout: 10000
  });

  // 3. 点击触发按钮
  const snapshot = await mcp__chrome-mcp__take_snapshot({});
  const trigger = findElementBySelector(snapshot, strategy.triggerAction.clickSelector);
  await mcp__chrome-mcp__click({ uid: trigger.uid });

  // 4. 等待弹窗出现
  await mcp__chrome-mcp__wait_for({
    text: strategy.triggerAction.waitForSelector,
    timeout: 5000
  });
}
```

### 策略 D：需要接口数据

```typescript
if (strategy.requiresData) {
  // 方案 1：MSW Mock Server
  await Bash({
    command: `cd ${projectDir} && npx msw start --fixture ${fixtureFile}`,
    run_in_background: true
  });

  // 方案 2：注入测试数据
  await mcp__chrome-mcp__evaluate_script({
    function: `() => {
      window.__TEST_DATA__ = ${JSON.stringify(fixtureData)};
      window.__MOCK_MODE__ = true;
    }`
  });

  // 方案 3：生成测试 Harness（最可靠）
  const testHtmlPath = await generateTestHarness({
    component: targetComponent,
    props: mockProps,
    mockData: fixtureData
  });
  await mcp__chrome-mcp__navigate_page({
    type: 'url',
    url: `file://${testHtmlPath}`
  });
}
```

### 测试 Harness 模板

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UI 验证 - ${componentName}</title>
  <link rel="stylesheet" href="${projectStylesPath}">
</head>
<body>
  <div id="app"></div>
  <script type="module">
    window.__MOCK_DATA__ = ${JSON.stringify(mockData)};
    import { mount } from '${frameworkMountHelper}';
    import Component from '${componentPath}';
    mount(Component, {
      target: document.getElementById('app'),
      props: ${JSON.stringify(props)}
    });
  </script>
</body>
</html>
```

## 视觉对比

### 截图

```typescript
// 设计稿截图（缓存）
if (!validation.designScreenshot) {
  await mcp__figma-mcp__get_screenshot({ nodeId });
  validation.designScreenshot = `${taskAssetsDir}/design-screenshot.png`;
}

// 实际页面截图
const actualScreenshot = `${taskAssetsDir}/actual-screenshot-${validation.currentRetry}.png`;
await mcp__chrome-mcp__take_screenshot({
  filePath: actualScreenshot,
  fullPage: false
});
```

### Gemini 对比

```bash
codeagent-wrapper --backend gemini - ${workdir} <<'EOF'
对比两张截图，返回 JSON：
{
  "match": true/false,
  "differences": [
    {
      "location": "描述位置",
      "expected": "设计稿中的样式",
      "actual": "实际页面的样式",
      "severity": "critical|major|minor"
    }
  ],
  "ignoredRegions": ["header", "sidebar"],
  "overallSimilarity": 0-100
}

设计稿截图：[Image: design-screenshot.png]
实际页面截图：[Image: actual-screenshot.png]

忽略区域：${JSON.stringify(ignoreRegions)}

severity 判断：
- critical: 布局错乱、元素缺失
- major: 颜色/间距明显偏差
- minor: 细微样式差异
EOF
```

## 循环修复

```typescript
const compareResult = parseGeminiResult();

if (compareResult.match || compareResult.overallSimilarity >= 95) {
  console.log('✅ 视觉验证通过');
} else if (validation.currentRetry >= validation.maxRetries) {
  console.log(`⚠️ 已达最大修复次数 (${validation.maxRetries})`);
  compareResult.differences.forEach(d =>
    console.log(`  - ${d.location}: ${d.expected} → ${d.actual}`)
  );
  await askUser('是否接受当前结果? (Y/N)');
} else {
  validation.currentRetry++;
  console.log(`🔄 开始第 ${validation.currentRetry} 次修复...`);

  const fixPatch = await generateFixPatch(compareResult.differences);
  applyPatch(fixPatch);

  // 重新验证
  goto('C.2');
}
```

### 忽略区域配置

```typescript
const defaultIgnoreRegions: IgnoreRegion[] = [
  { type: 'header', reason: '公共头部，非本次修改范围' },
  { type: 'sidebar', reason: '公共侧边栏，非本次修改范围' }
];

// 如果用户指定还原 header，则不忽略
if (userSpecifiedTarget.includes('header')) {
  defaultIgnoreRegions = defaultIgnoreRegions.filter(r => r.type !== 'header');
}
```
