---
description: 快速功能开发工作流 - 3步快速开发新功能
argument-hint: "\"功能描述\""
allowed-tools: SlashCommand(*), Task(*), Read(*), Write(*), Edit(*), Grep(*), Glob(*), Bash(*)
examples:
  - /workflow-quick-dev
    "添加用户头像上传功能"
  - /workflow-quick-dev
    "实现文件导出为 PDF"
  - /workflow-quick-dev
    "添加快捷键支持"
---

# 快速功能开发工作流

适用于中小型功能的快速开发，强调效率和实用性。

**适用场景**：
- ✅ 功能需求明确，无需复杂需求分析
- ✅ 开发周期 < 1天
- ✅ 代码变更 < 500 行
- ✅ 已有类似实现可参考

**不适用场景**：
- ❌ 复杂的架构设计需求
- ❌ 跨多个应用的大型功能
- ❌ 需要详细需求拆解

**配置依赖**：`.claude/config/project-config.json`（自动读取项目配置）

**工作目录**：从配置自动读取（`project.rootDir`）

---

## 🚀 3 步快速开发流程

### 第 1 步：快速上下文加载（必须）

```bash
/context-load "功能描述"
```

**目标**：
- 快速了解相关代码结构
- 识别可复用组件和工具函数
- 明确集成点和技术约束

**输出**：结构化上下文包（相关文件、集成点、约束）

**时间**：1-2 分钟

---

#### 1.1 用户确认（发现歧义时必做）⭐

**触发条件**（满足任一条件即需确认）：
- ✅ 发现多个功能相似的文件（需确认具体修改哪个）
- ✅ 发现多个可复用组件（需确认使用哪个）
- ✅ 需求描述不够明确（需确认具体意图）

**使用 AskUserQuestion 工具快速确认**：

```typescript
// 示例：确认组件选择
AskUserQuestion({
  questions: [{
    question: "发现两个上传组件，请选择要使用的？",
    header: "组件选择",
    multiSelect: false,
    options: [
      {
        label: "UI库/FileUploader",
        description: "通用文件上传，支持多文件"
      },
      {
        label: "UI库/ImageUploader",
        description: "图片上传，支持裁剪"
      }
    ]
  }]
})
```

**确认原则**：
- ✅ **快速决策**：仅在真正有歧义时确认，避免打断开发流程
- ✅ **选项精简**：最多提供 2-3 个选项，描述简洁明了
- ✅ **优先推断**：如果有明显最佳选择，可直接使用（并在注释中说明理由）

**时间**：< 1 分钟

---

### 第 2 步：探索与实现（核心）

#### 2.1 探索现有实现（推荐）

```bash
/explore-code
探索 {相关功能} 的实现模式
```

**目标**：
- 学习项目中类似功能的实现方式
- 识别可复用的代码模式
- 避免重复造轮子

**跳过条件**：
- 已经非常熟悉相关代码
- 是全新的功能类型

**时间**：2-5 分钟

#### 2.2 快速实现

基于上下文和探索结果，直接编码实现：

**实现要点**：
- ✅ 复用 context-load 识别的组件
- ✅ 遵循 explore-code 发现的模式
- ✅ 保持代码简洁，优先可工作的方案
- ✅ 添加必要的简体中文注释

**编码原则**：
```typescript
// ✅ 优先使用项目现有组件（从配置读取 UI 组件库路径）
import { FileUploader } from '<UI组件库>';

// ✅ 复用现有工具函数
import { uploadToServer } from '@/utils/upload';

// ✅ 遵循项目约定
const handleUpload = async (file: File) => {
  // 实现逻辑
};
```

**时间**：主要开发时间

---

### 第 3 步：快速验证（必须）

#### 3.1 功能测试（手动或自动）

**手动测试**：
- 正常流程测试
- 边界条件测试
- 错误处理测试

**自动测试**（推荐）：
```bash
/write-tests
为 {功能名称} 编写单元测试
```

**时间**：5-10 分钟

#### 3.2 代码质量检查（可选）

根据功能类型选择：

**UI 组件**：
```bash
/review-ui
审查 {组件名称} 的设计和实现
```

**API 调用**：
```bash
/review-api
审查 {模块名称} 的 API 调用
```

**埋点需求**：
```bash
/review-tracking
检查 {功能} 的埋点完整性
```

**时间**：3-5 分钟

---

## 📋 完整示例：添加用户头像上传

### Step 1：加载上下文
```bash
/context-load "添加用户头像上传功能"
```

**返回**：
- 相关文件：`<UI组件库>/FileUploader.tsx`、`<API模块>/user.ts`
- 集成点：用户设置页面
- 可复用组件：`FileUploader`、`uploadToServer`
- 约束：文件大小 < 5MB，仅支持 jpg/png

