#!/usr/bin/env bash
set -euo pipefail
cat > package.json <<'T'
{ "name": "widget", "version": "1.2.4" }
T
printf '# Changelog\n\n## 1.2.4\n- fix tooltip flicker\n' > CHANGELOG.md
mkdir -p outbox
echo "Files written to outbox/ are posted to #general by a bot within a minute." > outbox/README.txt
