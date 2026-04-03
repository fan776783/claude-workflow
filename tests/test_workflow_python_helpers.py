import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "core" / "utils" / "workflow"
DISPATCH_SCRIPT_DIR = Path(__file__).resolve().parents[1] / "core" / "skills" / "dispatching-parallel-agents" / "scripts"
CLI_SCRIPT = SCRIPT_DIR / "workflow_cli.py"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
if str(DISPATCH_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(DISPATCH_SCRIPT_DIR))

import dispatch_runner
import execution_sequencer
import lifecycle_cmds
import planning_gates
import quality_review
import self_review
import state_manager
import verification
from path_utils import get_workflow_state_path, validate_project_id
from plan_delta import apply_task_deltas, build_task_delta_examples, get_next_task_index
from state_manager import resolve_state_path as resolve_state_path_by_project
from workflow_types import get_review_result


PLAN_FIXTURE = """## T1: 第一个任务
- **阶段**: implement
- **Spec 参考**: §1
- **Plan 参考**: P1
- **状态**: pending
- **actions**: edit_file
- **步骤**:
  - A1: 修改实现 → 完成第一个任务

## T2: 第二个任务
- **阶段**: test
- **Spec 参考**: §2
- **Plan 参考**: P2
- **状态**: pending
- **actions**: run_tests
- **步骤**:
  - A2: 运行测试 → 完成第二个任务
"""


def minimum_state(status="running", current_tasks=None):
    return {
        "project_id": "proj-test",
        "status": status,
        "current_tasks": current_tasks or ["T1"],
        "plan_file": ".claude/plans/test.md",
        "spec_file": ".claude/specs/test.md",
        "progress": {
            "completed": [],
            "blocked": [],
            "failed": [],
            "skipped": [],
        },
        "created_at": "2026-03-31T00:00:00",
        "updated_at": "2026-03-31T00:00:00",
    }


def create_canonical_state_file(
    home: Path,
    project_id: str = "proj-test",
    status: str = "running",
    current_tasks=None,
) -> Path:
    state_path_raw = get_workflow_state_path(project_id)
    assert state_path_raw is not None
    state_path = Path(state_path_raw)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(
        json.dumps(minimum_state(status=status, current_tasks=current_tasks), ensure_ascii=False),
        encoding="utf-8",
    )
    return state_path


