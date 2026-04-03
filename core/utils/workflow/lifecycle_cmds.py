#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
workflow 生命周期命令 helper。

收敛 start / delta / archive / unblock 的确定性逻辑，
供 workflow_cli.py 作为统一入口调用。
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from path_utils import get_workflow_state_path, get_workflows_dir, validate_project_id
from plan_delta import apply_task_deltas, build_task_delta_examples, create_delta_artifacts, summarize_task_deltas, to_pretty_json
from state_manager import (
    mark_dependency_unblocked,
    read_state,
    record_delta_change,
    update_discussion_record,
    update_user_spec_review,
    update_ux_design_record,
    write_state,
)
from task_manager import detect_project_id, detect_project_root, resolve_state_and_tasks
from task_parser import parse_tasks_v2, task_to_dict
from workflow_types import build_minimum_state, ensure_state_defaults
from dependency_checker import reconcile_blocked_tasks
from planning_gates import (
    build_discussion_artifact,
    build_spec_review_summary,
    detect_agent_workspaces,
    estimate_gap_count,
    map_spec_review_choice,
    needs_workspace_detection,
    should_run_discussion,
    should_run_ux_design_gate,
    validate_ux_artifact,
)


def load_project_config(project_root: Path) -> Optional[Dict[str, Any]]:
    config_path = project_root / ".claude" / "config" / "project-config.json"
    if not config_path.is_file():
        return None
    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def extract_project_id(config: Optional[Dict[str, Any]]) -> Optional[str]:
    if not config:
        return None
    project = config.get("project") or {}
    project_id = project.get("id") or config.get("projectId")
    if not project_id or not validate_project_id(project_id):
        return None
    return project_id


def summarize_text(value: str, limit: int = 80) -> str:
    collapsed = re.sub(r"\s+", " ", (value or "")).strip()
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 3].rstrip() + "..."


def slugify_filename(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:80] if slug else ""


def stable_project_id(project_root: Path) -> str:
    digest = hashlib.md5(str(project_root.resolve()).lower().encode("utf-8")).hexdigest()
    return digest[:12]


def build_project_config(
    project_root: Path,
    existing: Optional[Dict[str, Any]] = None,
    forced_project_id: Optional[str] = None,
) -> Dict[str, Any]:
    current = dict(existing or {})
    project = dict(current.get("project") or {})
    tech = dict(current.get("tech") or {})
    workflow = dict(current.get("workflow") or {})

    project_id = forced_project_id or project.get("id") or current.get("projectId")
    if not project_id or not validate_project_id(project_id):
        project_id = stable_project_id(project_root)

    project["id"] = project_id
    project["name"] = project.get("name") or project_root.name
    project["type"] = project.get("type") or "single"
    project["bkProjectId"] = project.get("bkProjectId")

    tech.setdefault("packageManager", "unknown")
    tech.setdefault("buildTool", "unknown")
    tech.setdefault("frameworks", [])
    workflow.setdefault("enableBKMCP", False)

    current["project"] = project
    current["tech"] = tech
    current["workflow"] = workflow
    current["_scanMode"] = current.get("_scanMode") or "auto-healed"
    return current


