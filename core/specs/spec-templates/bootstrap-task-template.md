# 00 Bootstrap Guidelines

> 首任务：把 bootstrap 生成的骨架填成真实规范。对齐 Trellis `create_bootstrap.py` 机制（参见 `.trellis/scripts/create_bootstrap.py`）。

## 本次生成的文件

- Stack: {{stack_name}}
- Packages: {{packages}}
- Layers: {{layers}}
- 生成时间：{{date}}

{{file_list}}

## 核心原则

1. **Document Reality, Not Ideals** — 记录项目真实做法，不是理想规范
2. **2–3 个真实代码例子** — 每个主题文件至少挑 2–3 段本仓库真实代码填入，不要虚构
3. **1 个 anti-pattern** — 每个主题文件至少补 1 个"我们踩过的坑"
4. **每条规则配 Why** — 一句话说明原因即可

## 第一步：从 {{first_package}} 开始（主应用优先）

打开 `{{first_target_file}}`：

1. 找一段本仓库真实代码（推荐近期改过的文件）：
   ```bash
   {{grep_hint}}
   ```
2. 打开其中一个，复制核心片段替换文件里第一条 Rule 的代码块占位（`(To be filled)` / TODO 注释处）
3. 检查默认给的两条 Rule 是否符合项目实际做法，不符合就改
4. Common Mistakes 默认给的是通用反例，换成**项目真的踩过的坑**（看 git log / issue 找一个）
5. 把 `{{first_package}}/{{first_layer}}/index.md` Guidelines Index 里本行 Status 从 `Draft` 改成 `Done`

**首靶子源码目录**：`{{first_target_source_dir}}`
**预计耗时**：10–15 分钟/文件，第一个文件做完后剩下的按套路来。

{{reference_block}}

## 第二步：扩展到剩余 package

{{remaining_packages_block}}

每个包同样改两个文件（core 主题：`{{first_layer}}/{{first_topic}}.md` 和 `directory-structure.md`），套路一致。

## 执行要点

- 保留模板里"可选扩展"注释（不需要全填）
- 每条 Rule 必须配 Why 一句话
- 至少 1 个 Common Mistakes 条目（Bad / Good 对比）
- 完成后在对应 index.md 把该行 Status 从 `Draft` 改为 `Done`

## 验收

- [ ] `{{first_target_file}}` 已填入真实代码 + Why + anti-pattern
- [ ] 对应 index.md 的 Status 列已更新
- [ ] 运行 `/spec-review` 确认无 `no-examples` / `no-rationale` 告警
