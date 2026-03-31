import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "templates" / "skills" / "workflow" / "scripts"
CLI_SCRIPT = SCRIPT_DIR / "workflow_cli.py"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import execution_sequencer
import lifecycle_cmds
import planning_gates
import quality_review
import self_review
import verification
from plan_delta import apply_task_deltas, build_task_delta_examples


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
        deltas = build_task_delta_examples("CHG-001", {"description": "新增导出字段"})
        self.assertEqual([delta["action"] for delta in deltas], ["add", "modify", "remove"])


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
            state_path = Path(tmpdir) / "workflow-state.json"
            state_path.write_text(json.dumps(minimum_state()), encoding="utf-8")
            gate = quality_review.build_pass_gate_result(task_id="T3", base_commit="abc123")

            quality_review.write_quality_gate_result(str(state_path), "T3", gate)
            review = quality_review.read_quality_gate_result(str(state_path), "T3")

            self.assertIsNotNone(review)
            self.assertTrue(review["overall_passed"])
            self.assertEqual(review["gate_task_id"], "T3")


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

    def test_decide_governance_action_budget_and_quality_gate(self):
        state = minimum_state()
        state["contextMetrics"] = {
            "projectedUsagePercent": 85,
            "warningThreshold": 60,
            "dangerThreshold": 80,
            "hardHandoffThreshold": 90,
        }
        pause_result = execution_sequencer.decide_governance_action(state)
        self.assertEqual(pause_result["action"], "pause-budget")

        state["contextMetrics"]["projectedUsagePercent"] = 20
        quality_gate_result = execution_sequencer.decide_governance_action(
            state,
            next_task={"quality_gate": True, "actions": []},
        )
        self.assertEqual(quality_gate_result["action"], "pause-quality-gate")

    def test_apply_governance_decision_updates_continuation(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            state_path = Path(tmpdir) / "workflow-state.json"
            state_path.write_text(json.dumps(minimum_state()), encoding="utf-8")
            state = json.loads(state_path.read_text(encoding="utf-8"))

            updated = execution_sequencer.apply_governance_decision(
                state,
                {"action": "pause-budget", "reason": "context-danger", "severity": "warning"},
                str(state_path),
                ["T2"],
            )

            self.assertEqual(updated["status"], "paused")
            persisted = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["continuation"]["last_decision"]["action"], "pause-budget")
            self.assertEqual(persisted["continuation"]["last_decision"]["nextTaskIds"], ["T2"])

    def test_mark_task_skipped_advances_to_next_task(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            state_path = root / "workflow-state.json"
            tasks_path = root / "plan.md"
            state_path.write_text(json.dumps(minimum_state()), encoding="utf-8")
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
            self.assertIn("T1", updated_state["progress"]["skipped"])
            self.assertIn("⏭️", updated_plan)

    def test_prepare_retry_sets_running_and_hard_stop(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            state_path = Path(tmpdir) / "workflow-state.json"
            state = minimum_state(status="failed")
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
    def run_cli(self, *args, cwd=None, extra_env=None):
        env = os.environ.copy()
        pythonpath = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = f"{SCRIPT_DIR}{os.pathsep}{pythonpath}" if pythonpath else str(SCRIPT_DIR)
        if extra_env:
            env.update(extra_env)
        return subprocess.run(
            [sys.executable, str(CLI_SCRIPT), *args],
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
            self.assertEqual(delta_payload["task_delta_summary"]["remove"], 1)

            plan_path = root / start_payload["plan_file"]
            plan_content = plan_path.read_text(encoding="utf-8")
            self.assertIn("响应增量变更 CHG-001", plan_content)
            self.assertIn("第一个任务（增量调整）", plan_content)
            self.assertNotIn("## T2: 第二个任务", plan_content)

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
