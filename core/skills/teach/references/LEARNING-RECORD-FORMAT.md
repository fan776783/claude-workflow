# Learning Record 格式

learning record 放 `./learning-records/`,顺序编号:`0001-slug.md`、`0002-slug.md`…… 目录懒创建——写第一条记录时才建。

它是教学版 ADR:记录非显然的 lesson、关键 insight、用户声明的已有知识,驱动后续 session,用于推算 zone of proximal development。

## 模板

```md
# {Short title of what was learned or established}

{1-3 sentences: what was learned (or what prior knowledge was established), and why it matters for future sessions.}
```

格式就这么多。一条 learning record 可以只有一段。价值在于记下"这件事现在已知" + "它如何改变接下来教什么"——不在填满 section。

## 可选 section

只在真有价值时加,多数记录不需要:

- **Status** frontmatter(`active | superseded by LR-NNNN`)— 早期理解被证伪、被替换时用。
- **Evidence** — 用户如何证明了理解(答对的问题、完成的练习、引述的过往经验)。该论断日后可能被复核时值得记。
- **Implications** — 这条解锁 / 排除了哪些后续内容。非显然时才记。

## 编号

扫 `./learning-records/` 取最大编号 +1。

## 何时写

满足任一:

1. **用户对非平凡内容展示了真实理解** — 不是接触过,是能正确运用的证据。这抬高了后续教学的下限。
2. **用户披露已有知识** — "我已经会 X"。记下来,后续 session 不重教。同时记声明的_深度_。
3. **纠正了一个误解** — 用户之前信错的东西现在明白错在哪。高价值:它预测相关主题的未来 stumbling block。
4. **mission 因学习而移动** — 用户发现自己在乎的和原以为的不同。交叉链接 [[MISSION.md]] 并更新它。

### 不算数的

- 仅仅"讲过"的内容。覆盖 ≠ 学会。等证据。
- `GLOSSARY.md` 已紧凑收录的术语定义。不重复。
- 逐 session 的活动日志。learning record 不是日记——是 decision-grade insight。

## Supersession

后来的记录推翻早期记录时(理解加深或纠偏),旧记录标 `Status: superseded by LR-NNNN` 而非删除。理解如何演化的历史本身就是信号。
