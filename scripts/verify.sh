#!/usr/bin/env bash
#
# Puerta de calidad local — espejo de .github/workflows/ci.yml.
#
#   scripts/verify.sh              # install + lint + typecheck + test
#   scripts/verify.sh --build      # + build de producción (Next)
#   scripts/verify.sh shared       # solo el paquete indicado (--filter)
#
# Adaptado de scripts/verify.sh de SLXD (ADR-017): sin las apps de la suite ni
# las puertas de Docker/ClickHouse.
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD=false
FILTERS=()
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=true ;;
    *) FILTERS+=(--filter "$arg") ;;
  esac
done

export CI=true
step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }
start=$(date +%s)

step "Install (frozen lockfile)"
pnpm install --frozen-lockfile
ok "install"

step "Lint + Typecheck + Tests (turbo)"
pnpm turbo run lint typecheck test ${FILTERS[@]+"${FILTERS[@]}"}
ok "lint+typecheck+test"

if $BUILD; then
  step "Build (turbo)"
  pnpm turbo run build ${FILTERS[@]+"${FILTERS[@]}"}
  ok "build"
fi

printf '\n\033[1;32m✔ verify OK en %ss\033[0m\n' "$(( $(date +%s) - start ))"
