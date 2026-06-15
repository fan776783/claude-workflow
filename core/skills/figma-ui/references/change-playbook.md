# Change Playbook — CHANGE_ARTIFACT 详细执行

> 修改已有页面/组件的专用路径（ADR-0005）。核心思想：**把漏改从"截图目测要碰巧看见"变成"账本对不上 = gate failure"**。Codemod 纪律：enumerate-first → transform → verify-residue。
>
> 本文件覆盖 Phase B.0（修改点全量枚举）与 Phase C 的 CHANGE 分支对账门。CREATE_ARTIFACT（新建页面）不走本文件，见 `playbook.md`。

---

## 输入

- Design Package（`taskType=CHANGE_ARTIFACT`，含 **DesignInventory** — 元素级 7 维设计值清单 + state variants，纯设计侧）
- 用户指名的目标文件/页面 + 口头变更描述

## Phase B.0: 构建 ChangeManifest（编码前必经，Gate 强制）

ChangeManifest 可 inline（在 context 内维护）或落 `taskDir/change-manifest.md`，二选一——账本内容（entries / sites / residue / searchLog / status）必须完整，载体不限。三步构建：

### B.0.1 Delta sweep（设计 vs 代码，抓"未提及 delta"）

对照 DesignInventory **逐元素逐维度**与现有代码比对：

- `designValue ≠ codeValue` → 生成 entry；相等 → 丢弃（可记为锚点行）
- **逆向 pass**：代码目标区域内存在、但修订后设计中消失的元素 → `changeType: removed` 候选
- 用户口头没提到的 delta **照收**，标 `mentionedByUser: false` —— 这是最高频漏改类（漏改 ⑥），sweep 不完整 = gate fail
- codeValue 定位不到 → 记 `codeValue: unlocated`，**不编造、不丢弃**，C.1Δ 中保持 P0 直到解决或用户豁免

### B.0.2 编辑点枚举 — 6 条搜索 recipe

每个 entry 的 `sites[]` 来自以下 recipe。**每条 recipe 必须执行并在 searchLog 记录 query + hit 数**；【硬】recipe 缺失记录 = Gate B.0 不通过；【advisory】recipe 可记 `N/A + 原因`。

| # | Recipe | 等级 | 抓什么漏改 |
|---|--------|------|-----------|
| R1 | 被改组件的 import + tag 引用全量 grep | **硬** | 共享组件其他实例（漏改 ①） |
| R2 | 旧值字面量（`24px` / `#3366FF` / 资源文件名）跨 css/scss/less/vue/tsx + token 文件 | **硬** | 跨文件复制、层分裂、JS 镜像常量 |
| R3 | token 链：旧值绑定 token/CSS 变量时（对照 DesignInventory 变量绑定标记）grep token 名 → 消费者清单 | **硬** | 多层样式分裂（漏改 ⑤），强制"改 token 一次 vs 组件局部覆盖"路由决策 |
| R4 | `@media` / `sm:` / `md:` / `lg:` / `*.mobile.*` 中被改属性的重复声明 | **硬** | 响应式断点（漏改 ④） |
| R5 | `:hover` / `:focus` / `:active` / `:disabled` / Tailwind `hover:` 中被改选择器 | advisory | 伪状态样式 |
| R6 | 变更区域的结构 class 名 + 可见文本，在涉及文件与 skeleton/empty/error 组件、`v-if`/`v-else` 分支中 grep | advisory | 同页重复 markup、条件分支孪生 |

**比例规则**（防全 app 审计）：

- 搜索只从 delta 标识符出发（组件名 / 选择器 / 字面量 / token 名 / 资源文件名），不做开放式扫描
- **scope tiers**：tier-1 = 涉及文件 + 其 importers；tier-2 = token / 全局样式层文件；全仓 grep 仅限高信号字面量（hex 色值、token 名、资源文件名、组件名）——**禁止裸数字（`16px`）全仓 grep**
- **>30 hits 收窄**：按文件类型 / 共现条件收窄，或降级为对已列文件逐个检查；收窄决策记入 searchLog

