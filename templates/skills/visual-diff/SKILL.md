---
name: visual-diff
description: |
  UI 视觉差异对比验证，支持像素级对比 + 双模型（Gemini + Claude）语义验证。
  触发条件：
  (1) 用户调用 /visual-diff <url> [--design <path>]
  (2) figma-ui Phase C 完成后自动衔接
  (3) 请求"视觉对比"、"截图对比"、"还原度验证"等
  输出差异图片 + 结构化报告，确保 UI 还原度。
---

# Visual Diff - UI 视觉差异验证

像素级对比 + 双模型语义验证，确保 UI 还原度。

## 核心流程

```
1. 获取设计稿截图
2. Chrome MCP 截图实现页面
3. 像素级差异分析（image_diff.py）
4. 双模型语义验证（Gemini + Claude）
5. 输出差异图片 + 综合报告
```

---

## 输入参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `url` | ✅ | 实现页面 URL |
| `--design` | ❌ | 设计稿截图路径（默认从 figma-ui 缓存获取） |
| `--selector` | ❌ | 目标元素选择器（截取特定组件） |
| `--threshold` | ❌ | 差异阈值，默认 30 |

---

## Phase 1: 获取截图

### 1.1 设计稿截图

**优先级**：
1. `--design` 参数指定的路径
2. figma-ui 缓存：`.claude/cache/figma-ui/{nodeId}/design.png`
3. 重新调用 Figma MCP 获取

```typescript
// 从 figma-ui 缓存获取
const designPath = `.claude/cache/figma-ui/${nodeId}/design.png`;
if (await fileExists(designPath)) {
  return designPath;
}

// 重新获取
await mcp__figma-mcp__get_screenshot({ nodeId });
```

### 1.2 实现页面截图

使用 Chrome MCP 截图。详见 [chrome-mcp.md](references/chrome-mcp.md)

```typescript
// 1. 导航到页面
await mcp__chrome-mcp__navigate_page({
  type: 'url',
  url: pageUrl
});

// 2. 等待渲染
await mcp__chrome-mcp__wait_for({
  text: '关键文本',
  timeout: 10000
});

// 3. 截图
await mcp__chrome-mcp__take_screenshot({
  filePath: `${outputDir}/impl.png`,
  format: 'png'
});
```

**弹窗组件**：需要先触发弹窗再截图，参考 [chrome-mcp.md](references/chrome-mcp.md#弹窗组件截图)

---

## Phase 2: 像素级对比

运行 `scripts/image_diff.py`（推荐使用 `uv run` 自动处理依赖）：

```bash
# 推荐：uv run 自动安装依赖
uv run ~/.claude/skills/visual-diff/scripts/image_diff.py \
  <design.png> <impl.png> \
  --output <output_dir> \
  --threshold 30 \
  --json

# 或手动安装依赖后运行
pip install pillow numpy
python ~/.claude/skills/visual-diff/scripts/image_diff.py ...
```

**输出**：
- `overlay.png` - 半透明叠加图
- `diff_highlight.png` - 差异高亮图
- `comparison.png` - 并排对比图
- `report.json` - 像素差异报告

---

## Phase 3: 双模型语义验证

### 3.1 Gemini 验证

```bash
codeagent-wrapper --backend gemini - ${workdir} <<'EOF'
ROLE_FILE: ~/.claude/prompts/gemini/reviewer.md

对比设计稿和实现截图，分析视觉差异。

设计稿：[附上 design.png]
实现：[附上 impl.png]
像素差异报告：[附上 report.json]

返回 JSON：
{
  "score": 0-100,
  "issues": [
    {
      "element": "元素名称",
      "category": "spacing|color|typography|layout",
      "description": "具体差异描述",
      "severity": "P0|P1|P2"
    }
  ],
  "summary": "整体评价"
}
EOF
```

### 3.2 Claude 验证（当前模型）

读取设计稿和实现截图，独立进行视觉对比分析，输出相同格式的 JSON。

### 3.3 交叉验证

```typescript
// 综合两个模型的评分
const avgScore = (geminiScore + claudeScore) / 2;

// 合并 issues（去重）
const allIssues = mergeIssues(geminiIssues, claudeIssues);

// 判定
const verdict =
  pixelDiff.verdict === 'PASS' && avgScore >= 80 ? 'PASS' :
  pixelDiff.verdict !== 'FAIL' && avgScore >= 70 ? 'REVIEW' : 'FAIL';

const confidence =
  Math.abs(geminiScore - claudeScore) < 10 ? 'HIGH' : 'MEDIUM';
```

---

## Phase 4: 输出报告

### 输出文件

```
{outputDir}/
├── design.png          # 设计稿截图
├── impl.png            # 实现截图
├── overlay.png         # 叠加图
├── diff_highlight.png  # 差异高亮图
├── comparison.png      # 并排对比图
└── report.json         # 综合报告
```

### 报告格式

详见 [diff-report.md](references/diff-report.md)

```json
{
  "pixel_diff": {
    "overall_diff_percentage": 3.45,
    "verdict": "PASS"
  },
  "gemini_review": {
    "score": 85,
    "issues": [...]
  },
  "claude_review": {
    "score": 88,
    "issues": [...]
  },
  "final_verdict": "PASS",
  "confidence": "HIGH"
}
```

### 判定标准

| 条件 | verdict | confidence |
|------|---------|------------|
| pixel PASS + 双模型 ≥80 | ✅ PASS | HIGH |
| pixel PASS/REVIEW + 任一模型 ≥70 | ⚠️ REVIEW | MEDIUM |
| 其他 | ❌ FAIL | LOW |

---

## 与 figma-ui 衔接

### 作为 Phase C 扩展

figma-ui 完成编码后，可自动调用 visual-diff：

```typescript
// figma-ui Phase C 完成后
if (enableVisualDiff) {
  // 获取设计稿截图（已缓存）
  const designPath = `.claude/cache/figma-ui/${nodeId}/design.png`;

  // 调用 visual-diff
  await visualDiff({
    url: testPageUrl,
    design: designPath,
    selector: '.dialog-container'
  });
}
```

### 独立调用

```
/visual-diff http://localhost:3000/test/demo-dialog --design ./design.png
```

---

## 故障排查

### Chrome MCP 连接失败

确保 Chrome DevTools MCP 已配置：
```bash
claude mcp add chrome-mcp --url http://127.0.0.1:9222/mcp
```

### 截图尺寸不匹配

使用 `resize_page` 调整视口：
```typescript
await mcp__chrome-mcp__resize_page({
  width: 1200,
  height: 800
});
```

### 弹窗未完全渲染

增加等待时间或使用 `wait_for` 等待特定元素：
```typescript
await mcp__chrome-mcp__wait_for({
  text: '弹窗标题',
  timeout: 10000
});
```

### 依赖问题

使用 `uv run` 自动处理依赖（推荐）：
```bash
uv run ~/.claude/skills/visual-diff/scripts/image_diff.py ...
```

或手动安装：
```bash
pip install pillow numpy
```