def ensure_project_config(
    project_root: Path,
    forced_project_id: Optional[str] = None,
) -> tuple[Dict[str, Any], Path, bool]:
    config_path = project_root / ".claude" / "config" / "project-config.json"
    existing = load_project_config(project_root)
    current_project_id = extract_project_id(existing)
    needs_write = (
        existing is None
        or current_project_id is None
        or (forced_project_id is not None and current_project_id != forced_project_id)
    )

    if not needs_write and existing is not None:
        return existing, config_path, False

    config = build_project_config(project_root, existing, forced_project_id)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        json.dumps(config, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return config, config_path, True


def render_template(template: str, values: Dict[str, str]) -> str:
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace("{{" + key + "}}", value)
    return rendered


def resolve_requirement_input(
    requirement: str,
    project_root: Path,
) -> tuple[str, str, Optional[Path]]:
    candidate = Path(requirement)
    if candidate.suffix.lower() == ".md":
        absolute = candidate if candidate.is_absolute() else project_root / candidate
        if absolute.is_file():
            try:
                display = str(absolute.relative_to(project_root))
            except ValueError:
                display = str(absolute)
            return display, absolute.read_text(encoding="utf-8"), absolute
    return "inline", requirement, None


def derive_task_name(requirement_text: str, source_path: Optional[Path]) -> str:
    if source_path:
        return source_path.stem.replace("-", " ").replace("_", " ").strip() or "Workflow Task"
    return summarize_text(requirement_text, limit=48) or "Workflow Task"


def build_tech_stack_summary(config: Dict[str, Any]) -> str:
    tech = config.get("tech") or {}
    parts = [
        str(tech.get("packageManager") or "unknown"),
        str(tech.get("buildTool") or "unknown"),
    ]
    frameworks = tech.get("frameworks") or []
    if frameworks:
        parts.append("/".join(str(item) for item in frameworks))
    return " | ".join(parts)


def resolve_workflow_runtime(
    project_id: Optional[str] = None,
    project_root: Optional[str] = None,
) -> tuple[Optional[str], Path, Optional[Path], Optional[Path], Optional[Dict[str, Any]]]:
    root = detect_project_root(project_root)
    config = load_project_config(root)
    resolved_project_id = project_id or extract_project_id(config) or detect_project_id()
    if not resolved_project_id or not validate_project_id(resolved_project_id):
        return None, root, None, None, None

    workflow_dir_raw = get_workflows_dir(resolved_project_id)
    state_path_raw = get_workflow_state_path(resolved_project_id)
    if not workflow_dir_raw or not state_path_raw:
        return resolved_project_id, root, None, None, None

    workflow_dir = Path(workflow_dir_raw)
    state_path = Path(state_path_raw)
    state = read_state(str(state_path), resolved_project_id) if state_path.is_file() else None
    return resolved_project_id, root, workflow_dir, state_path, state


def build_plan_tasks() -> str:
    return """## T1: 实现核心需求
- **阶段**: implement
- **Spec 参考**: §1, §2, §5, §7
- **Plan 参考**: P1
- **需求 ID**: R1
- **关键约束**: 保持现有功能不受影响, 仅实现当前明确范围
- **验收项**: 核心需求完成, 结果可验证
- **质量关卡**: false
- **状态**: pending
- **actions**: 阅读现有实现,落实最小改动,完成必要验证
- **步骤**:
  - A1: 阅读现有实现与 Spec → 明确最小改动方案（验证：改动范围收敛）
  - A2: 实施代码修改与必要验证 → 输出满足验收项的结果（验证：核心需求可验证完成）
"""


def cmd_start(
    requirement: str,
    force: bool = False,
    no_discuss: bool = False,
    project_id: Optional[str] = None,
    project_root: Optional[str] = None,
    spec_choice: str = "Spec 正确，继续",
) -> Dict[str, Any]:
    root = detect_project_root(project_root)
    if project_id and not validate_project_id(project_id):
        return {"error": f"非法项目 ID: {project_id}"}

    config, _, config_healed = ensure_project_config(root, project_id)
    resolved_project_id = extract_project_id(config)
    if not resolved_project_id:
        return {"error": "无法初始化项目配置"}

    workflow_dir_raw = get_workflows_dir(resolved_project_id)
    if not workflow_dir_raw:
        return {"error": f"无法解析工作流目录: {resolved_project_id}"}

    workflow_dir = Path(workflow_dir_raw)
    state_path = workflow_dir / "workflow-state.json"
    if state_path.is_file():
        existing_state = ensure_state_defaults(read_state(str(state_path)))
        if existing_state.get("status") != "archived" and not force:
            return {
                "error": "已存在未归档工作流，请先归档或使用 --force 覆盖",
                "project_id": resolved_project_id,
                "state_status": existing_state.get("status"),
            }

    requirement_source, requirement_text, source_path = resolve_requirement_input(requirement, root)
    task_name = derive_task_name(requirement_text, source_path)
    summary = summarize_text(requirement_text, limit=120)
    slug = slugify_filename(task_name) or f"workflow-{hashlib.md5(requirement_text.encode('utf-8')).hexdigest()[:12]}"

    spec_relative = Path(".claude") / "specs" / f"{slug}.md"
    plan_relative = Path(".claude") / "plans" / f"{slug}.md"
    spec_path = root / spec_relative
    plan_path = root / plan_relative

    if not force:
        if spec_path.exists():
            return {"error": f"Spec 已存在: {spec_relative.as_posix()}"}
        if plan_path.exists():
            return {"error": f"Plan 已存在: {plan_relative.as_posix()}"}

    gap_count = estimate_gap_count(requirement_text, requirement_source)
    discussion_required = should_run_discussion(
        requirement_text,
        requirement_source,
        no_discuss=no_discuss,
        gap_count=gap_count,
    )
    discussion_artifact = build_discussion_artifact(requirement_source)
    discussion_path = workflow_dir / "discussion-artifact.json"

    analysis_patterns = [
        {"name": framework}
        for framework in ((config.get("tech") or {}).get("frameworks") or [])
    ]
    ux_required = should_run_ux_design_gate(
        requirement_text,
        analysis_patterns=analysis_patterns,
        discussion_artifact=discussion_artifact,
    )
    ux_path = workflow_dir / "ux-design-artifact.json"

    # 条件工件：仅在对应 phase 需要执行时才生成 artifact
    # discussion-artifact 始终生成（Phase 0.2 即使跳过也落盘最小工件）
    # ux-design-artifact 仅在 UX gate 触发时生成
    ux_artifact = None
    ux_validation = {"ok": True, "missing": [], "scenario_count": 0, "page_count": 0}
    if ux_required:
        ux_artifact = {
            "flowchart": {
                "mermaidCode": "flowchart TD\n  A[Start] --> B[Complete]",
                "scenarios": [
                    {"name": "首次使用", "description": "初始进入", "coveredNodes": ["A"]},
                    {"name": "核心操作", "description": "执行主路径", "coveredNodes": ["B"]},
                    {"name": "异常处理", "description": "处理边界情况", "coveredNodes": ["B"]},
                ],
            },
            "pageHierarchy": {
                "pages": [
                    {"level": "L0", "name": task_name, "features": [summary], "navigation": "direct"}
                ],
                "navigation": {
                    "type": "router",
                    "routes": ["/"],
                },
            },
            "detectedWorkspaces": detect_agent_workspaces(str(Path.home())) if needs_workspace_detection(requirement_text) else [],
        }
        ux_validation = validate_ux_artifact(ux_artifact)

    now = datetime.now().isoformat()
    template_root = Path(__file__).resolve().parents[2] / "specs" / "workflow-templates"
    spec_template = (template_root / "spec-template.md").read_text(encoding="utf-8")
    plan_template = (template_root / "plan-template.md").read_text(encoding="utf-8")

    spec_content = render_template(
        spec_template,
        {
            "requirement_source": requirement_source,
            "created_at": now,
            "task_name": task_name,
            "context_summary": f"- 原始需求来源: {requirement_source}\n- 需求摘要: {summary}",
            "scope_summary": f"- R1: {summary}",
            "out_of_scope_summary": "- 未在原始需求中明确提出的扩展项不纳入本次范围",
            "blocked_summary": "- 无",
            "critical_constraints": "- 保持现有功能不受影响\n- 优先复用现有模块与状态管理能力",
            "user_facing_behavior": f"- 按需求实现并交付：{summary}",
            "architecture_summary": "- 以现有代码结构为基线，采用最小必要改动完成需求\n- 优先复用现有模块、状态流转与验证能力",
            "file_structure": f"- {spec_relative.as_posix()}\n- {plan_relative.as_posix()}",
            "acceptance_criteria": f"- [ ] {summary}\n- [ ] 现有行为保持稳定\n- [ ] 结果可通过最小验证确认",
            "implementation_slices": "- Slice 1：对齐需求范围与设计边界\n- Slice 2：实施最小代码改动\n- Slice 3：完成必要验证与收尾",
        },
    )

    plan_content = render_template(
        plan_template,
        {
            "requirement_source": requirement_source,
            "created_at": now,
            "spec_file": spec_relative.as_posix(),
            "task_name": task_name,
            "goal": summary,
            "architecture_summary": "基于现有实现做最小必要改动，并复用已有模块与状态流转能力。",
            "tech_stack": build_tech_stack_summary(config),
            "files_create": f"- {spec_relative.as_posix()}\n- {plan_relative.as_posix()}",
            "files_modify": "- 无",
            "files_test": "- 无",
            "tasks": build_plan_tasks(),
        },
    )

    parsed_tasks = parse_tasks_v2(plan_content)
    if not parsed_tasks:
        return {"error": "生成的 Plan 未通过任务解析"}

    spec_review = map_spec_review_choice(spec_choice)

    spec_path.parent.mkdir(parents=True, exist_ok=True)
    plan_path.parent.mkdir(parents=True, exist_ok=True)
    workflow_dir.mkdir(parents=True, exist_ok=True)

    spec_path.write_text(spec_content, encoding="utf-8")
    plan_path.write_text(plan_content, encoding="utf-8")
    discussion_path.write_text(json.dumps(discussion_artifact, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if ux_artifact is not None:
        ux_path.write_text(json.dumps(ux_artifact, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    state = build_minimum_state(
        resolved_project_id,
        plan_relative.as_posix(),
        spec_relative.as_posix(),
        current_tasks=[parsed_tasks[0].id],
        status=spec_review["workflow_status"],
    )
    state = ensure_state_defaults(state)
    state["project_root"] = str(root)
    state["task_name"] = task_name
    state["requirement_source"] = requirement_source
    update_discussion_record(state, str(discussion_path), len(discussion_artifact["clarifications"]), completed=not discussion_required)
    if ux_artifact is not None:
        update_ux_design_record(
            state,
            str(ux_path),
            flowchart_scenarios=ux_validation["scenario_count"],
            page_count=ux_validation["page_count"],
            approved=ux_validation["ok"],
        )
    update_user_spec_review(state, spec_review["status"], spec_review["next_action"])
    write_state(str(state_path), state)

    return {
        "started": True,
        "project_id": resolved_project_id,
        "config_healed": config_healed,
        "workflow_status": state.get("status"),
        "spec_file": spec_relative.as_posix(),
        "plan_file": plan_relative.as_posix(),
        "task_count": len(parsed_tasks),
        "current_tasks": state.get("current_tasks", []),
        "discussion_required": discussion_required,
        "ux_gate_required": ux_required,
        "spec_review_summary": build_spec_review_summary(spec_content),
    }


def detect_delta_trigger(source: str, project_root: Path) -> Dict[str, Any]:
    raw = (source or "").strip()
    if not raw:
        return {
            "type": "sync",
            "source": None,
            "description": "执行 API 同步",
        }

    candidate = Path(raw)
    absolute = candidate if candidate.is_absolute() else project_root / candidate
    if raw.endswith(".md") and absolute.is_file():
        return {
            "type": "prd",
            "source": str(candidate),
            "description": f"PRD 更新: {candidate.name}",
        }

    if raw.endswith("Api.ts") or "/autogen/" in raw or raw.endswith(".api.ts"):
        return {
            "type": "api",
            "source": raw,
            "description": f"API 变更: {raw}",
        }

    return {
        "type": "requirement",
        "source": raw,
        "description": summarize_text(raw, limit=120),
    }


def cmd_delta(
    source: str = "",
    project_id: Optional[str] = None,
    project_root: Optional[str] = None,
) -> Dict[str, Any]:
    resolved_project_id, root, workflow_dir, state_path, state = resolve_workflow_runtime(
        project_id,
        project_root,
    )
    if not resolved_project_id or workflow_dir is None or state_path is None or state is None:
        return {"error": "没有活跃的工作流"}

    normalized_state = ensure_state_defaults(state)
    if normalized_state.get("status") == "archived":
        return {"error": "当前工作流已归档，无法追加 delta"}

    trigger = detect_delta_trigger(source, root)
    tracking = normalized_state.setdefault("delta_tracking", {})
    parent_change = tracking.get("current_change")
    change_id = record_delta_change(normalized_state)

    change_dir = workflow_dir / "changes" / change_id
    change_dir.mkdir(parents=True, exist_ok=True)

    artifacts = create_delta_artifacts(change_id, trigger, parent_change)
    task_deltas: List[Dict[str, Any]] = []
    _, _, tasks_content, tasks_path = resolve_state_and_tasks(resolved_project_id, str(root))
    if tasks_content and tasks_path and trigger["type"] == "requirement":
        existing_tasks = [task_to_dict(task) for task in parse_tasks_v2(tasks_content)]
        task_deltas = build_task_delta_examples(change_id, trigger, existing_tasks)
        updated_tasks = apply_task_deltas(tasks_content, task_deltas)
        Path(tasks_path).write_text(updated_tasks, encoding="utf-8")
        artifacts["delta"]["task_deltas"] = task_deltas
        artifacts["delta"]["impact_analysis"]["summary"] = f"applied {len(task_deltas)} task delta(s)"

    (change_dir / "delta.json").write_text(
        to_pretty_json(artifacts["delta"]),
        encoding="utf-8",
    )
    (change_dir / "intent.md").write_text(
        artifacts["intent"],
        encoding="utf-8",
    )
    (change_dir / "review-status.json").write_text(
        to_pretty_json(artifacts["review_status"]),
        encoding="utf-8",
    )

    write_state(str(state_path), normalized_state)

    return {
        "delta_created": True,
        "project_id": resolved_project_id,
        "change_id": change_id,
        "trigger_type": trigger["type"],
        "change_dir": str(change_dir),
        "current_change": tracking.get("current_change"),
        "review_status_file": str(change_dir / "review-status.json"),
        "task_delta_summary": summarize_task_deltas(task_deltas),
    }


def cmd_archive(
    summary: bool = False,
    project_id: Optional[str] = None,
    project_root: Optional[str] = None,
) -> Dict[str, Any]:
    resolved_project_id, _, workflow_dir, state_path, state = resolve_workflow_runtime(
        project_id,
        project_root,
    )
    if not resolved_project_id or workflow_dir is None or state_path is None or state is None:
        return {"error": "没有可归档的工作流"}

    normalized_state = ensure_state_defaults(state)
    if normalized_state.get("status") != "completed":
        return {
            "error": "只有 completed 状态的工作流可以归档",
            "state_status": normalized_state.get("status"),
        }

    changes_dir = workflow_dir / "changes"
    archive_dir = workflow_dir / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)

    archived_changes: List[str] = []
    if changes_dir.is_dir():
        for entry in sorted(changes_dir.iterdir()):
            if not entry.is_dir() or not entry.name.startswith("CHG-"):
                continue
            destination = archive_dir / entry.name
            if destination.exists():
                shutil.rmtree(destination)
            shutil.move(str(entry), str(destination))
            archived_changes.append(entry.name)

    summary_path = None
    if summary:
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        summary_path = archive_dir / f"archive-summary-{timestamp}.md"
        progress = normalized_state.get("progress") or {}
        summary_path.write_text(
            "\n".join(
                [
                    "# 工作流归档摘要",
                    "",
                    f"- 项目 ID: {resolved_project_id}",
                    f"- Task: {normalized_state.get('task_name') or 'N/A'}",
                    f"- Spec: {normalized_state.get('spec_file') or 'N/A'}",
                    f"- Plan: {normalized_state.get('plan_file') or 'N/A'}",
                    f"- 已归档变更: {', '.join(archived_changes) if archived_changes else '无'}",
                    f"- 已完成任务: {len(progress.get('completed', []))}",
                    f"- 已跳过任务: {len(progress.get('skipped', []))}",
                    f"- 失败任务: {len(progress.get('failed', []))}",
                ]
            )
            + "\n",
            encoding="utf-8",
        )

    normalized_state["status"] = "archived"
    normalized_state["archived_at"] = datetime.now().isoformat()
    normalized_state.setdefault("delta_tracking", {})["current_change"] = None
    write_state(str(state_path), normalized_state)

    return {
        "archived": True,
        "project_id": resolved_project_id,
        "archived_changes": archived_changes,
        "archive_dir": str(archive_dir),
        "summary_file": str(summary_path) if summary_path else None,
        "workflow_status": normalized_state.get("status"),
    }


def cmd_unblock(
    dependency: str,
    project_id: Optional[str] = None,
    project_root: Optional[str] = None,
) -> Dict[str, Any]:
    resolved_project_id, root, _, state_path, state = resolve_workflow_runtime(
        project_id,
        project_root,
    )
    if not resolved_project_id or state_path is None or state is None:
        return {"error": "没有活跃的工作流"}

    dep = (dependency or "").strip()
    if not dep:
        return {"error": "缺少要解除的依赖标识"}

    normalized_state = ensure_state_defaults(state)
    mark_dependency_unblocked(normalized_state, dep)

    _, _, tasks_content, _ = resolve_state_and_tasks(resolved_project_id, str(root))
    newly_unblocked: List[str] = []
    if tasks_content:
        tasks = [task_to_dict(task) for task in parse_tasks_v2(tasks_content)]
        reconciliation = reconcile_blocked_tasks(
            tasks,
            normalized_state.get("unblocked", []),
            normalized_state.get("progress", {}).get("blocked", []),
        )
        normalized_state.setdefault("progress", {})["blocked"] = reconciliation["blocked"]
        newly_unblocked = reconciliation["newly_unblocked"]
        if normalized_state.get("status") == "blocked" and not reconciliation["blocked"]:
            normalized_state["status"] = "running"

    write_state(str(state_path), normalized_state)
    return {
        "unblocked": True,
        "project_id": resolved_project_id,
        "dependency": dep,
        "workflow_status": normalized_state.get("status"),
        "known_unblocked": normalized_state.get("unblocked", []),
        "newly_unblocked_tasks": newly_unblocked,
    }