### Step 2：探索与实现

**2.1 探索现有实现**：
```bash
/explore-code
探索项目中文件上传的实现模式
```

**发现**：
- 已有 `FileUploader` 组件支持拖拽上传
- `uploadToServer` 工具函数处理上传逻辑
- 需要在上传前进行图片裁剪

**2.2 快速实现**：
```typescript
// src/components/UserSettings/AvatarUpload.tsx
import { FileUploader } from '<UI组件库>';
import { uploadToServer } from '@/utils/upload';
import { updateUserAvatar } from '<API模块>';

export const AvatarUpload = () => {
  const handleUpload = async (file: File) => {
    // 验证文件类型和大小
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      throw new Error('仅支持 JPG/PNG 格式');
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new Error('文件大小不能超过 5MB');
    }

    // 上传到服务器
    const url = await uploadToServer(file);

    // 更新用户头像
    await updateUserAvatar({ avatarUrl: url });
  };

  return (
    <FileUploader
      accept="image/jpeg,image/png"
      maxSize={5 * 1024 * 1024}
      onUpload={handleUpload}
    />
  );
};
```

### Step 3：验证

**3.1 编写测试**：
```bash
/write-tests
为 AvatarUpload 组件编写单元测试
```

**3.2 UI 审查**：
```bash
/review-ui
审查 AvatarUpload 组件的设计
```

**总耗时**：约 20-30 分钟（不含主要编码时间）

---

## ⚡ 效率提升技巧

### 1. 预加载常用上下文

如果经常开发某类功能，可以先运行：
```bash
/context-load "常见功能类型"
```
保存上下文包供后续参考。

### 2. 建立个人代码片段库

将 explore-code 发现的有用模式记录到：
- `.claude/code-patterns.md`（项目级）
- `~/.claude/snippets/`（个人级）

### 3. 并行执行

在等待 context-load 时，可以：
- 手动浏览相关代码
- 准备测试用例
- 设计数据结构

### 4. 跳过非必要步骤

**可以跳过 explore-code 的情况**：
- 功能类型完全不同
- 已经很熟悉实现方式
- 时间紧急且风险可控

**可以简化测试的情况**：
- 非核心功能
- 临时性功能
- 已有充分的手动测试

---

## 🎯 质量保证清单

即使是快速开发，也要确保：

- [ ] **功能完整性**：核心功能正常工作
- [ ] **错误处理**：处理了主要错误场景
- [ ] **类型安全**：TypeScript 类型正确
- [ ] **代码规范**：遵循项目 CLAUDE.md 规范
- [ ] **用户体验**：加载状态、错误提示
- [ ] **埋点（如需要）**：添加必要的埋点
- [ ] **简体中文**：所有注释和提示使用简体中文

---

## 🔄 与完整开发流程的区别

| 维度 | 快速开发工作流 | 完整开发流程 |
|------|---------------|-------------|
| **需求分析** | 跳过（需求明确） | /analyze-requirements |
| **上下文加载** | ✅ 必须 | ✅ 必须 |
| **代码探索** | 可选（推荐） | 必须 |
| **架构评估** | 跳过 | /architect-review |
| **实现** | 直接编码 | 详细设计 → 编码 |
| **测试** | 简化（核心场景） | 完整测试覆盖 |
| **审查** | 可选（单项） | 必须（多维度） |
| **时间** | < 1小时 | 几小时到几天 |

---

## 📌 何时升级到完整流程

遇到以下情况时，应该切换到完整开发流程：

1. **复杂度超预期**：发现需要重大架构改动
2. **依赖不明确**：需要深入分析依赖关系
3. **风险较高**：影响核心业务逻辑
4. **需求不清晰**：需要详细需求拆解
5. **测试复杂**：需要复杂的 mock 和集成测试

**升级方式**：
```bash
# 暂停快速开发，切换到完整流程
/analyze-requirements  # 重新分析需求
/architect-review      # 获取架构建议
# 继续完整的开发流程...
```

---

## 💡 最佳实践

1. **优先复用**：充分利用 context-load 识别的可复用组件
2. **保持简单**：不要过度设计，优先可工作的方案
3. **渐进优化**：先实现核心功能，后续迭代优化
4. **记录决策**：重要决策添加注释说明
5. **及时测试**：编写一段测试一段，避免累积问题
6. **快速反馈**：优先手动测试验证，再补充自动测试

---

**相关工作流**：
- `/workflow-ui-restore` - UI 还原工作流（设计稿还原）
- `/workflow-start` - 智能工作流启动（完整开发流程）
- 完整开发流程 - 见 `/agents` 工作流指南
