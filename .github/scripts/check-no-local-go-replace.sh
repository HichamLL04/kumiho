#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backend_mod="${repo_root}/backend/go.mod"

disallow_local_replace() {
  echo "local replace directives are not allowed in backend/go.mod"
  echo "remove local development-only replace entries before pushing a PR"
  exit 1
}

if grep -Eq '^[[:space:]]*replace[[:space:]]+.+[[:space:]]+=>[[:space:]]+(\./|\.\./|/)' "${backend_mod}"; then
  disallow_local_replace
fi

if grep -Eq '^[[:space:]]+.+[[:space:]]+=>[[:space:]]+(\./|\.\./|/)' "${backend_mod}"; then
  disallow_local_replace
fi

gopath_value="$(go env GOPATH 2>/dev/null || true)"
if [ -n "${gopath_value}" ]; then
  IFS=':' read -r -a gopath_entries <<< "${gopath_value}"
  for gopath_entry in "${gopath_entries[@]}"; do
    if [ -n "${gopath_entry}" ] && grep -Eq "^[[:space:]]*(replace[[:space:]]+.+|.+)[[:space:]]+=>[[:space:]]+${gopath_entry}/" "${backend_mod}"; then
      disallow_local_replace
    fi
  done
fi
