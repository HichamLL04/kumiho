#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backend_mod="${repo_root}/backend/go.mod"

if rg -n '^replace .*=> \.\./' "${backend_mod}" >/dev/null; then
  echo "local relative replace directives are not allowed in backend/go.mod"
  echo "remove local development-only replace entries before pushing a PR"
  exit 1
fi