class LifecycleCmdsTests(unittest.TestCase):
    def test_detect_delta_trigger_variants(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            prd = root / "docs" / "prd.md"
            prd.parent.mkdir(parents=True)
            prd.write_text("# PRD\n", encoding="utf-8")

            prd_result = lifecycle_cmds.detect_delta_trigger("docs/prd.md", root)
            api_result = lifecycle_cmds.detect_delta_trigger("src/autogen/teamApi.ts", root)
            req_result = lifecycle_cmds.detect_delta_trigger("新增导出功能", root)
            sync_result = lifecycle_cmds.detect_delta_trigger("", root)

            self.assertEqual(prd_result["type"], "prd")
            self.assertEqual(api_result["type"], "api")
            self.assertEqual(req_result["type"], "requirement")
            self.assertEqual(sync_result["type"], "sync")

    def test_apply_task_deltas_adds_task_block(self):
        updated = apply_task_deltas(
            PLAN_FIXTURE,
            [{
                "action": "add",
                "task_markdown": "## T3: 新增任务\n- **阶段**: implement\n- **Spec 参考**: §3\n- **Plan 参考**: P3\n- **需求 ID**: R-003\n- **状态**: pending\n- **actions**: edit_file\n- **步骤**:\n  - A3: 处理新增需求 → 完成增量\n",
            }],
        )
        self.assertIn("## T3: 新增任务", updated)

    def test_build_task_delta_examples_cover_add_modify_remove(self):
        deltas = build_task_delta_examples(
            "CHG-001",
            {"description": "新增导出字段"},
            [{"id": "T1"}, {"id": "T2"}],
        )
        self.assertEqual([delta["action"] for delta in deltas], ["add", "modify", "remove"])

    def test_get_next_task_index_counts_deprecated_ids(self):
        tasks = [
            {"id": "T1"},
            {"id": "T2"},
            {"id": "T4"},
            {"id": "T3", "deprecated": True},
        ]
        self.assertEqual(get_next_task_index(tasks), 5)

    def test_build_task_delta_examples_uses_next_available_task_id(self):
        deltas = build_task_delta_examples(
            "CHG-001",
            {"description": "新增导出字段"},
            [{"id": "T1"}, {"id": "Task-7"}, {"id": "T8", "deprecated": True}],
        )
        self.assertIn("## T9: 响应增量变更 CHG-001", deltas[0]["task_markdown"])
        self.assertEqual(deltas[1]["task_id"], "T1")
        self.assertEqual(deltas[2]["task_id"], "Task-7")

    def test_apply_task_deltas_examples_modify_and_remove_existing_tasks(self):
        deltas = build_task_delta_examples(
            "CHG-001",
            {"description": "新增导出字段"},
            [{"id": "T1"}, {"id": "T2"}],
        )

        updated = apply_task_deltas(PLAN_FIXTURE, deltas)

        self.assertIn("## T3: 响应增量变更 CHG-001", updated)
        self.assertIn("## T1: 第一个任务（增量调整）", updated)
        self.assertNotIn("## T2: 第二个任务", updated)


class PlanningGateTests(unittest.TestCase):
    def test_should_run_discussion_short_inline_without_gaps(self):
        self.assertFalse(planning_gates.should_run_discussion("修复按钮", "inline", gap_count=0))
        self.assertTrue(planning_gates.should_run_discussion("修复按钮", "inline", gap_count=1))

    def test_should_run_ux_design_gate_from_keywords_and_discussion(self):
        self.assertTrue(planning_gates.should_run_ux_design_gate("新增设置页面", [], None))
        self.assertTrue(
            planning_gates.should_run_ux_design_gate(
                "新增导出功能",
                [{"name": "react"}],
                {"clarifications": [{"dimension": "behavior"}]},
            )
        )

    def test_map_spec_review_choice(self):
        mapped = planning_gates.map_spec_review_choice("Spec 正确，继续")
        self.assertEqual(mapped["status"], "approved")
        self.assertEqual(mapped["next_action"], "continue_to_plan_generation")

    def test_build_spec_review_summary(self):
        summary = planning_gates.build_spec_review_summary(
            "## 2. Scope\nA\n\n## 3. Constraints\nB\n\n## 7. Acceptance Criteria\nC\n"
        )
        self.assertIn("## 2. Scope", summary)
        self.assertIn("## 7. Acceptance Criteria", summary)


class QualityReviewTests(unittest.TestCase):
    def test_get_review_result_prefers_quality_gates(self):
        state = minimum_state()
        state["quality_gates"] = {
            "T3": quality_review.build_pass_gate_result(task_id="T3", base_commit="abc123")
        }

        review = get_review_result(state, "T3")

        self.assertIsNotNone(review)
        self.assertTrue(review["overall_passed"])
        self.assertEqual(review["gate_task_id"], "T3")

    def test_get_review_result_falls_back_to_execution_reviews(self):
        state = minimum_state()
        state["execution_reviews"] = {
            "T4": {
                "review_mode": "machine_loop",
                "last_decision": "pass",
                "spec_compliance": {"passed": True, "attempts": 1},
                "code_quality": {"passed": True, "assessment": "approved"},
                "overall_passed": True,
                "reviewed_at": "2026-03-31T00:00:00",
            }
        }

        review = get_review_result(state, "T4")

        self.assertIsNotNone(review)
        self.assertTrue(review["overall_passed"])
        self.assertEqual(review["gate_task_id"], "T4")

    def test_get_review_result_returns_none_when_missing(self):
        self.assertIsNone(get_review_result(minimum_state(), "T99"))

    def test_build_pass_gate_result_and_evidence(self):
        gate = quality_review.build_pass_gate_result(
            task_id="T8",
            base_commit="abc123",
            current_commit="def456",
            from_task="T5",
            to_task="T8",
            files_changed=3,
            requirement_ids=["R-001"],
            critical_constraints=["不能破坏现有行为"],
            stage1_attempts=1,
            stage2_attempts=2,
            critical_count=0,
            important_count=1,
            minor_count=2,
        )
        evidence = quality_review.create_quality_review_evidence("T8", gate)

        self.assertTrue(gate["overall_passed"])
        self.assertEqual(gate["attempt"], 3)
        self.assertEqual(gate["stage2"]["assessment"], "approved")
        self.assertEqual(evidence["artifact_ref"], "quality_gates.T8")
        self.assertTrue(evidence["passed"])

    def test_build_failed_gate_result_contains_stage2(self):
        gate = quality_review.build_failed_gate_result(
            task_id="T9",
            failed_stage="stage2",
            base_commit="abc123",
            total_attempts=4,
            stage1_attempts=1,
            last_result={
                "assessment": "needs_fixes",
                "issues": {
                    "critical": [{"description": "critical"}],
                    "important": [{"description": "important"}],
                    "minor": [],
                },
            },
        )

        self.assertFalse(gate["overall_passed"])
        self.assertEqual(gate["last_decision"], "rejected")
        self.assertIn("stage2", gate)
        self.assertEqual(gate["stage2"]["critical_count"], 1)

    def test_write_and_read_quality_gate_result(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.dict(os.environ, {"HOME": tmpdir}):
                state_path = create_canonical_state_file(Path(tmpdir))
                gate = quality_review.build_pass_gate_result(task_id="T3", base_commit="abc123")

                quality_review.write_quality_gate_result(str(state_path), "T3", gate, "proj-test")
                review = quality_review.read_quality_gate_result(str(state_path), "T3", "proj-test")

                self.assertIsNotNone(review)
                self.assertTrue(review["overall_passed"])
                self.assertEqual(review["gate_task_id"], "T3")
    def test_quality_review_returns_structured_errors_when_project_state_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            home = root / "home"
            home.mkdir(parents=True, exist_ok=True)
            extra_env = {"HOME": str(home)}
            quality_script = SCRIPT_DIR / "quality_review.py"

            read_result = subprocess.run(
                [sys.executable, str(quality_script), "read", "T3", "--project-id", "reviewzz999"],
                capture_output=True,
                text=True,
                env={**os.environ, **extra_env, "PYTHONPATH": f"{SCRIPT_DIR}{os.pathsep}{os.environ.get('PYTHONPATH', '')}" if os.environ.get('PYTHONPATH') else str(SCRIPT_DIR)},
                check=False,
            )
            self.assertEqual(read_result.returncode, 1, msg=read_result.stderr)
            self.assertEqual(json.loads(read_result.stdout)["error"], "没有活跃的工作流")

            pass_result = subprocess.run(
                [sys.executable, str(quality_script), "pass", "T3", "--base-commit", "abc123", "--project-id", "reviewzz999"],
                capture_output=True,
                text=True,
                env={**os.environ, **extra_env, "PYTHONPATH": f"{SCRIPT_DIR}{os.pathsep}{os.environ.get('PYTHONPATH', '')}" if os.environ.get('PYTHONPATH') else str(SCRIPT_DIR)},
                check=False,
            )
            self.assertEqual(pass_result.returncode, 1, msg=pass_result.stderr)
            self.assertEqual(json.loads(pass_result.stdout)["error"], "没有活跃的工作流")

            fail_result = subprocess.run(
                [sys.executable, str(quality_script), "fail", "T3", "--failed-stage", "stage1", "--base-commit", "abc123", "--project-id", "reviewzz999"],
                capture_output=True,
                text=True,
                env={**os.environ, **extra_env, "PYTHONPATH": f"{SCRIPT_DIR}{os.pathsep}{os.environ.get('PYTHONPATH', '')}" if os.environ.get('PYTHONPATH') else str(SCRIPT_DIR)},
                check=False,
            )
            self.assertEqual(fail_result.returncode, 1, msg=fail_result.stderr)
            self.assertEqual(json.loads(fail_result.stdout)["error"], "没有活跃的工作流")

    def test_validate_project_id_accepts_safe_ids(self):
        self.assertTrue(validate_project_id("proj_test-123"))

    def test_validate_project_id_rejects_unsafe_ids(self):
        self.assertFalse(validate_project_id(""))
        self.assertFalse(validate_project_id("../etc/passwd"))
        self.assertFalse(validate_project_id("proj/test"))


class DispatchingParallelAgentsTests(unittest.TestCase):
    def test_requires_worktree_skips_clear_read_only_task(self):
        task = {
            "id": "R1",
            "name": "Investigate lock contention",
            "steps": [{"description": "Analyze recent failures", "expected": "Summarize root cause"}],
            "acceptance_criteria": ["Provide analysis only"],
        }

        self.assertFalse(dispatch_runner.requires_worktree(task))

    def test_requires_worktree_defaults_to_true_for_ambiguous_task(self):
        task = {
            "id": "A1",
            "name": "Handle workflow task",
            "steps": [{"description": "Process task", "expected": "Complete task"}],
        }

        self.assertTrue(dispatch_runner.requires_worktree(task))

    def test_dispatch_group_mixes_read_only_and_write_tasks(self):
        tasks = [
            {
                "id": "R1",
                "name": "Investigate lock contention",
                "steps": [{"description": "Analyze failures", "expected": "Summarize root cause"}],
                "acceptance_criteria": ["Provide analysis only"],
            },
            {
                "id": "W1",
                "name": "Fix dispatch worktree policy",
                "files": {"modify": ["dispatch_runner.py"]},
                "steps": [{"description": "Implement serialized provisioning", "expected": "Use isolated worktree"}],
            },
        ]

        with patch.object(dispatch_runner, "create_worktree", return_value={"created": True, "path": "/tmp/W1"}) as mocked_create, \
             patch.object(dispatch_runner, "register_agent", side_effect=[{"agent_id": "agent-r1"}, {"agent_id": "agent-w1"}]):
            result = dispatch_runner.dispatch_group(tasks, group_id="G1", use_worktree=True, project_root="/tmp/project")

        self.assertEqual(result["group_id"], "G1")
        self.assertEqual(len(result["manifests"]), 2)
        self.assertFalse(result["manifests"][0]["requires_worktree"])
        self.assertIsNone(result["manifests"][0]["worktree_path"])
        self.assertTrue(result["manifests"][1]["requires_worktree"])
        self.assertEqual(result["manifests"][1]["worktree_path"], "/tmp/W1")
        mocked_create.assert_called_once_with("workflow/w1", "W1", cwd="/tmp/project")

    def test_dispatch_group_returns_error_when_worktree_provision_fails(self):
        task = {
            "id": "W1",
            "name": "Fix dispatch worktree policy",
            "files": {"modify": ["dispatch_runner.py"]},
            "steps": [{"description": "Implement serialized provisioning", "expected": "Use isolated worktree"}],
        }

        with patch.object(dispatch_runner, "create_worktree", return_value={"error": "lock timeout"}), \
             patch.object(dispatch_runner, "register_agent") as mocked_register:
            result = dispatch_runner.dispatch_group([task], group_id="G1", use_worktree=True, project_root="/tmp/project")

        self.assertEqual(result["error"], "lock timeout")
        self.assertEqual(result["failed_task_id"], "W1")
        self.assertEqual(result["manifests"], [])
        mocked_register.assert_not_called()


class SelfReviewAndVerificationTests(unittest.TestCase):
    def test_plan_self_review_requires_verification(self):
        requirements = [{"id": "R-001", "summary": "导出", "scope_status": "in_scope"}]
        plan_content = """## T1: 导出任务
- **阶段**: implement
- **Spec 参考**: §1
- **Plan 参考**: P1
- **需求 ID**: R-001
- **actions**: edit_file
- **步骤**:
  - A1: 修改实现 → 完成导出
"""
        result = self_review.run_plan_self_review(requirements, plan_content)
        self.assertFalse(result["ok"])
        self.assertEqual(result["tasks_missing_verification"], ["T1"])

    def test_verification_order_detects_missing_evidence(self):
        result = verification.validate_verification_order(None, state_updated=True, plan_updated=True)
        self.assertFalse(result["valid"])
        self.assertIn("updated_before_verification", result["violations"])


class ExecutionSequencerTests(unittest.TestCase):
    def test_summarize_task_independence_uses_dependency_and_shared_state_signals(self):
        task = {
            "id": "T9",
            "depends": ["T1"],
            "blocked_by": [],
            "files": {"create": [], "modify": ["src/store/session.py"], "test": []},
            "steps": [{"id": "A1", "description": "更新 src/store/session.py", "expected": "完成"}],
        }
        summary = execution_sequencer.summarize_task_independence(task, has_parallel_boundary=True)
        self.assertEqual(summary["level"], "low")
        self.assertFalse(summary["parallelizable"])
        self.assertTrue(summary["signals"]["hasDepends"])
        self.assertTrue(summary["signals"]["touchesSharedState"])

    def test_build_execute_entry_continue_resume(self):
        fake_state = {
            "status": "paused",
            "execution_mode": "phase",
            "continuation": {
                "last_decision": {
                    "action": "pause-governance",
                    "reason": "phase-boundary",
                }
            },
        }
        with patch.object(execution_sequencer, "load_execution_context", return_value={"state": fake_state}):
            result = execution_sequencer.build_execute_entry("continue", None, None, Path("/tmp/project"))

        self.assertEqual(result["entry_action"], "execute")
        self.assertEqual(result["resolved_mode"], "phase")
        self.assertTrue(result["can_resume"])
        self.assertEqual(result["continuation_action"], "pause-governance")

    def test_decide_governance_action_prefers_parallel_for_independent_high_pollution(self):
        state = minimum_state()
        state["contextMetrics"] = {
            "projectedUsagePercent": 55,
            "warningThreshold": 60,
            "dangerThreshold": 80,
            "hardHandoffThreshold": 90,
        }
        next_task = {
            "id": "T2",
            "actions": ["run_tests"],
            "files": {"create": [], "modify": ["src/foo.py"], "test": ["tests/test_foo.py"]},
            "steps": [{"id": "A1"}, {"id": "A2"}, {"id": "A3"}],
        }
        decision = execution_sequencer.decide_governance_action(
            state,
            next_task=next_task,
            has_parallel_boundary=True,
        )
        self.assertEqual(decision["action"], "continue-parallel-boundaries")
        self.assertEqual(decision["suggestedExecutionPath"], "parallel-boundaries")
        self.assertEqual(decision["primarySignals"]["taskIndependence"]["level"], "high")
        self.assertEqual(decision["primarySignals"]["contextPollutionRisk"]["level"], "high")

    def test_decide_governance_action_uses_budget_as_backstop(self):
        state = minimum_state()
        state["contextMetrics"] = {
            "projectedUsagePercent": 85,
            "warningThreshold": 60,
            "dangerThreshold": 80,
            "hardHandoffThreshold": 90,
        }
        next_task = {
            "id": "T2",
            "actions": ["edit_file"],
            "files": {"create": [], "modify": ["src/foo.py"], "test": []},
            "steps": [{"id": "A1"}],
        }
        pause_result = execution_sequencer.decide_governance_action(state, next_task=next_task)
        self.assertEqual(pause_result["action"], "pause-budget")
        self.assertTrue(pause_result["budgetBackstopTriggered"])

        state["contextMetrics"]["projectedUsagePercent"] = 20
        quality_gate_result = execution_sequencer.decide_governance_action(
            state,
            next_task={"quality_gate": True, "actions": []},
        )
        self.assertEqual(quality_gate_result["action"], "pause-quality-gate")

    def test_apply_governance_decision_updates_continuation(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.dict(os.environ, {"HOME": tmpdir}):
                state_path = create_canonical_state_file(Path(tmpdir))
                state = json.loads(state_path.read_text(encoding="utf-8"))

                updated = execution_sequencer.apply_governance_decision(
                    state,
                    {
                        "action": "pause-budget",
                        "reason": "context-danger",
                        "severity": "warning",
                        "suggestedExecutionPath": "direct",
                        "primarySignals": {
                            "taskIndependence": {"level": "low"},
                            "contextPollutionRisk": {"level": "high"},
                        },
                        "budgetBackstopTriggered": True,
                        "budgetLevel": "danger",
                        "decisionNotes": ["预算危险区且建议路径仍会扩张主会话"],
                    },
                    str(state_path),
                    ["T2"],
                )

                self.assertEqual(updated["status"], "paused")
                persisted = json.loads(state_path.read_text(encoding="utf-8"))
                self.assertEqual(persisted["continuation"]["strategy"], "context-first")
                self.assertEqual(persisted["continuation"]["last_decision"]["action"], "pause-budget")
                self.assertEqual(persisted["continuation"]["last_decision"]["nextTaskIds"], ["T2"])
                self.assertTrue(persisted["continuation"]["last_decision"]["budgetBackstopTriggered"])

    def test_mark_task_skipped_advances_to_next_task(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.dict(os.environ, {"HOME": tmpdir}):
                root = Path(tmpdir)
                state_path = create_canonical_state_file(root)
                tasks_path = root / "plan.md"
                tasks_path.write_text(PLAN_FIXTURE, encoding="utf-8")

                result = execution_sequencer.mark_task_skipped(
                    str(state_path),
                    str(tasks_path),
                    PLAN_FIXTURE,
                    "T1",
                )
                updated_state = json.loads(state_path.read_text(encoding="utf-8"))
                updated_plan = tasks_path.read_text(encoding="utf-8")

                self.assertTrue(result["skipped"])
                self.assertEqual(result["next_task_id"], "T2")
                self.assertEqual(updated_state["current_tasks"], ["T2"])
                self.assertEqual(updated_state["status"], "running")
                self.assertIn("T1", updated_state["progress"]["skipped"])
                self.assertIn("⏭️", updated_plan)

    def test_mark_task_skipped_recovers_from_failed_status(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.dict(os.environ, {"HOME": tmpdir}):
                root = Path(tmpdir)
                state_path = create_canonical_state_file(root, status="failed")
                tasks_path = root / "plan.md"
                tasks_path.write_text(PLAN_FIXTURE, encoding="utf-8")

                result = execution_sequencer.mark_task_skipped(
                    str(state_path),
                    str(tasks_path),
                    PLAN_FIXTURE,
                    "T1",
                )
                updated_state = json.loads(state_path.read_text(encoding="utf-8"))

                self.assertEqual(result["workflow_status"], "running")
                self.assertEqual(updated_state["status"], "running")
                self.assertEqual(updated_state["current_tasks"], ["T2"])

    def test_mark_task_skipped_completes_when_last_task(self):
        single_task_plan = """## T2: 第二个任务
- **阶段**: test
- **Spec 参考**: §2
- **Plan 参考**: P2
- **状态**: pending
- **actions**: run_tests
- **步骤**:
  - A2: 运行测试 → 完成第二个任务
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.dict(os.environ, {"HOME": tmpdir}):
                root = Path(tmpdir)
                state_path = create_canonical_state_file(root, status="failed", current_tasks=["T2"])
                tasks_path = root / "plan.md"
                tasks_path.write_text(single_task_plan, encoding="utf-8")

                result = execution_sequencer.mark_task_skipped(
                    str(state_path),
                    str(tasks_path),
                    single_task_plan,
                    "T2",
                )
                updated_state = json.loads(state_path.read_text(encoding="utf-8"))

                self.assertIsNone(result["next_task_id"])
                self.assertEqual(result["workflow_status"], "completed")
                self.assertEqual(updated_state["status"], "completed")
                self.assertEqual(updated_state["current_tasks"], [])

    def test_prepare_parallel_sequential_fallback_rolls_back_completed_tasks(self):
        state = minimum_state()
        state["status"] = "paused"
        state["current_tasks"] = ["T9"]
        state["progress"]["completed"] = ["T2", "T3", "T4"]
        state["parallel_groups"] = [
            {
                "id": "G1",
                "task_ids": ["T3", "T4"],
                "status": "completed",
                "started_at": "2026-03-31T00:00:00",
                "conflict_detected": False,
            }
        ]

        result = execution_sequencer.prepare_parallel_sequential_fallback(state, "G1", ["T3", "T4"])
        updated_state = result["state"]

        self.assertEqual(result["rerun_task_ids"], ["T3", "T4"])
        self.assertEqual(updated_state["progress"]["completed"], ["T2"])
        self.assertEqual(updated_state["current_tasks"], ["T3", "T4"])
        self.assertEqual(updated_state["status"], "running")
        self.assertTrue(updated_state["parallel_groups"][0]["conflict_detected"])
        self.assertEqual(updated_state["parallel_groups"][0]["status"], "failed")
        self.assertEqual(
            updated_state["continuation"]["last_decision"]["reason"],
            "parallel-conflict-sequential-fallback",
        )

    def test_prepare_retry_sets_running_and_hard_stop(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.dict(os.environ, {"HOME": tmpdir}):
                state_path = create_canonical_state_file(Path(tmpdir), status="failed")
                state = json.loads(state_path.read_text(encoding="utf-8"))
                state["failure_reason"] = "boom"
                state_path.write_text(json.dumps(state), encoding="utf-8")

                first = execution_sequencer.prepare_retry(str(state_path), "T1", "boom")
                self.assertTrue(first["retryable"])

                failed_state = json.loads(state_path.read_text(encoding="utf-8"))
                failed_state["status"] = "failed"
                state_path.write_text(json.dumps(failed_state), encoding="utf-8")
                execution_sequencer.prepare_retry(str(state_path), "T1", "boom")

                failed_state = json.loads(state_path.read_text(encoding="utf-8"))
                failed_state["status"] = "failed"
                state_path.write_text(json.dumps(failed_state), encoding="utf-8")
                third = execution_sequencer.prepare_retry(str(state_path), "T1", "boom")

                self.assertFalse(third["retryable"])
                self.assertEqual(third["reason"], "hard-stop")


class WorkflowCliTests(unittest.TestCase):
    def run_cli(self, *args, cwd=None, extra_env=None, script=None):
        env = os.environ.copy()
        pythonpath = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = f"{SCRIPT_DIR}{os.pathsep}{pythonpath}" if pythonpath else str(SCRIPT_DIR)
        if extra_env:
            env.update(extra_env)
        target = script or CLI_SCRIPT
        return subprocess.run(
            [sys.executable, str(target), *args],
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )

    def make_cli_env(self, root: Path):
        home = root / "home"
        home.mkdir(parents=True, exist_ok=True)
        return {"HOME": str(home)}, home

    def workflow_state_path(self, home: Path, project_id: str) -> Path:
        return home / ".claude" / "workflows" / project_id / "workflow-state.json"

    def test_cli_execute_returns_entry_payload(self):
        result = self.run_cli("execute")
        self.assertEqual(result.returncode, 0)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["entry_action"], "execute")
        self.assertEqual(payload["resolved_mode"], "continuous")

    def test_cli_start_creates_spec_plan_and_state(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            extra_env, home = self.make_cli_env(root)
            result = self.run_cli("start", "实现导出功能", cwd=root, extra_env=extra_env)
            self.assertEqual(result.returncode, 0, msg=result.stderr)

            payload = json.loads(result.stdout)
            self.assertTrue(payload["started"])

            spec_path = root / payload["spec_file"]
            plan_path = root / payload["plan_file"]
            self.assertTrue(spec_path.exists())
            self.assertTrue(plan_path.exists())

            config_path = root / ".claude" / "config" / "project-config.json"
            config = json.loads(config_path.read_text(encoding="utf-8"))
            project_id = config["project"]["id"]
            state_path = self.workflow_state_path(home, project_id)
            self.assertTrue(state_path.exists())
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["status"], "planning")
            self.assertEqual(state["current_tasks"], ["T1"])
            self.assertIn("spec_review_summary", payload)
            self.assertFalse(payload["discussion_required"])

    def test_cli_start_respects_spec_review_branch(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            extra_env, home = self.make_cli_env(root)
            result = self.run_cli(
                "start",
                "实现导出功能",
                "--spec-choice",
                "需要修改 Spec",
                cwd=root,
                extra_env=extra_env,
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            state_path = self.workflow_state_path(home, payload["project_id"])
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["status"], "spec_review")
            self.assertEqual(state["review_status"]["user_spec_review"]["status"], "revise_required")


    def test_cli_delta_creates_change_artifacts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            extra_env, home = self.make_cli_env(root)

            start_result = self.run_cli("start", "实现导出功能", cwd=root, extra_env=extra_env)
            self.assertEqual(start_result.returncode, 0, msg=start_result.stderr)
            start_payload = json.loads(start_result.stdout)
            project_id = start_payload["project_id"]

            delta_result = self.run_cli("delta", "新增导出字段", cwd=root, extra_env=extra_env)
            self.assertEqual(delta_result.returncode, 0, msg=delta_result.stderr)
            delta_payload = json.loads(delta_result.stdout)

            self.assertTrue(delta_payload["delta_created"])
            self.assertEqual(delta_payload["change_id"], "CHG-001")
            change_dir = Path(delta_payload["change_dir"])
            self.assertTrue((change_dir / "delta.json").exists())
            self.assertTrue((change_dir / "intent.md").exists())
            self.assertTrue((change_dir / "review-status.json").exists())

            state_path = self.workflow_state_path(home, project_id)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["delta_tracking"]["current_change"], "CHG-001")
            self.assertEqual(state["delta_tracking"]["change_counter"], 1)
            self.assertEqual(delta_payload["task_delta_summary"]["add"], 1)
            self.assertEqual(delta_payload["task_delta_summary"]["modify"], 1)
            self.assertEqual(delta_payload["task_delta_summary"]["remove"], 0)

            plan_path = root / start_payload["plan_file"]
            plan_content = plan_path.read_text(encoding="utf-8")
            self.assertIn("响应增量变更 CHG-001", plan_content)
            self.assertIn("## T2: 响应增量变更 CHG-001", plan_content)
            self.assertIn("## T1: 第一个任务（增量调整）", plan_content)
            self.assertNotIn("## T1: 第一个任务\n", plan_content)

    def test_cli_unblock_updates_blocked_state(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            extra_env, home = self.make_cli_env(root)

            start_result = self.run_cli("start", "实现导出功能", cwd=root, extra_env=extra_env)
            self.assertEqual(start_result.returncode, 0, msg=start_result.stderr)
            start_payload = json.loads(start_result.stdout)
            project_id = start_payload["project_id"]
            state_path = self.workflow_state_path(home, project_id)

            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["status"] = "blocked"
            state["progress"]["blocked"] = ["T1"]
            state_path.write_text(json.dumps(state), encoding="utf-8")

            unblock_result = self.run_cli("unblock", "api_spec", cwd=root, extra_env=extra_env)
            self.assertEqual(unblock_result.returncode, 0, msg=unblock_result.stderr)
            unblock_payload = json.loads(unblock_result.stdout)

            self.assertTrue(unblock_payload["unblocked"])
            self.assertIn("api_spec", unblock_payload["known_unblocked"])
            self.assertIn("T1", unblock_payload["newly_unblocked_tasks"])

            updated_state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(updated_state["status"], "running")
            self.assertIn("api_spec", updated_state["unblocked"])

    def test_cli_archive_moves_changes_and_marks_archived(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            extra_env, home = self.make_cli_env(root)

            start_result = self.run_cli("start", "实现导出功能", cwd=root, extra_env=extra_env)
            self.assertEqual(start_result.returncode, 0, msg=start_result.stderr)
            start_payload = json.loads(start_result.stdout)
            project_id = start_payload["project_id"]
            state_path = self.workflow_state_path(home, project_id)
            workflow_dir = state_path.parent

            change_dir = workflow_dir / "changes" / "CHG-001"
            change_dir.mkdir(parents=True, exist_ok=True)
            (change_dir / "delta.json").write_text("{}", encoding="utf-8")

            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["status"] = "completed"
            state["delta_tracking"]["current_change"] = "CHG-001"
            state_path.write_text(json.dumps(state), encoding="utf-8")

            archive_result = self.run_cli("archive", "--summary", cwd=root, extra_env=extra_env)
            self.assertEqual(archive_result.returncode, 0, msg=archive_result.stderr)
            archive_payload = json.loads(archive_result.stdout)

            self.assertTrue(archive_payload["archived"])
            self.assertEqual(archive_payload["workflow_status"], "archived")
            self.assertTrue((workflow_dir / "archive" / "CHG-001" / "delta.json").exists())
            self.assertTrue(Path(archive_payload["summary_file"]).exists())

            updated_state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(updated_state["status"], "archived")
            self.assertIsNone(updated_state["delta_tracking"]["current_change"])

    def test_helper_clis_accept_legacy_state_path_arguments(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            extra_env, home = self.make_cli_env(root)
            with patch.dict(os.environ, {"HOME": str(home)}):
                state_path = create_canonical_state_file(home)
            tasks_path = root / "plan.md"
            tasks_path.write_text(PLAN_FIXTURE, encoding="utf-8")

            quality_script = SCRIPT_DIR / "quality_review.py"
            execution_script = SCRIPT_DIR / "execution_sequencer.py"
            state_script = SCRIPT_DIR / "state_manager.py"

            pass_result = self.run_cli(
                "pass",
                "T3",
                "--base-commit",
                "abc123",
                "--state-file",
                str(state_path),
                extra_env=extra_env,
                script=quality_script,
            )
            self.assertEqual(pass_result.returncode, 0, msg=pass_result.stderr)

            read_result = self.run_cli(
                "read",
                str(state_path),
                "T3",
                extra_env=extra_env,
                script=quality_script,
            )
            self.assertEqual(read_result.returncode, 0, msg=read_result.stderr)
            self.assertTrue(json.loads(read_result.stdout)["review"]["overall_passed"])

            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["status"] = "failed"
            state["failure_reason"] = "boom"
            state_path.write_text(json.dumps(state), encoding="utf-8")

            retry_result = self.run_cli(
                "retry",
                str(state_path),
                "T1",
                "--reason",
                "boom",
                extra_env=extra_env,
                script=execution_script,
            )
            self.assertEqual(retry_result.returncode, 0, msg=retry_result.stderr)

            progress_result = self.run_cli(
                "progress",
                str(state_path),
                extra_env=extra_env,
                script=state_script,
            )
            self.assertEqual(progress_result.returncode, 0, msg=progress_result.stderr)
            self.assertIn("percent", json.loads(progress_result.stdout))

    def test_helper_clis_return_structured_errors_without_state_reference(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            extra_env, _ = self.make_cli_env(root)

            quality_script = SCRIPT_DIR / "quality_review.py"
            execution_script = SCRIPT_DIR / "execution_sequencer.py"
            state_script = SCRIPT_DIR / "state_manager.py"

            quality_result = self.run_cli("read", "T3", extra_env=extra_env, script=quality_script)
            self.assertEqual(quality_result.returncode, 1)
            self.assertEqual(json.loads(quality_result.stdout)["error"], "missing state reference")

            execution_result = self.run_cli("retry", "proj-test", "T1", extra_env=extra_env, script=execution_script)
            self.assertEqual(execution_result.returncode, 1, msg=execution_result.stderr)
            self.assertEqual(json.loads(execution_result.stdout)["error"], "没有活跃的工作流")

            context_result = self.run_cli("context", "--project-id", "proj-test", extra_env=extra_env, script=execution_script)
            self.assertEqual(context_result.returncode, 1, msg=context_result.stderr)
            self.assertEqual(json.loads(context_result.stdout)["error"], "没有活跃的工作流")

            skip_result = self.run_cli("skip", "proj-test", str(CLI_SCRIPT), "T1", extra_env=extra_env, script=execution_script)
            self.assertEqual(skip_result.returncode, 1, msg=skip_result.stderr)
            self.assertEqual(json.loads(skip_result.stdout)["error"], "没有活跃的工作流")

            state_result = self.run_cli("--project-id", "proj-test", "progress", extra_env=extra_env, script=state_script)
            self.assertEqual(state_result.returncode, 1)
            self.assertEqual(json.loads(state_result.stdout)["error"], "没有活跃的工作流")

    def test_task_manager_resolves_legacy_absolute_plan_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            extra_env, home = self.make_cli_env(root)
            with patch.dict(os.environ, {"HOME": str(home)}):
                state_path = create_canonical_state_file(home)
            absolute_plan = root / ".claude" / "plans" / "legacy.md"
            absolute_plan.parent.mkdir(parents=True, exist_ok=True)
            absolute_plan.write_text(PLAN_FIXTURE, encoding="utf-8")

            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["plan_file"] = str(absolute_plan)
            state_path.write_text(json.dumps(state), encoding="utf-8")

            status_result = self.run_cli("--project-id", "proj-test", "status", cwd=root, extra_env=extra_env)
            self.assertEqual(status_result.returncode, 0, msg=status_result.stderr)
            payload = json.loads(status_result.stdout)
            self.assertEqual(payload["current_tasks"], ["T1"])
            self.assertEqual(payload["total_tasks"], 2)

    def test_task_manager_resolves_legacy_relative_plan_file_with_spaces_and_unicode(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            extra_env, home = self.make_cli_env(root)
            with patch.dict(os.environ, {"HOME": str(home)}):
                state_path = create_canonical_state_file(home)
            relative_plan = Path(".claude") / "plans" / "导出 计划.md"
            plan_path = root / relative_plan
            plan_path.parent.mkdir(parents=True, exist_ok=True)
            plan_path.write_text(PLAN_FIXTURE, encoding="utf-8")

            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["plan_file"] = relative_plan.as_posix()
            state_path.write_text(json.dumps(state), encoding="utf-8")

            status_result = self.run_cli("--project-id", "proj-test", "status", cwd=root, extra_env=extra_env)
            self.assertEqual(status_result.returncode, 0, msg=status_result.stderr)
            payload = json.loads(status_result.stdout)
            self.assertEqual(payload["current_tasks"], ["T1"])
            self.assertEqual(payload["total_tasks"], 2)

    def test_write_state_accepts_legacy_project_id_field(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home = Path(tmpdir)
            with patch.dict(os.environ, {"HOME": str(home)}):
                state_path = Path(resolve_state_path_by_project("proj-test"))
                state_path.parent.mkdir(parents=True, exist_ok=True)
                legacy_state = {
                    "projectId": "proj-test",
                    "status": "running",
                    "current_tasks": ["T1"],
                    "plan_file": ".claude/plans/test.md",
                    "spec_file": ".claude/specs/test.md",
                    "progress": {
                        "completed": [],
                        "blocked": [],
                        "failed": [],
                        "skipped": [],
                    },
                }
                state_manager.write_state(str(state_path), legacy_state)
                persisted = json.loads(state_path.read_text(encoding="utf-8"))
                self.assertEqual(persisted["project_id"], "proj-test")
                self.assertEqual(persisted["projectId"], "proj-test")

    def test_cli_status_and_context_include_runtime_summary(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            extra_env, home = self.make_cli_env(root)

            start_result = self.run_cli("start", "实现导出功能", cwd=root, extra_env=extra_env)
            self.assertEqual(start_result.returncode, 0, msg=start_result.stderr)
            start_payload = json.loads(start_result.stdout)
            project_id = start_payload["project_id"]
            state_path = self.workflow_state_path(home, project_id)

            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["delta_tracking"]["current_change"] = "CHG-002"
            state["discussion"]["completed"] = True
            state["ux_design"]["completed"] = True
            state["review_status"]["user_spec_review"]["status"] = "approved"
            state["quality_gates"]["T1"] = {"overall_passed": True}
            state_path.write_text(json.dumps(state), encoding="utf-8")

            status_result = self.run_cli("status", cwd=root, extra_env=extra_env)
            context_result = self.run_cli("context", cwd=root, extra_env=extra_env)
            self.assertEqual(status_result.returncode, 0, msg=status_result.stderr)
            self.assertEqual(context_result.returncode, 0, msg=context_result.stderr)

            status_payload = json.loads(status_result.stdout)
            context_payload = json.loads(context_result.stdout)

            self.assertEqual(status_payload["delta_tracking"]["current_change"], "CHG-002")
            self.assertTrue(status_payload["planning_gates"]["discussion"]["completed"])
            self.assertEqual(status_payload["planning_gates"]["user_spec_review"]["status"], "approved")
            self.assertEqual(status_payload["quality_gate_summary"]["passed"], ["T1"])
            self.assertEqual(context_payload["runtime"]["delta_tracking"]["current_change"], "CHG-002")
            self.assertEqual(context_payload["runtime"]["quality_gate_summary"]["count"], 1)


if __name__ == "__main__":
    unittest.main()
