#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${SCC_CONFIG_FILE:-$HOME/.config/safe-claude-code/rules.conf}"

usage() {
  cat <<EOF
Usage: scc-config <command>

Commands:
  edit    Open the rules file in \$EDITOR (creates a template if missing)
  show    Print the effective rules (file merged with SCC_* env vars)
  path    Print the rules file path

Env:
  SCC_CONFIG_FILE   Override config file path
                    (current: $CONFIG_FILE)
  EDITOR            Editor used by 'edit' (default: vi)
EOF
}

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

cmd_edit() {
  mkdir -p "$(dirname "$CONFIG_FILE")"
  if [[ ! -f "$CONFIG_FILE" ]]; then
    cat > "$CONFIG_FILE" <<'TEMPLATE'
# safe-claude-code rules
# Format: field=pattern1,pattern2,...   (glob, case-insensitive)
# Available fields: ip city region country loc org postal timezone
# Lines starting with # are comments.

# country=CN,HK
# timezone=Asia/*
TEMPLATE
  fi
  exec "${EDITOR:-vi}" "$CONFIG_FILE"
}

cmd_show() {
  local -a keys=() vals=() srcs=()
  local i k v name field line

  set_rule() {
    local kk="$1" vv="$2" ss="$3"
    for i in "${!keys[@]}"; do
      if [[ "${keys[$i]}" == "$kk" ]]; then
        vals[$i]="$vv"; srcs[$i]="$ss"
        return
      fi
    done
    keys+=("$kk"); vals+=("$vv"); srcs+=("$ss")
  }

  if [[ -f "$CONFIG_FILE" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="$(trim "$line")"
      [[ -z "$line" || "$line" == \#* ]] && continue
      [[ "$line" != *=* ]] && continue
      k="$(trim "${line%%=*}")"
      v="${line#*=}"
      [[ -n "$k" ]] && set_rule "$k" "$v" "file"
    done < "$CONFIG_FILE"
  fi

  for name in "${!SCC_@}"; do
    field="${name#SCC_}"
    [[ "$field" == "CONFIG_FILE" || "$field" == "API" ]] && continue
    set_rule "$field" "${!name}" "env:$name"
  done

  echo "# Config file: $CONFIG_FILE"
  [[ -f "$CONFIG_FILE" ]] || echo "# (file does not exist — run 'scc-config edit' to create)"
  echo

  if (( ${#keys[@]} == 0 )); then
    echo "# (no rules configured — scc will refuse to run)"
    return 0
  fi

  for i in "${!keys[@]}"; do
    printf '%-32s  # from %s\n' "${keys[$i]}=${vals[$i]}" "${srcs[$i]}"
  done
}

cmd="${1:-}"
case "$cmd" in
  edit)        cmd_edit ;;
  show)        cmd_show ;;
  path)        printf '%s\n' "$CONFIG_FILE" ;;
  ""|-h|--help|help) usage ;;
  *)
    echo "Unknown command: $cmd" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac
