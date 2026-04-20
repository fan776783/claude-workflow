# spec-bootstrap 优化方案

> 基于 2026-04-20 reelmate 项目一次真实 bootstrap + 填充的复盘，提出 6 组改动。
> 目标：让 bootstrap 在零引导下产出**可直接动手改**的骨架，而不是"看着占位符不知道填什么"的空壳。

## 真实问题复盘（why 这份方案）

在 reelmate 项目（`project.type=monorepo`、`tech.frameworks=["vue","nuxt"]`、`structure.apps + sharedLibs` 都有声明）第一次跑 `/spec-bootstrap` 时：

1. **没指定 `--stack`** → 默认生成空骨架（`(To be filled)` / `{{reason}}`），没有 Vue/Nuxt 种子规则可参考
2. **包范围爆炸** → 未配 `include` 时自动展开 **17 个包**，含 archived apps（`agent`、`skymedia-app`）和纯配置包（`eslint-config`、`typescript-config`、`oxc`）
3. **没发现** config 里有 `structure.archivedApps` / `structure.auxiliaryApps` 字段可以直接用来过滤
4. **00-task 太抽象** → 写的是"grep 本仓库代码，找 2–3 段典型实现，替换 `(To be filled)`"，用户看完仍不知道从哪个文件开始
5. **Post-bootstrap audit 只报数**（`20/29 含占位符`），不给 call-to-action
6. 用户最后让我代笔填充，但这部分引导本应由 skill 自己产出

结果是 `/spec-bootstrap` 只留下"建了 18 个目录"的价值，真正**把骨架变成规范**的全过程都在 skill 外面发生。

---

## 改动 1：栈推断（高 ROI）

### 现状

`--stack` 不传时完全不拷栈模板，即使 config 里 `tech.frameworks` 明确写了 vue/nuxt。

相关代码：`core/utils/workflow/spec_bootstrap.js:443` `initCodeSpecsSkeleton()` 把 `stack` 当成纯 opt-in 参数。

### 方案

- 在 `resolveLayersForBootstrap` / `initCodeSpecsSkeleton` 之前插入 `resolveStackFromFrameworks(frameworks)`
- 维护 `FRAMEWORK_TO_STACK` 映射：
  ```js
  const FRAMEWORK_TO_STACK = {
    vue: 'vue-nuxt', nuxt: 'vue-nuxt',
    react: 'react-next', next: 'react-next',
    express: 'node-express', fastify: 'node-express', nest: 'node-express',
  }
  ```
- 决策优先级：`--stack` 显式传参 > frameworks 推断 > `generic` > 无（空骨架）
- 在 result 里回报 `stackSource: 'explicit' | 'inferred' | 'fallback' | 'none'`，让 skill 输出"已自动选择栈 vue-nuxt（来自 tech.frameworks），要空骨架请加 --no-stack"

### 影响文件

- `core/utils/workflow/spec_bootstrap.js`（新增 20-30 行）
- `core/skills/spec-bootstrap/SKILL.md`（改用法表格）

### 兼容性

增量：`--stack` 显式传入时行为不变；老用户想回到"空骨架"显式传 `--no-stack`。

---

## 改动 2：monorepo 包范围交互式圈定（高 ROI）

### 现状

`resolvePackages()`（`spec_bootstrap.js:293`）在 `codeSpecs.packages.include` 缺失时自动展开所有 workspace，仅返回一条 `warning` 字符串，但 CLI 照样执行。结果：reelmate 展开 17 个包，其中 8 个是 archived/auxiliary/config-only。

### 方案（两段式）

**A. 默认过滤器**（CLI 自动做，不需要交互）

读取 `config.structure` 下这些字段并自动从 `detectWorkspacePackages()` 结果里排除：

- `structure.archivedApps[]`
- `structure.auxiliaryApps[]`
- 匹配 `*-config` / `*-preset` 的包（可通过 `codeSpecs.packages.configPackagePatterns` 覆盖）

**B. 交互确认模式**（skill 层做，CLI 通过 flag 启用）

- 新增 `--interactive` flag（默认开启，CI/非 TTY 环境自动关闭）
- CLI 返回 `pendingPackages: { included: [...], autoExcluded: { archived: [], auxiliary: [], configOnly: [] } }`
- skill 读到 pending 后用 `AskUserQuestion` 让用户确认：
  ```
  检测到 17 个 workspace 包，建议纳管其中 9 个：
  ✓ reelmate, api, httpx, store, ui, utils, hooks, tracking, filex
  自动过滤：
    - archivedApps: agent, skymedia-app
    - auxiliaryApps: i18n-admin, i18n-admin-ui
    - config-only: eslint-config, typescript-config, oxc, langs
  确认 / 调整 / 全选
  ```
- 用户确认后 skill 自动把最终 include 写回 `project-config.json.codeSpecs.packages.include`

### 影响文件

- `core/utils/workflow/spec_bootstrap.js:293` 新增 `applyDefaultFilters()`
- `core/skills/spec-bootstrap/SKILL.md` 加交互决策表
- 新增测试：有 archivedApps 时默认过滤生效

### 兼容性

- 已配 `include` 的项目完全不受影响（最高优先级）
- 默认过滤器可通过 `codeSpecs.packages.skipDefaultFilters: true` 关闭

---

## 改动 3：00-task 具体化（高 ROI）

### 现状

`buildDefaultBootstrapTask()`（`spec_bootstrap.js:664`）和 `core/specs/spec-templates/bootstrap-task-template.md` 都是抽象步骤，核心问题：

- 不说从**哪个包**的**哪个文件**开始
- 不说 grep **什么关键词**找代码样本
- 不说 "what good looks like"——用户没有参考案例

### 方案

**A. 生成具体"首个任务"清单**

修改 `writeBootstrapTask()`，根据 `packages` / `layers` / `stack` 构造：

```md
## 第一步：从 reelmate 开始（主应用优先）

打开 `.claude/code-specs/reelmate/frontend/component-guidelines.md`：

1. 找一个本仓库真实组件：
   grep 命令参考：`grep -rl "<script setup lang=\"ts\">" apps/reelmate/components/ | head -3`
2. 打开其中一个（推荐近期改过的），复制 `<script setup>` 段的前 20 行
3. 用它替换文件里第一条 Rule 的 `<!-- TODO -->` 代码块
4. 看看默认的两条 Rule（`<script setup>` / props+emits）是否符合项目实际做法，不符合就改
5. Common Mistakes 默认给的是通用反例，换成**项目真的踩过的坑**（看 git log / issue 找一个）
6. 把 `reelmate/frontend/index.md` Guidelines Index 里本行 Status 从 `Draft` 改成 `Done`

**预计耗时**：10–15 分钟/文件

## 第二步：扩展到剩余 N 个 package

剩余 packages 按优先级排序：
1. api (后端接口)
2. httpx, store, ui (基础设施)
3. utils, hooks, tracking, filex (工具层)

每个包同样改两个文件（component-guidelines / directory-structure），套路一致。

## 样例可参考

`.claude/code-specs/{firstPackage}/frontend/component-guidelines.md` 里预置的两条 Rule + Bad/Good 对比可作为格式参考——保留有道理的，替换掉不符合项目实际的。
```

**B. 按 package 重要度排序**

根据 config 线索推"主应用优先"顺序：

- `config.apps.*.isMainApp: true` 的排最前
- `config.apps.*.status: 'active'` 的排其次
- `sharedLibs` 按 `customPaths` 被引用次数排序（被引用越多越先填）
- 没线索就字母序

**C. 首个靶子文件选择**

如果 `--stack` 命中 → 首个靶子是栈 core 列表第一项（vue-nuxt: `component-guidelines`）。
没 stack → fallback 到 `directory-structure`（任何项目都有目录可填）。

### 影响文件

- `core/utils/workflow/spec_bootstrap.js:636-703`（writeBootstrapTask + buildDefaultBootstrapTask 重写）
- `core/specs/spec-templates/bootstrap-task-template.md` 同步改
- 新增 `computePackageFillOrder({ config, packages })` 辅助函数

### 兼容性

只改任务文件内容，不改签名；已有项目再跑 `--reset` 即可拿到新版。

---

## 改动 4：栈模板带"参考范例"文件（中 ROI）

### 现状

栈模板里的 `component-guidelines.md` 已经给了 2 条 Rule + 1 个 Bad/Good（很好），但用户还是不知道"填完应该长什么样"——占位符 `{{reason}}` / `(To be filled)` 没有参考值。

### 方案

在每个栈模板下增加 `_reference/` 目录，存**已经填满的完整范例**（用通用场景如 todo-list / blog）：

```
core/specs/stack-templates/vue-nuxt/
├── manifest.json
├── frontend/
│   ├── component-guidelines.md        # 当前骨架（保留）
│   ├── directory-structure.md
│   └── index.md
└── _reference/                        # 新增
    ├── component-guidelines.md        # 完整范例（todo-list 场景，所有占位符都填满）
    └── directory-structure.md
```

- Bootstrap 生成时**不拷贝** `_reference/`，但在 00-task 里加一句："参考范例见 `<agent-workflow>/core/specs/stack-templates/vue-nuxt/_reference/component-guidelines.md`"
- 范例文件里用 markdown 注释标出"这里我写了 Why，你也要写一句类似的"等元标签，帮用户 mimic

### 影响文件

- 新增 `core/specs/stack-templates/{generic,vue-nuxt,react-next,node-express}/_reference/`
- `copyStackLayerFiles()` 加 `_reference/` 排除逻辑（或复用"非 md 不拷"的既有 guard）
- 00-task 模板增加"参考范例"段

### 兼容性

纯增量，不动既有骨架。

---

## 改动 5：Post-bootstrap 输出 call-to-action（中 ROI）

### 现状

CLI 返回 `emptyTemplateAudit: { total: 29, withPlaceholders: 20, files: [...] }`，skill 输出 `"📋 Post-bootstrap audit: 20/29 个骨架文件仍含占位符"`。就结束了。

### 方案

CLI 增量返回 `nextActions`：

```json
{
  "nextActions": {
    "primary": {
      "type": "open-file",
      "path": ".claude/tasks/00-bootstrap-guidelines.md",
      "hint": "按任务书第一步从 reelmate 开始"
    },
    "firstTargetFile": ".claude/code-specs/reelmate/frontend/component-guidelines.md",
    "grepHint": "grep -rl '<script setup lang=\"ts\">' apps/reelmate/components/ | head -3",
    "estimatedTimePerFile": "10-15min",
    "commitHint": "git add .claude/code-specs/ .claude/tasks/ .claude/config/project-config.json && git commit"
  }
}
```

Skill 把这些作为**最后一段**结构化输出到对话：

```
✅ 骨架已生成（18 个文件），应用栈：vue-nuxt
📋 仍含占位符：20 / 29（正常起点）

▶ 下一步
  1. 打开 .claude/tasks/00-bootstrap-guidelines.md（含具体步骤）
  2. 首个靶子：reelmate/frontend/component-guidelines.md
  3. 找代码样本：grep -rl '<script setup lang="ts">' apps/reelmate/components/ | head -3
  4. 预计 10–15 分钟/文件
  5. 填完第一个再把剩余 8 个包按类似节奏处理
  6. 完成后：git add .claude/code-specs/ .claude/tasks/ && git commit
```

### 影响文件

- `core/utils/workflow/spec_bootstrap.js:main()` 组装 nextActions
- `core/skills/spec-bootstrap/SKILL.md` 增加"Final Output Format"段

### 兼容性

纯新增字段，老 skill 忽略即可。

---

## 改动 6：`--reset` 不残留旧状态（低 ROI，但避免诡异 bug）

### 现状

`--reset` 只 `rmTree(baseDir)`（`spec_bootstrap.js:190` + 调用点），不清 `project-config.json.codeSpecs.*` 里的旧字段。实际使用中发生过 `bootstrapStatus: done` 残留、后续 `updatedAt` 覆盖的情况，目前没出 bug 只是运气好。

### 方案

`--reset` 流程内：

1. rmTree `.claude/code-specs/`
2. 删除 `.claude/tasks/00-bootstrap-guidelines.md` 及 `.claude/tasks/spec-bootstrap/` 子目录
3. 清空 `project-config.json.codeSpecs` 里除 `packages`（用户手工配的）之外的所有字段
4. 重跑 init 流程写新状态

### 影响文件

- `spec_bootstrap.js:rmTree()` 附近新增 `resetBootstrapState()`
- 测试：reset 后 config 里没有残留字段

### 兼容性

- `--reset` 本来就是破坏性操作，用户已知情
- 用户手工配的 `packages.include` 保留不动

---

## 优先级建议

推荐按顺序落地：**3 → 2 → 1 → 5 → 4 → 6**

- 3（00-task 具体化）：ROI 最高，纯文档层改动，不碰架构
- 2（交互式圈定 + 默认过滤）：解决"包范围爆炸"这一最常见踩坑
- 1（栈推断）：零配置用户体验跃迁
- 5（call-to-action）：把已生成的元信息利用起来
- 4（参考范例）：内容成本较高（每个栈要写一份完整范例），单独迭代
- 6（reset 清理）：现实影响小，有空再做

## 可验证指标

目标：新用户第一次跑 `/spec-bootstrap`（不传任何参数，项目有 `project-config.json`），**无需追问**即能：

- [x] 自动识别栈并拷模板
- [x] 自动排除 archived / auxiliary / config-only 包
- [x] 拿到带具体文件名 + grep 命令的首任务
- [x] 看到首个靶子文件和样例范例路径
- [x] 填完一个文件后能按模板节奏推进剩余

衡量方式：在 3 个项目（reelmate、纯 React 单包、纯 Node 后端）跑 bootstrap，统计"用户第一条追问是什么"——目标是前两个问题（怎么指定栈 / 哪个包先填）彻底消失。
