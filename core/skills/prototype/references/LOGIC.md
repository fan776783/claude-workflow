# Logic Prototype

小型 interactive terminal app,让用户手动驱动状态模型。适用于 business logic / state transition / data shape 类问题——纸上看合理,推几个 case 才发现不对。

## 何时用

- "不确定这个状态机能不能处理 X 然后 Y 的情况"
- "这个数据模型真的能表达这个 case 吗?"
- "想感受一下 API 长什么样再正式写"
- 任何"想按按钮看状态变化"的场景

如果问题是"应该长什么样" → 错分支,用 [UI.md](UI.md)。

## 流程

### 1. 写明问题

动手前写下:在验证什么状态模型、回答什么问题。一段话,放 prototype 文件顶部注释或 README。问错问题 = 白做。

### 2. 用项目语言

用 host 项目的语言和工具链。不为 prototype 引入新 runtime 或 package manager。

### 3. 隔离逻辑为纯模块

核心逻辑放在小的、纯的 interface 后面,可以将来直接提取到正式代码中。TUI 是丢弃壳;逻辑模块不是。

合适的形状取决于问题:
- **Pure reducer** — `(state, action) => state`。action 是离散事件、state 是单值时。
- **State machine** — 显式 states + transitions。"当前哪些 action 合法"本身是问题的一部分时。
- **Pure functions over plain data** — 没有隐含当前状态,只是变换。
- **Class/module with method surface** — 逻辑确实拥有持续内部状态时。

保持纯:无 I/O、无 terminal 代码、无 `console.log` 做控制流。TUI import 逻辑并调用;反向不存在。

### 4. 建最薄 TUI

**全屏刷新式 TUI** — 每次 action 后 `console.clear()` 重绘整帧。用户始终看一个稳定视图,不是滚屏。

每帧两部分:
1. **当前状态** — pretty-print,一个字段一行。**bold** 字段名,**dim** 次要信息。
2. **键盘快捷键** — 底部列出:`[a] add user  [d] delete user  [q] quit`

行为:初始化 → 读一个按键 → dispatch → 重绘 → 循环 → quit 退出。整帧一屏内。

### 5. 一条命令可跑

加到项目已有 task runner(`package.json` scripts / Makefile / justfile)。用户跑 `pnpm run <prototype-name>` 即可。

### 6. 交给用户

给用户 run 命令。有趣的时刻是用户说"等等,这不应该发生"或"我以为 X 会不一样"——这些是 idea 里的 bug,整个 prototype 的意义所在。

### 7. 捕获答案

prototype 完成使命后,答案是唯一值得保留的东西。问用户学到了什么;AFK 时留 `NOTES.md`。

## Anti-patterns

- 加测试。需要测试的 prototype 不再是 prototype。
- 连真实数据库。用内存,除非问题就是关于持久化。
- 泛化。不考虑"万一以后要支持 X"。
- 逻辑和 TUI 混在一起。reducer/machine 里出现 `console.log` / prompt / escape code → 不可提取。
- 把 TUI shell 发布到生产。shell 是为手动驱动优化的;逻辑模块才是值得留的。
