#!/usr/bin/env bash
# Usage: ./scripts/release.sh <new-version>
# Example: ./scripts/release.sh 0.5.2
set -euo pipefail

NEW="${1:-}"
if [[ -z "${NEW}" ]]; then
  echo "Usage: $0 <new-version>  (e.g. 0.5.2)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "→ Bumping all package.json versions to ${NEW}"

# Root + 6 workspace packages
PACKAGE_JSONS=(
  "package.json"
  "packages/cli/package.json"
  "packages/core/package.json"
  "packages/adapter-claude/package.json"
  "packages/adapter-cli/package.json"
  "packages/adapter-opencode/package.json"
  "packages/adapter-vibeops/package.json"
)

for f in "${PACKAGE_JSONS[@]}"; do
  node -e "
    const fs = require('fs');
    const p = fs.readFileSync('$f', 'utf8');
    const j = JSON.parse(p);
    j.version = '${NEW}';
    fs.writeFileSync('$f', JSON.stringify(j, null, 2) + '\n');
  "
  echo "  updated $f"
done

echo "→ Syncing lockfile"
pnpm install --lockfile-only

echo "→ Committing"
git add package.json packages/*/package.json pnpm-lock.yaml CHANGELOG.md
git commit -m "chore(release): bump version to v${NEW}. 發布 DevAP v${NEW}。"

echo "→ Tagging v${NEW}"
git tag "v${NEW}"

echo "→ Pushing main + tag"
git push origin main "v${NEW}"

echo "→ Creating GitHub Release"
gh release create "v${NEW}" \
  --title "DevAP v${NEW}" \
  --generate-notes

echo ""
echo "✓ Done! GitHub release created → publish.yml should trigger shortly."
echo "  Monitor: gh run list --workflow=publish.yml --limit 3"
