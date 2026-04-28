#!/usr/bin/env bash
# Publish public-facing changes from master to origin/main.
#
# master = full repo (public + internal skills, docs, hooks)
# main   = public-only mirror pushed to GitHub origin
#
# Strategy: rsync master's working tree onto a temporary checkout of main,
# with an explicit exclude list for internal paths. The exclude list is the
# single source of truth for "what stays gitlab-only" — edit it when you
# add or remove an internal skill / doc.

set -euo pipefail
trap 'echo "Error: publish-public failed at line $LINENO" >&2' ERR

MASTER_BRANCH="master"
PUBLIC_BRANCH="main"
PUBLIC_REMOTE="origin"

# Paths that MUST NOT appear in origin/main. Prefixes are matched against
# git ls-files output (relative to repo root). Add entries here when a new
# internal skill or doc is introduced.
INTERNAL_PATHS=(
  "core/skills/bk/"
  "core/skills/bug-batch/"
  "core/skills/fix-bug/"
  "docs/internal/"
  ".claude/doc-sync.json"
  ".claude/hooks/doc-sync-notify.js"
  ".claude/settings.json"
)

# Files whose master version references internal paths and therefore cannot
# be cleanly mirrored. Left untouched on main — edit them there by hand if
# the public-facing content genuinely needs to change.
KEEP_MAIN_VERSION=(
  "README.md"
  ".gitignore"
)

usage() {
  cat <<'EOF'
Usage: ./scripts/publish-public.sh [--dry-run]

Syncs public-facing files from master to main, pushes main to origin.
Run from a clean working tree on any branch.

  --dry-run   Show what would change without committing or pushing.

Editing the exclude list:
  Open scripts/publish-public.sh and edit INTERNAL_PATHS or
  KEEP_MAIN_VERSION at the top.
EOF
}

confirm() {
  local reply
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[yY]$ ]]
}

