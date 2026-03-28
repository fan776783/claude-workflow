# -*- coding: utf-8 -*-
"""
Workflow Skill Python 工具库

从 workflow SKILL.md 的 TypeScript 伪代码中提取出的确定性逻辑，
转化为可独立运行、可测试的 Python 脚本。

设计原则（参考 Trellis .trellis/scripts/common/）:
  1. 每个脚本支持 CLI 模式（python3 xxx.py command --args）
  2. 所有脚本返回 JSON 输出（方便 AI 解析）
  3. 跨平台兼容（Windows + Unix）
  4. 零外部依赖（仅 Python 3.8+ 标准库）
"""

__version__ = "0.1.0"
