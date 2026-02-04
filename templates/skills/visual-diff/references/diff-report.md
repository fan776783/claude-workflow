# 差异报告格式

## JSON 报告结构

```json
{
  "design_size": { "width": 1200, "height": 800 },
  "impl_size": { "width": 1200, "height": 800 },
  "threshold": 30,
  "overall_diff_percentage": 3.45,
  "diff_regions": [
    {
      "position": "row2_col3",
      "x": 600,
      "y": 200,
      "width": 300,
      "height": 200,
      "diff_percentage": 12.5
    }
  ],
  "outputs": {
    "overlay": "./diff-output/overlay.png",
    "diff_highlight": "./diff-output/diff_highlight.png",
    "comparison": "./diff-output/comparison.png"
  },
  "verdict": "PASS"
}
```

## 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `design_size` | object | 设计稿尺寸 |
| `impl_size` | object | 实现截图原始尺寸 |
| `threshold` | number | 差异检测阈值 (0-255) |
| `overall_diff_percentage` | number | 总体差异百分比 |
| `diff_regions` | array | 差异区域列表（按差异程度排序） |
| `outputs` | object | 输出文件路径 |
| `verdict` | string | 判定结果 |

## 判定标准

| verdict | 条件 | 说明 |
|---------|------|------|
| `PASS` | diff < 5% | 还原度优秀，可交付 |
| `REVIEW` | 5% ≤ diff < 15% | 需人工审查 |
| `FAIL` | diff ≥ 15% | 还原度不足，需修复 |

## 差异区域分析

图片被分为 4x4 网格（16 个区域），每个区域独立计算差异：

```
┌─────────┬─────────┬─────────┬─────────┐
│ row1    │ row1    │ row1    │ row1    │
│ col1    │ col2    │ col3    │ col4    │
├─────────┼─────────┼─────────┼─────────┤
│ row2    │ row2    │ row2    │ row2    │
│ col1    │ col2    │ col3    │ col4    │
├─────────┼─────────┼─────────┼─────────┤
│ row3    │ row3    │ row3    │ row3    │
│ col1    │ col2    │ col3    │ col4    │
├─────────┼─────────┼─────────┼─────────┤
│ row4    │ row4    │ row4    │ row4    │
│ col1    │ col2    │ col3    │ col4    │
└─────────┴─────────┴─────────┴─────────┘
```

只有差异超过 5% 的区域才会被记录，便于定位问题区域。

## 输出文件

| 文件 | 说明 |
|------|------|
| `overlay.png` | 半透明叠加图（设计稿 + 实现） |
| `diff_highlight.png` | 差异高亮图（红色标记差异区域） |
| `comparison.png` | 并排对比图（设计稿 / 实现 / 差异） |
| `report.json` | 结构化报告 |

## 双模型验证报告

当使用双模型验证时，报告扩展为：

```json
{
  "pixel_diff": { /* image_diff.py 输出 */ },
  "gemini_review": {
    "score": 85,
    "issues": [
      {
        "element": "关闭按钮",
        "category": "spacing",
        "description": "右边距偏差约 4px",
        "severity": "P1"
      }
    ],
    "summary": "整体还原度良好，存在少量间距微调"
  },
  "claude_review": {
    "score": 88,
    "issues": [...],
    "summary": "..."
  },
  "final_verdict": "PASS",
  "confidence": "HIGH"
}
```

### 最终判定逻辑

```
pixel_diff.verdict == PASS && gemini_score >= 80 && claude_score >= 80
  → final_verdict: PASS, confidence: HIGH

pixel_diff.verdict == PASS && (gemini_score >= 70 || claude_score >= 70)
  → final_verdict: REVIEW, confidence: MEDIUM

其他情况
  → final_verdict: FAIL, confidence: LOW
```