main() {
  local dry_run=false
  if [[ ${#} -gt 1 ]]; then usage; exit 1; fi
  if [[ ${#} -eq 1 ]]; then
    case "$1" in
      --dry-run) dry_run=true ;;
      -h|--help) usage; exit 0 ;;
      *) usage; exit 1 ;;
    esac
  fi

  # Must be inside the repo
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    echo "Error: not inside a git repo" >&2; exit 1;
  }

  # Working tree must be clean
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Error: working tree not clean. Commit or stash first." >&2
    exit 1
  fi

  local original_branch
  original_branch="$(git rev-parse --abbrev-ref HEAD)"

  # Refresh refs
  echo "→ Fetching ${PUBLIC_REMOTE}/${PUBLIC_BRANCH}..."
  git fetch "$PUBLIC_REMOTE" "$PUBLIC_BRANCH" >/dev/null

  # Verify master has new commits master -> main
  local ahead
  ahead="$(git rev-list --count "${PUBLIC_REMOTE}/${PUBLIC_BRANCH}..${MASTER_BRANCH}")"
  if [[ "$ahead" == "0" ]]; then
    echo "No commits on ${MASTER_BRANCH} ahead of ${PUBLIC_REMOTE}/${PUBLIC_BRANCH}. Nothing to sync."
    exit 0
  fi
  echo "  ${MASTER_BRANCH} is ${ahead} commit(s) ahead of ${PUBLIC_REMOTE}/${PUBLIC_BRANCH}"

  # Build the list of master files minus internal paths.
  # -z is critical: without it git ls-tree quotes non-ASCII paths (e.g. CJK
  # filenames become "docs/internal/\345...md"), breaking ^prefix matching.
  local master_files
  master_files="$(git ls-tree -r -z --name-only "$MASTER_BRANCH" | tr '\0' '\n')"

  # Filter out internal paths
  local filter_expr=""
  for p in "${INTERNAL_PATHS[@]}"; do
    filter_expr+="|^${p//./\\.}"
  done
  filter_expr="${filter_expr:1}"  # strip leading |

  for p in "${KEEP_MAIN_VERSION[@]}"; do
    filter_expr+="|^${p//./\\.}$"
  done

  local sync_files
  sync_files="$(echo "$master_files" | grep -Ev "$filter_expr" || true)"
  if [[ -z "$sync_files" ]]; then
    echo "Error: computed empty sync list. Aborting." >&2
    exit 1
  fi

  # Switch to main
  echo ""
  echo "→ Checking out ${PUBLIC_BRANCH}..."
  git checkout "$PUBLIC_BRANCH" >/dev/null
  git pull --ff-only "$PUBLIC_REMOTE" "$PUBLIC_BRANCH" >/dev/null

  # Restore the ORIG_BRANCH trap so a failed checkout of files doesn't leave
  # the user stranded on main.
  trap 'git checkout "$original_branch" >/dev/null 2>&1 || true; echo "Error: publish-public aborted; restored branch $original_branch" >&2' ERR

  # Overlay master's public files onto main. Use NUL-delimited xargs so
  # paths with spaces or non-ASCII bytes survive intact.
  echo "→ Applying ${MASTER_BRANCH} tree (excluding internal paths)..."
  printf '%s\n' "$sync_files" | tr '\n' '\0' | \
    xargs -0 git checkout "$MASTER_BRANCH" --

  # Delete any files that exist on main but are no longer on master
  # (excluding internal & keep-main paths)
  local main_files stale_files
  main_files="$(git ls-tree -r -z --name-only HEAD | tr '\0' '\n')"
  stale_files="$(comm -23 \
    <(echo "$main_files" | grep -Ev "$filter_expr" | sort) \
    <(echo "$sync_files" | sort))"
  if [[ -n "$stale_files" ]]; then
    echo "→ Removing files that no longer exist on ${MASTER_BRANCH}:"
    printf '%s\n' "$stale_files" | sed 's/^/    /'
    printf '%s\n' "$stale_files" | tr '\n' '\0' | xargs -0 -r git rm --quiet
  fi

  # Safety check: no internal path should be staged
  local leak
  leak="$(git diff --cached --name-only | grep -E "$(printf '^%s|' "${INTERNAL_PATHS[@]}" | sed 's/|$//')" || true)"
  if [[ -n "$leak" ]]; then
    echo "Error: internal paths leaked into staging, aborting:" >&2
    echo "$leak" >&2
    git reset --hard "HEAD" >/dev/null
    git checkout "$original_branch" >/dev/null
    exit 1
  fi

  if git diff --cached --quiet; then
    echo "No public-facing changes to sync."
    git checkout "$original_branch" >/dev/null
    exit 0
  fi

  echo ""
  echo "→ Files staged for sync:"
  git diff --cached --stat | sed 's/^/    /'

  if [[ "$dry_run" == true ]]; then
    echo ""
    echo "Dry run — reverting and returning to $original_branch."
    git reset --hard "${PUBLIC_REMOTE}/${PUBLIC_BRANCH}" >/dev/null
    git checkout "$original_branch" >/dev/null
    exit 0
  fi

  # Run validation before committing
  echo ""
  echo "→ Running npm run prepublishOnly..."
  if ! npm run prepublishOnly; then
    echo "Error: validation failed. Leaving changes staged on $PUBLIC_BRANCH for inspection." >&2
    exit 1
  fi

  if ! confirm "Proceed with commit and push to ${PUBLIC_REMOTE}/${PUBLIC_BRANCH}?"; then
    echo "Aborted — reverting."
    git reset --hard "${PUBLIC_REMOTE}/${PUBLIC_BRANCH}" >/dev/null
    git checkout "$original_branch" >/dev/null
    exit 0
  fi

  # Commit
  local message
  message="chore: sync public-facing changes from ${MASTER_BRANCH}

Cherry-pick via scripts/publish-public.sh. Internal skills, docs, and
hooks (see INTERNAL_PATHS in the script) remain gitlab-only."
  git commit -m "$message"

  # Push
  echo ""
  echo "→ Pushing to ${PUBLIC_REMOTE}/${PUBLIC_BRANCH}..."
  git push "$PUBLIC_REMOTE" "$PUBLIC_BRANCH"

  # Restore original branch
  git checkout "$original_branch" >/dev/null
  trap - ERR

  echo ""
  echo "Done. ${PUBLIC_REMOTE}/${PUBLIC_BRANCH} updated."
}

main "$@"
