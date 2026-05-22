#!/usr/bin/env bash
set -euo pipefail

REPO="${SCC_REPO:-adamwoohhh/safe-claude-code}"
REF="${SCC_REF:-main}"
INSTALL_DIR="${SCC_INSTALL_DIR:-$HOME/.local/bin}"
SCRIPT_URL="https://raw.githubusercontent.com/$REPO/$REF/safe-claude-code.sh"
CONFIG_SCRIPT_URL="https://raw.githubusercontent.com/$REPO/$REF/scc-config.sh"

err() { echo "❌ $*" >&2; exit 1; }
info() { echo "==> $*"; }

command -v curl >/dev/null 2>&1 || err "curl is required"
command -v bash >/dev/null 2>&1 || err "bash is required"

info "Installing from $SCRIPT_URL"
info "Target dir:    $INSTALL_DIR"

mkdir -p "$INSTALL_DIR"

TARGET="$INSTALL_DIR/safe-claude-code"
CONFIG_TARGET="$INSTALL_DIR/scc-config"
TMP="$(mktemp)"
TMP_CONFIG="$(mktemp)"
trap 'rm -f "$TMP" "$TMP_CONFIG"' EXIT

curl -fsSL "$SCRIPT_URL" -o "$TMP" || err "Download failed: $SCRIPT_URL"
curl -fsSL "$CONFIG_SCRIPT_URL" -o "$TMP_CONFIG" || err "Download failed: $CONFIG_SCRIPT_URL"

head -n1 "$TMP" | grep -q '^#!/usr/bin/env bash$' || err "Downloaded file doesn't look like the script"
head -n1 "$TMP_CONFIG" | grep -q '^#!/usr/bin/env bash$' || err "Downloaded config tool doesn't look like the script"

mv "$TMP" "$TARGET"
chmod +x "$TARGET"

mv "$TMP_CONFIG" "$CONFIG_TARGET"
chmod +x "$CONFIG_TARGET"

ln -sf safe-claude-code "$INSTALL_DIR/scc"

info "Installed:"
info "  $TARGET"
info "  $INSTALL_DIR/scc -> safe-claude-code"
info "  $CONFIG_TARGET"

case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    info "$INSTALL_DIR is already in your PATH."
    ;;
  *)
    echo
    echo "⚠️  $INSTALL_DIR is NOT in your PATH."
    echo "    Add this to ~/.zshrc or ~/.bashrc:"
    echo
    echo "      export PATH=\"$INSTALL_DIR:\$PATH\""
    echo
    ;;
esac

cat <<'USAGE'

Quick start:
  # whitelist by country (glob, case-insensitive)
  SCC_country=CN,HK scc

  # or edit the config file via the helper
  scc-config edit         # opens $EDITOR on rules.conf (creates a template)
  scc-config show         # print the effective rules
  scc

Re-run this installer anytime to update.
USAGE
