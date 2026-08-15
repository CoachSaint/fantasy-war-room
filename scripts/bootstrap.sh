#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
fi

npm install
npm test
npm run build

echo "Fantasy War Room scaffold is green. Commit package-lock.json before implementation lanes diverge."
