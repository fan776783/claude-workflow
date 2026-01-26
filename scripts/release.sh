#!/usr/bin/env bash
# Release script - bump version, publish to private npm registry, and git tag

set -euo pipefail
trap 'echo "Error: release failed at line $LINENO" >&2' ERR

# Load .env if exists
if [[ -f .env ]]; then
  set -a; source .env; set +a
fi

if [[ -z "${NPM_REGISTRY_URL:-}" ]]; then
  echo "Error: NPM_REGISTRY_URL not set. Create .env file or export NPM_REGISTRY_URL" >&2
  exit 1
fi
REGISTRY_URL="$NPM_REGISTRY_URL"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Error: $1 not found" >&2; exit 1; }
}

usage() {
  cat <<'EOF'
Usage: ./scripts/release.sh <version-type>

version-type:
  patch   - Bug fixes (1.0.0 -> 1.0.1)
  minor   - New features (1.0.0 -> 1.1.0)
  major   - Breaking changes (1.0.0 -> 2.0.0)
  <x.y.z> - Explicit version

Environment:
  NPM_REGISTRY_URL - Registry URL (required, set in .env or export)

Examples:
  ./scripts/release.sh patch
  ./scripts/release.sh minor
  ./scripts/release.sh 2.0.0
EOF
}

confirm() {
  local reply
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[yY]$ ]]
}

main() {
  if [[ $# -ne 1 ]]; then
    usage
    exit 1
  fi

  local version_type="$1"

  # Validate version type
  if [[ "$version_type" != "patch" && "$version_type" != "minor" && "$version_type" != "major" ]]; then
    if ! [[ "$version_type" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "Error: invalid version type '$version_type'" >&2
      usage
      exit 1
    fi
  fi

  # Check required commands
  require_cmd node
  require_cmd npm

  # Check package.json exists
  if [[ ! -f package.json ]]; then
    echo "Error: package.json not found" >&2
    exit 1
  fi

  # Check git status
  local in_git=false
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    in_git=true
    if ! git diff --quiet || ! git diff --cached --quiet; then
      echo "Error: git working tree not clean. Commit or stash first." >&2
      exit 1
    fi
  fi

  local current_version
  current_version="$(node -p "require('./package.json').version")" || true
  [[ -z "$current_version" ]] && { echo "Error: failed to read version from package.json" >&2; exit 1; }

  echo ""
  echo "Release configuration:"
  echo "  Current version: $current_version"
  echo "  Version bump:    $version_type"
  echo "  Registry:        $REGISTRY_URL"
  echo ""

  if ! confirm "Proceed with release?"; then
    echo "Aborted."
    exit 0
  fi

  # Bump version (without git tag from npm)
  echo ""
  echo "[1/4] Bumping version..."
  npm version "$version_type" --no-git-tag-version

  local new_version
  new_version="$(node -p "require('./package.json').version")"
  [[ -z "$new_version" ]] && { echo "Error: failed to read new version" >&2; exit 1; }
  echo "      $current_version -> $new_version"

  # Publish
  echo ""
  echo "[2/4] Publishing to $REGISTRY_URL..."
  npm publish --registry="$REGISTRY_URL"
  echo "      Published successfully!"

  # Git operations
  if [[ "$in_git" == true ]]; then
    echo ""
    echo "[3/4] Creating git commit..."
    git add package.json
    [[ -f package-lock.json ]] && git add package-lock.json
    [[ -f npm-shrinkwrap.json ]] && git add npm-shrinkwrap.json
    git commit -m "chore(release): v$new_version"

    echo ""
    echo "[4/4] Creating git tag v$new_version..."
    git tag "v$new_version"

    if confirm "Push to origin?"; then
      git push origin HEAD
      git push origin "v$new_version"
      echo "      Pushed to origin"
    fi
  else
    echo ""
    echo "[3/4] Skipped (not in git repo)"
    echo "[4/4] Skipped (not in git repo)"
  fi

  echo ""
  echo "Release v$new_version completed!"
}

main "$@"
