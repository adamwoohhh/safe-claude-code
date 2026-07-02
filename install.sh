#!/usr/bin/env bash
set -euo pipefail

REPO="${AGENT_LAUNCHER_REPO:-${SCC_REPO:-adamwoohhh/agent-launcher}}"
REF="${AGENT_LAUNCHER_REF:-${SCC_REF:-main}}"
PACKAGE_SPEC="github:$REPO#$REF"

err() { echo "Error: $*" >&2; exit 1; }
info() { echo "==> $*"; }

command -v node >/dev/null 2>&1 || err "node is required"
command -v npm >/dev/null 2>&1 || err "npm is required"

node -e 'const [major] = process.versions.node.split(".").map(Number); process.exit(major >= 20 ? 0 : 1)' \
  || err "Node.js 20 or newer is required"

info "Installing $PACKAGE_SPEC"
npm install -g "$PACKAGE_SPEC"

PREFIX="$(npm prefix -g)"
BIN_DIR="$PREFIX/bin"
rm -f "$BIN_DIR/safe-claude-code" "$BIN_DIR/scc" "$BIN_DIR/scc-config"

info "Installed commands:"
info "  agent-launch"
info "  al"

case ":$PATH:" in
  *":$BIN_DIR:"*)
    info "$BIN_DIR is already in your PATH."
    ;;
  *)
    echo
    echo "Warning: $BIN_DIR is NOT in your PATH."
    echo "Add this to your shell profile:"
    echo
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    echo
    ;;
esac

cat <<'USAGE'

Quick start:
  al

Re-run this installer anytime to update.
USAGE
