# GLOSSARY.md 格式

`GLOSSARY.md` 是 teaching workspace 的 canonical 语言。所有 explainer、练习、learning record 都遵守其术语。建 glossary 本身就是学习:把概念压缩成紧定义,就是用户理解的证据。

## 结构

```md
# {Topic} Glossary

{One or two sentence description of the topic this glossary covers.}

## Terms

**Hypertrophy**:
Muscle growth driven by mechanical tension and metabolic stress over repeated training sessions.
_Avoid_: Bulking, getting big

**Progressive overload**:
Systematically increasing the demand on a muscle over time — via load, volume, or intensity.
_Avoid_: Pushing harder, levelling up

**RPE (Rate of Perceived Exertion)**:
A 1–10 self-rating of how hard a set felt, where 10 is failure and 8 means two reps left in the tank.
_Avoid_: Effort score, intensity rating
```

## Rules

- **只收用户已理解的术语。** glossary 是压缩知识的记录,不是用来学的词典。刚介绍的概念,等用户能正确使用再收。
- **Opinionated。** 同一概念多个说法时选最好的,其余列为 _Avoid_ 别名。这就是语言压缩的方式。
- **定义紧凑。** 一两句。定义它**是**什么,不是它做什么 / 怎么做。
- **定义内部复用 glossary 自己的词。** 术语一旦入 glossary,处处优先用——包括其他定义内部。复杂术语因此更易掌握。
- **自然聚类时分子标题**(如 `## Anatomy`、`## Programming`)。整体内聚就平铺。
- **显式标记歧义。** 领域内用法松散的词,注明本 workspace 的解析:"本 workspace 中 'set' 一律指 working set——热身组单独记。"
- **理解加深时就地修订。** 第一周写的定义到第六周可能就错了。就地更新,不留过期条目。