**mobile-frame 追取**：R4 命中 `@media` 规则但 DesignInventory 无对应断点设计值 → 不猜测，向用户结构化索要 mobile frame 的 node-id，一次 `figma.mjs design --nodeId <id> --taskType CHANGE_ARTIFACT` 补取后再继续。同理适用于 R5 命中但无 state variant 设计值时。

### B.0.3 传播决策

`sites[]` 中存在组件定义 / token 定义、且其消费者超出目标页面 → 该 entry 必须显式选择：

| 决策 | 含义 |
|------|------|
| `propagate-all` | 全局生效，每个页外消费者变为验证行 |
| `scoped` | fork 局部变体 / 覆盖，页外消费者不动 |
| `ask-user` | 无法判断 → 进 Hard Stop |

### ChangeManifest 格式

```markdown
## entries
| id | element | property | changeType | designValue | codeValue | layer | mentionedByUser | propagation |
|----|---------|----------|-----------|-------------|-----------|-------|------------------|-------------|
| D1 | CardHeader | padding | modified | 16px 24px | 24px (Card.vue:88) | component-local | true | scoped |

## sites（每 entry 一组）
| entry | file:line | kind | action |
|-------|-----------|------|--------|
| D1 | Card.vue:88 | base | edit |
| D1 | Card.vue:132 | media:768px | edit |
| D1 | overrides.scss:12 | cascade-override | edit |

kind ∈ base | usage | media:<bp> | state:<s> | theme | token-def | js-const | asset-ref
action ∈ edit | skip(+reason) | ask-user

## residue（编码前定死，C.2a 消费）
| entry | pattern | scope | preCount |
|-------|---------|-------|----------|
| D1 | `padding: 24px` | Card.vue + overrides.scss | 3 |

## searchLog（硬 recipe 缺行 = gate fail）
| recipe | query | hits | 备注 |
|--------|-------|------|------|
| R1 | `import.*Card|<Card` | 4 | |
| R5 | N/A | - | 项目无伪状态样式（Tailwind 无 hover: 命中） |

## status: draft | confirmed
```

`layer ∈ token | global | component-local | inline | js-constant`；`changeType ∈ modified | added | removed`。

### Gate B.0 → Hard Stop / auto-pass

触发 Hard Stop（按 `core/specs/shared/hard-stop-templates.md` Gate 1 形式，**一次性列全表**）当存在任一：

- `mentionedByUser: false` entry（sweep 发现用户没提的 delta）
- `removed` 候选
- `propagation: ask-user` 或 `codeValue: unlocated`

表格默认值（ADR-0005 Decision 3）：

| 类别 | 默认 |
|------|------|
| 用户指名节点**内**的 delta | ✅ in-scope（预勾选） |
| 指名节点**外**的 delta | ❓ ask（列出不勾选） |
| `removed` 候选 | ❌ 不删（删错代价 > 多留），需用户显式勾选 |

用户确认后 `status: confirmed`。被用户排除的 entry 改 `out-of-scope` **保留在 manifest 中**（审计可追溯），不物理删除。

**auto-pass**：零未提及 delta + 零 removal + 零 ask-user + 零 `codeValue: unlocated` → 不停，`status: confirmed` 直接落盘（局部小改动近零摩擦）。

### Phase B.1 编码纪律

- 严格按 `sites[]` 执行；同一 entry 的 sites **全改或全不改**（禁止只改第一处）
- 编码中途发现新 site → **先补 manifest 行（标注 `discovered-mid-edit`）再编辑**，manifest 是唯一事实源
- 资源消费约束不变（AssetPlan inline/promote，见 `playbook.md`）

---

## Phase C: CHANGE 分支对账门

**C.0 模式陷阱**（Phase C 入口，无条件执行）：检查**本次任务编辑的文件集合**（任务 diff 范围；不要用全仓 `git status` 代替——工作区原有的无关脏文件不计入，参照 diff-review 的同类纪律）。集合内存在已有 UI 文件被实质修改但 `taskType !== "CHANGE_ARTIFACT"` → 模式误判。豁免：CREATE 任务固有的接线性改动（路由注册、barrel/index export、AssetPlan promote 移动）不算误判证据。恢复路径：**先以 `--taskType CHANGE_ARTIFACT` 重跑 figma-data 补产 DesignInventory**（B.0.1 依赖它），再回 Phase B.0 补建 ChangeManifest，之后才进任何 C 检查。触发条件是文件系统证据，不依赖上游判断。

