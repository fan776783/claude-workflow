#!/usr/bin/env bash
# smoke-test.sh — read-only smoke test for the dingtalk-mcp CLI.
#
# Verifies (across all 3 MCP servers):
#   1. help / doctor (local-only, always exit 0)
#   2. list-tools for doc / aitable / sheet (schema cache populated)
#   3. ping (real HTTP to all 3 servers)
#   4. Safe reads: doc.search_documents, aitable.list_bases, sheet.get_all_sheets
#   5. SECURITY: doctor output never leaks full ?key=... value
#   6. SECURITY: config file is chmod 600
#   7. SECURITY: dangerous tools without --yes exit 3
#      (covers destroy / overwrite / schema-change / visibility /
#       structure-change across all 3 kinds; plus prefix fallback)
#   8. SECURITY: host allowlist rejects non-dingtalk hosts
#
# Exits non-zero on first failure; prints summary regardless.
# Tool-count thresholds are soft (≥ 20 doc, ≥ 40 aitable, ≥ 25 sheet) so
# server-side additions do NOT cause false failures.

set -u

CLI="$(cd -- "$(dirname -- "$0")" && pwd)/dingtalk-mcp.mjs"
PASS=0
FAIL=0
SKIP=0
FAILED_STEPS=()

hr() { printf '\n\033[90m──\033[0m \033[1m%s\033[0m \033[90m──\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); FAILED_STEPS+=("$*"); }
skip() { printf '  \033[33m·\033[0m %s (skipped: %s)\n' "$1" "$2"; SKIP=$((SKIP+1)); }

run() {
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

expect_exit() {
  # expect_exit <label> <expected_code> <cmd...>
  local label="$1" expected="$2"; shift 2
  local out err rc
  out=$(mktemp); err=$(mktemp)
  "$@" >"$out" 2>"$err"
  rc=$?
  if [[ "$rc" -eq "$expected" ]]; then
    ok "$label (exit=$rc)"
    rm -f "$out" "$err"
    return 0
  else
    bad "$label (expected exit $expected, got $rc)"
    [[ -s $err ]] && sed 's/^/      stderr: /' "$err" | head -5
    [[ -s $out ]] && sed 's/^/      stdout: /' "$out" | head -5
    rm -f "$out" "$err"
    return 1
  fi
}

# ── preflight ─────────────────────────────────────────────────────────────
hr "preflight"
if [[ ! -f "$CLI" ]]; then
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

if ! command -v python3 >/dev/null 2>&1; then
  bad "python3 not on PATH (used for JSON assertions)"
  exit 2
fi

# ── local-only commands ───────────────────────────────────────────────────
hr "local commands"
run "help"    node "$CLI" help

# ── doctor (always exit 0; inspect JSON) ──────────────────────────────────
hr "doctor"
DOCTOR_JSON=""
if capture "doctor" DOCTOR_JSON node "$CLI" doctor; then
  if echo "$DOCTOR_JSON" | python3 -c '
import json,sys
d=json.load(sys.stdin)
for k in ("doc","aitable","sheet"):
  assert d["servers"][k]["present"], f"{k} URL missing"
' 2>/dev/null; then
    ok "all three servers configured (doc / aitable / sheet)"
  else
    bad "one or more servers missing (run: node $CLI auth <doc|aitable|sheet> --stdin --verify <<< \"<url>\")"
  fi
  # Security: doctor must NOT leak a full ?key=... value. key_preview is fine
  # (contains "..."), but a raw 32-char hex key would be a red flag.
  if echo "$DOCTOR_JSON" | grep -qE '"key":\s*"[a-zA-Z0-9]{20,}"'; then
    bad "doctor leaked a full ?key= value (no '...' redaction)"
  else
    ok "doctor output redacted (no full key)"
  fi
  # config file mode should be 600
  MODE=$(echo "$DOCTOR_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("config_mode",""))' 2>/dev/null)
  if [[ "$MODE" == "600" ]]; then
    ok "config_mode=600"
  else
    bad "config_mode=$MODE (expected 600)"
  fi
else
  bad "doctor failed — cannot continue"
  exit 1
fi

# ── connectivity / tool listings ──────────────────────────────────────────
hr "connectivity"
run "ping all three servers reachable" bash -c "
  node '$CLI' ping | python3 -c '
import json, sys
d = json.load(sys.stdin)
for k in (\"doc\", \"aitable\", \"sheet\"):
  assert d[k][\"ok\"], k + \" unreachable: \" + str(d[k].get(\"error\"))
'
"

run "list-tools doc ≥ 20" bash -c "
  node '$CLI' list-tools doc | python3 -c '
import json,sys
d=json.load(sys.stdin)
c=d[\"doc\"][\"count\"]
assert c>=20, f\"doc tool count {c} < 20\"
'
"
run "list-tools aitable ≥ 40" bash -c "
  node '$CLI' list-tools aitable | python3 -c '
import json,sys
d=json.load(sys.stdin)
c=d[\"aitable\"][\"count\"]
assert c>=40, f\"aitable tool count {c} < 40\"
'
"
run "list-tools sheet ≥ 25" bash -c "
  node '$CLI' list-tools sheet | python3 -c '
import json,sys
d=json.load(sys.stdin)
c=d[\"sheet\"][\"count\"]
assert c>=25, f\"sheet tool count {c} < 25\"
'
"

run "schema doc.create_document required=['name']" bash -c "
  node '$CLI' schema doc.create_document | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert \"name\" in d[\"required\"], d[\"required\"]
'
"
run "schema aitable.delete_base marks destroy" bash -c "
  node '$CLI' schema aitable.delete_base | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d[\"danger\"] and d[\"danger\"][\"type\"]==\"destroy\", d[\"danger\"]
'
"
run "schema sheet.replace_all marks overwrite" bash -c "
  node '$CLI' schema sheet.replace_all | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d[\"danger\"] and d[\"danger\"][\"type\"]==\"overwrite\", d[\"danger\"]
'
"

# ── read-only API smoke ───────────────────────────────────────────────────
hr "read-only API"
run "doc search_documents --keyword test" \
  node "$CLI" doc search_documents --keyword test
run "aitable list_bases" \
  node "$CLI" aitable list_bases
run "sheet get_all_sheets (needs a nodeId; just verify --help shape)" bash -c "
  node '$CLI' schema sheet.get_all_sheets | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert \"nodeId\" in d[\"properties\"], d[\"properties\"].keys()
'
"

# ── security gates ────────────────────────────────────────────────────────
hr "security gates"
# explicit dangerous tool → exit 3 without --yes
expect_exit "aitable delete_base (no --yes) → exit 3" 3 \
  node "$CLI" aitable delete_base --baseId fake
# pattern fallback catches unknown dangerous verbs
expect_exit "aitable truncate_records (no --yes) → exit 3" 3 \
  node "$CLI" aitable truncate_records --tableId fake
# overwrite-class also gated
expect_exit "doc update_document (no --yes) → exit 3" 3 \
  node "$CLI" doc update_document --nodeId fake --markdown "x"
# visibility-class also gated
expect_exit "aitable update_dashboard_share (no --yes) → exit 3" 3 \
  node "$CLI" aitable update_dashboard_share --baseId fake --dashboardId fake
# new sheet kind — overwrite (replace_all, update_range, move_dimension)
expect_exit "sheet replace_all (no --yes) → exit 3" 3 \
  node "$CLI" sheet replace_all --nodeId fake --sheetId fake --find x --replacement y
expect_exit "sheet update_range (no --yes) → exit 3" 3 \
  node "$CLI" sheet update_range --nodeId fake --sheetId fake --rangeAddress "A1:B2"
# new sheet kind — destroy via prefix fallback (delete_dimension)
expect_exit "sheet delete_dimension (no --yes) → exit 3" 3 \
  node "$CLI" sheet delete_dimension --nodeId fake --sheetId fake
# structure-change
expect_exit "sheet unmerge_range (no --yes) → exit 3" 3 \
  node "$CLI" sheet unmerge_range --nodeId fake --sheetId fake --rangeAddress "A1:B2"

# host allowlist rejects non-dingtalk hosts
expect_exit "auth refuses non-allowlisted host" 2 \
  bash -c "echo 'https://evil.example.com/foo?key=xxxxxxxxxxxxxxxx' | node '$CLI' auth doc --stdin"

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
