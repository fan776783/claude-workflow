#!/usr/bin/env bash
# smoke-test.sh — read-only smoke test for the bk CLI.
#
# What it does (all read-only, no writes to bk-mcp):
#   1. help / list-tools / doctor (local only)
#   2. ping (opens an MCP session, no tool calls)
#   3. get_todolist (reads user's todo list)
#   4. list_issues (needs project_id — via arg, env BK_PROJECT_ID, or config)
#   5. get_issue (only if BK_SMOKE_ISSUE set or an issue_number was discovered)
#
# Exits non-zero on the first failure so it's CI-usable.
# Prints a final summary regardless.

set -u

CLI="$(cd -- "$(dirname -- "$0")" && pwd)/bk.mjs"
PASS=0
FAIL=0
SKIP=0
FAILED_STEPS=()

hr() { printf '\n\033[90m──\033[0m \033[1m%s\033[0m \033[90m──\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); FAILED_STEPS+=("$*"); }
skip() { printf '  \033[33m·\033[0m %s (skipped: %s)\n' "$1" "$2"; SKIP=$((SKIP+1)); }

run() {
  # run <label> <cmd...>
  # On success: prints ok. On failure: prints bad + stderr/stdout preview.
  local label="$1"; shift
  local out err rc
  out=$(mktemp); err=$(mktemp)
  if "$@" >"$out" 2>"$err"; then
    ok "$label"
    rm -f "$out" "$err"
    return 0
  else
    rc=$?
    bad "$label (exit $rc)"
    [[ -s $err ]] && sed 's/^/      stderr: /' "$err" | head -5
    [[ -s $out ]] && sed 's/^/      stdout: /' "$out" | head -5
    rm -f "$out" "$err"
    return $rc
  fi
}

capture() {
  # capture <label> <var> <cmd...>
  # Runs command; on success assigns its stdout to <var> and prints ok.
  local label="$1" var="$2"; shift 2
  local out err rc
  out=$(mktemp); err=$(mktemp)
  if "$@" >"$out" 2>"$err"; then
    printf -v "$var" '%s' "$(cat "$out")"
    ok "$label"
    rm -f "$out" "$err"
    return 0
  else
    rc=$?
    bad "$label (exit $rc)"
    [[ -s $err ]] && sed 's/^/      stderr: /' "$err" | head -5
    rm -f "$out" "$err"
    return $rc
  fi
}

# ── preflight ─────────────────────────────────────────────────────────────
hr "preflight"
if [[ ! -x "$CLI" ]] && [[ ! -f "$CLI" ]]; then
  bad "CLI not found at $CLI"
  exit 2
fi
ok "CLI located at $CLI"

if ! command -v node >/dev/null 2>&1; then
  bad "node not on PATH"
  exit 2
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if (( NODE_MAJOR < 18 )); then
  bad "node $NODE_MAJOR < 18 (CLI uses global fetch / ESM)"
  exit 2
fi
ok "node $(node -v)"

# ── local-only commands (no network) ──────────────────────────────────────
hr "local commands"
run "help"       node "$CLI" help
run "list-tools parses help output" bash -c "node '$CLI' help | grep -q 'tools (11)'"

# ── doctor & ping (hit the server, need token) ────────────────────────────
hr "connectivity"
DOCTOR_JSON=""
if capture "doctor" DOCTOR_JSON node "$CLI" doctor; then
  if echo "$DOCTOR_JSON" | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["token"]["present"],"no token"' 2>/dev/null; then
    ok "token present"
  else
    bad "token missing — run: node $CLI auth <token> (get one at https://mcp.300624.cn/api-keys)"
  fi
  if echo "$DOCTOR_JSON" | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["connectivity"]["ok"],d["connectivity"].get("error","")' 2>/dev/null; then
    ok "connectivity ok"
  else
    bad "connectivity failed (endpoint unreachable or auth rejected)"
    echo "$DOCTOR_JSON" | python3 -c 'import json,sys;print("      ", json.load(sys.stdin)["connectivity"])' 2>/dev/null || true
  fi
else
  bad "doctor failed — cannot continue"
  exit 1
fi

run "list-tools returns 11 tools" bash -c \
  "node '$CLI' list-tools | python3 -c 'import json,sys;ts=json.load(sys.stdin);assert len(ts)==11,f\"got {len(ts)}\"'"

# ── read-only API smoke ───────────────────────────────────────────────────
hr "read-only API"

TODO_JSON=""
DISCOVERED_ISSUE=""
DISCOVERED_PID=""
if capture "get_todolist (page=1, size=1)" TODO_JSON \
     node "$CLI" get_todolist --page 1 --size 1; then
  DISCOVERED_ISSUE=$(echo "$TODO_JSON" | python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
    items=d.get("items") or []
    print(items[0]["number"] if items else "")
except Exception:
    pass
' 2>/dev/null)
  DISCOVERED_PID=$(echo "$TODO_JSON" | python3 -c '
import json,sys,re
try:
    d=json.load(sys.stdin)
    items=d.get("items") or []
    if items:
        m=re.search(r"/vteam/(v\d+)/", items[0].get("url",""))
        print(m.group(1) if m else "")
except Exception:
    pass
' 2>/dev/null)
  [[ -n $DISCOVERED_ISSUE ]] && ok "  discovered issue: $DISCOVERED_ISSUE"
  [[ -n $DISCOVERED_PID   ]] && ok "  discovered project_id: $DISCOVERED_PID"
fi

# list_issues — needs a project_id from somewhere
PID=""
PID_SRC=""
if [[ -n "${BK_SMOKE_PROJECT_ID:-}" ]]; then
  PID="$BK_SMOKE_PROJECT_ID"; PID_SRC="env BK_SMOKE_PROJECT_ID"
elif [[ -n "${BK_PROJECT_ID:-}" ]]; then
  PID="$BK_PROJECT_ID"; PID_SRC="env BK_PROJECT_ID"
elif echo "$DOCTOR_JSON" | python3 -c 'import json,sys;v=json.load(sys.stdin)["project_id"]["value"];sys.exit(0 if v else 1)' 2>/dev/null; then
  PID=$(echo "$DOCTOR_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["project_id"]["value"])')
  PID_SRC="doctor (config)"
elif [[ -n "$DISCOVERED_PID" ]]; then
  PID="$DISCOVERED_PID"; PID_SRC="discovered from todolist"
fi

if [[ -n "$PID" ]]; then
  ok "  using project_id=$PID (from $PID_SRC)"
  run "list_issues (page_size=1)" \
    node "$CLI" list_issues --project_id "$PID" --page 1 --page_size 1
else
  skip "list_issues" "no project_id available (set BK_SMOKE_PROJECT_ID or run 'bk project set <v...>')"
fi

# get_issue — prefer explicit BK_SMOKE_ISSUE, else discovered
ISSUE="${BK_SMOKE_ISSUE:-$DISCOVERED_ISSUE}"
if [[ -n "$ISSUE" ]]; then
  run "get_issue $ISSUE" node "$CLI" get_issue --issue_number "$ISSUE"
else
  skip "get_issue" "no issue_number available (set BK_SMOKE_ISSUE)"
fi

# update_issue dry_run — safe, no write
if [[ -n "$ISSUE" ]]; then
  run "update_issue --dry_run --list_fields" \
    node "$CLI" update_issue --issue_number "$ISSUE" --dry_run true --list_fields true
fi

# transition_issue --list_states — safe, no write
if [[ -n "$ISSUE" ]]; then
  run "transition_issue --list_states" \
    node "$CLI" transition_issue --issue_number "$ISSUE" --list_states true
fi

# ── summary ───────────────────────────────────────────────────────────────
hr "summary"
printf '  passed: %d   failed: %d   skipped: %d\n' "$PASS" "$FAIL" "$SKIP"
if (( FAIL > 0 )); then
  printf '\n\033[31mfailures:\033[0m\n'
  for s in "${FAILED_STEPS[@]}"; do printf '  - %s\n' "$s"; done
  exit 1
fi
printf '\n\033[32mall checks passed.\033[0m\n'
exit 0
