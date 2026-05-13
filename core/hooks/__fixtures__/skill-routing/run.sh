#!/usr/bin/env bash
# Manual fixture verification for skill-routing hook.
# Usage: bash core/hooks/__fixtures__/skill-routing/run.sh

set -u
HOOK="$(cd "$(dirname "$0")/../.." && pwd)/skill-routing.js"
FIXTURE_DIR="$(cd "$(dirname "$0")" && pwd)"
fail=0
total=0

# check NAME INPUT_FILE FILTER EXPECTED
# FILTER is JS expression evaluated against parsed output object `o`. Result is String()ified.
check() {
  local name="$1"
  local input_file="$2"
  local filter="$3"
  local expected="$4"
  total=$((total + 1))
  local actual
  actual=$(FILTER="$filter" node -e '
let d = "";
process.stdin.on("data", (c) => (d += c));
process.stdin.on("end", () => {
  try {
    const o = JSON.parse(d);
    const v = eval(process.env.FILTER);
    process.stdout.write(String(v));
  } catch (e) {
    process.stdout.write("ERR:" + e.message);
  }
});
' < <(node "$HOOK" < "$input_file") 2>/dev/null)
  if [ "$actual" = "$expected" ]; then
    echo "  PASS  $name"
  else
    echo "  FAIL  $name"
    echo "        filter:   $filter"
    echo "        expected: $expected"
    echo "        actual:   $actual"
    fail=$((fail + 1))
  fi
}

cd "$FIXTURE_DIR"

echo "Fixture 01 — figma + 还原 → figma-ui hint"
check "推荐 figma-ui" 01-figma-implement.input.json 'o.hookSpecificOutput.additionalContext.includes("agent-workflow:figma-ui")' "true"

echo "Fixture 02 — figma + 看下 → figma-data hint"
check "推荐 figma-data" 02-figma-read.input.json 'o.hookSpecificOutput.additionalContext.includes("agent-workflow:figma-data")' "true"
check "未推荐 figma-ui" 02-figma-read.input.json 'o.hookSpecificOutput.additionalContext.includes("agent-workflow:figma-ui")' "false"

echo "Fixture 03 — figma 无意图 → fallback figma-data"
check "推荐 figma-data" 03-figma-no-intent.input.json 'o.hookSpecificOutput.additionalContext.includes("agent-workflow:figma-data")' "true"

echo "Fixture 04 — alidocs"
check "推荐 alidocs" 04-alidocs.input.json 'o.hookSpecificOutput.additionalContext.includes("agent-workflow:alidocs")' "true"

echo "Fixture 05 — bk issue URL 不触发"
check "无 hookSpecificOutput" 05-bk-issue-not-intercepted.input.json '(o.hookSpecificOutput === undefined)' "true"

echo "Fixture 06 — 无 URL pattern"
check "无 hookSpecificOutput" 06-no-match.input.json '(o.hookSpecificOutput === undefined)' "true"

echo "Fixture 07 — ToolSearch 查 skill 名 → deny"
check "permissionDecision=deny" 07-toolsearch-skill-name.input.json 'o.hookSpecificOutput.permissionDecision' "deny"
check "reason 提到 figma-data" 07-toolsearch-skill-name.input.json 'o.hookSpecificOutput.permissionDecisionReason.includes("figma-data")' "true"

echo "Fixture 08 — ToolSearch 查泛词 figma → 放行"
check "无 permissionDecision" 08-toolsearch-fuzzy-figma.input.json '(o.hookSpecificOutput === undefined)' "true"

echo "Fixture 09 — ToolSearch 查真 deferred tool → 放行"
check "无 permissionDecision" 09-toolsearch-real-tool.input.json '(o.hookSpecificOutput === undefined)' "true"

echo "Fixture 10 — researcher 不应命中 research (词边界)"
check "无 permissionDecision" 10-toolsearch-substring-safe.input.json '(o.hookSpecificOutput === undefined)' "true"

echo "Fixture 11 — WebFetch 调用不被 ToolSearch hook 拦"
check "无 hookSpecificOutput" 11-other-tool-passthrough.input.json '(o.hookSpecificOutput === undefined)' "true"

echo "Fixture 12 — figma + alidocs 同时命中"
check "包含 figma-ui" 12-figma-and-alidocs.input.json 'o.hookSpecificOutput.additionalContext.includes("agent-workflow:figma-ui")' "true"
check "包含 alidocs"   12-figma-and-alidocs.input.json 'o.hookSpecificOutput.additionalContext.includes("agent-workflow:alidocs")' "true"

echo ""
echo "Fixture 13 — env vars disable hook"
for var in SKILL_ROUTING=0 WORKFLOW_HOOKS=0 AGENT_WORKFLOW_DISABLE_HOOKS=1 CLAUDE_NON_INTERACTIVE=1; do
  total=$((total + 1))
  actual=$(env "$var" node "$HOOK" < 13-skip-env-vars.input.json)
  if [ "$actual" = '{"continue":true}' ]; then
    echo "  PASS  $var disables hook"
  else
    echo "  FAIL  $var disables hook"
    echo "        actual: $actual"
    fail=$((fail + 1))
  fi
done

echo ""
if [ "$fail" -eq 0 ]; then
  echo "All $total checks passed."
  exit 0
else
  echo "$fail / $total checks FAILED."
  exit 1
fi