**C.1Δ Delta 覆盖对账**（取代 CHANGE 模式下的全树 ElementManifest 检查）：每个 entry 必须终结于且仅于一个状态：

| 终态 | 要求 |
|------|------|
| `applied` | 全部 sites 的 file:line + 新值 |
| `verified-unchanged` | 比对后确认无需改 + 理由 |
| `out-of-scope` | Hard Stop 中的用户决定（有记录） |
| `unresolved` | **P0，不可交付** |

`removed` 候选同样逐条闭环：`removed` / `legacy-keep + reason` / `user-deferred`。

**C.1.5 数值锚点比对**：机械比对表机制不变（见 `playbook.md` C.1.5），比对域从根容器扩为 **ChangeManifest 全部 entry × sites**——逐 site 重读编辑后代码值 vs designValue，severity 沿用 `visual-review.md` 分级阈值。

**C.2a 残值清零**（codemod 纪律）：对每个 entry 用 **B.0 时定死的** residue pattern（防事后挑模式自证）：

```text
preCount（编码前） → afterCount（编码后）
期望 afterCount = 0（或 = 显式 skip 的 sites 数）
不归零且无逐条 justify → P0
```

对账结果记录在案——inline 或落 `taskDir/_residue.md`，二选一。巧合命中（无关代码恰好同值）逐条 justify，禁止批量豁免。

**C.2b Diff 双射**：`git diff` 的每个 hunk 必须映射到 ChangeManifest entry / propagation 决策 / AssetPlan action 之一。未映射 hunk = **scope creep，P0** 直到 justify。覆盖结果记录在案——inline 或落 `taskDir/_coverage.md`，二选一。

> ⚠️ **清 scope creep 只能定向 re-edit，绝不用破坏性 git 命令。** 工作树常带本任务之外的未提交存量改动（session 起始就 `M` 的文件）；对整个文件 `git checkout <file>` / `git restore <file>` / `git stash` 会**连存量一起抹掉**。撤销多余 hunk（典型来源：whole-file formatter 重排）靠针对性 Edit 还原那几行，或从编辑前已读到的原始内容重写目标文件再 `diff` 自校验。延伸防线：不对"本就不符合 formatter 风格"的文件做整文件格式化——只动你改的那几行，避免一开始就制造 scope creep。

**C.5 交付摘要**：必须报告对账的实际结果——entry 终态统计 + 残值对账数字 + diff 双射结论。这些数字来自 C.1Δ / C.2a / C.2b 实跑，inline 或落盘均可；**对账没真跑 = 数字填不出 = 不可交付**。落盘文件可选，跑过对账不可选。

其余（Visual Review、修复循环 ≤3 轮、交付决策）沿用 `playbook.md` Phase C。

---

## Red Flags

| 念头 | 修正 |
|------|------|
| "用户就让改 header，footer 的 delta 不用管" | 回 B.0.1，未提及 delta 标 `mentionedByUser: false` 进 Hard Stop，由用户决定 |
| "先改了再说，manifest 后补" | 回 B.0，编码前 manifest 必须 `confirmed` |
| "R1 查到 4 个引用，先改眼前这个" | 同 entry sites 全改或全不改；其余实例进传播决策 |
| "residue 还剩 2 个命中，应该是巧合" | 逐条 justify（inline 或 `_residue.md`），禁止批量豁免 |
| "这个 hunk 是顺手优化的，不用进 manifest" | C.2b 未映射 hunk = scope creep P0 |
| "diff 混进 formatter 整文件重排，`git checkout` 撤掉就行" | 脏树上 checkout/restore/stash 会抹未提交存量；定向 re-edit 还原那几行，整文件格式化只在文件本就 formatter-conformant 时做 |
| "@media 里的值设计稿没给，按比例缩一个" | 不编造，向用户索要 mobile frame node-id 补取 |
| "16px 全仓 grep 三千个结果，全列进 sites" | 违反 scope tiers，裸数字禁全仓；按 tier-1/tier-2 收窄 |
