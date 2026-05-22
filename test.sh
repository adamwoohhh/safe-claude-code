#!/usr/bin/env bash
# Unit tests for safe-claude-code.sh and scc-config.sh.
# All tests run in an isolated temp dir with mocked curl/claude.
# Nothing under $HOME or /etc is touched.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAIN="$SCRIPT_DIR/safe-claude-code.sh"
CONFIG_TOOL="$SCRIPT_DIR/scc-config.sh"

[[ -f "$MAIN" ]]        || { echo "missing: $MAIN" >&2; exit 1; }
[[ -f "$CONFIG_TOOL" ]] || { echo "missing: $CONFIG_TOOL" >&2; exit 1; }

PASS=0
FAIL=0
FAILED=()

# ---------- fixtures ----------

# Set up a clean per-test sandbox. Called inside each test's subshell.
setup_env() {
  TMP="$(mktemp -d)"
  mkdir -p "$TMP/bin" "$TMP/config"
  CONFIG_FILE="$TMP/config/rules.conf"
  CLAUDE_LOG="$TMP/claude.log"

  # Fake `claude` — records args, prints a sentinel, exits 0.
  cat > "$TMP/bin/claude" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$CLAUDE_LOG"
echo MOCK_CLAUDE_CALLED
exit 0
EOF
  chmod +x "$TMP/bin/claude"

  # Fake `curl` — ignores args, returns \$MOCK_RESP, or fails if MOCK_CURL_FAIL=1.
  cat > "$TMP/bin/curl" <<'EOF'
#!/usr/bin/env bash
if [[ "${MOCK_CURL_FAIL:-0}" == "1" ]]; then
  exit 22
fi
printf '%s' "${MOCK_RESP:-{\}}"
EOF
  chmod +x "$TMP/bin/curl"

  export PATH="$TMP/bin:$PATH"
  export SCC_CONFIG_FILE="$CONFIG_FILE"

  # Strip any SCC_* the user already has in their shell, so tests are deterministic.
  local v
  for v in $(env | awk -F= '/^SCC_/ {print $1}'); do
    [[ "$v" == "SCC_CONFIG_FILE" ]] && continue
    unset "$v"
  done
}

cleanup_env() { rm -rf "$TMP"; }

# ---------- assertions ----------

assert_eq() {
  local got="$1" want="$2" msg="${3:-values differ}"
  if [[ "$got" != "$want" ]]; then
    printf '    %s\n      want: %q\n      got:  %q\n' "$msg" "$want" "$got" >&2
    return 1
  fi
}

assert_contains() {
  local hay="$1" needle="$2" msg="${3:-output missing substring}"
  if [[ "$hay" != *"$needle"* ]]; then
    printf '    %s\n      needle: %q\n      output: %s\n' "$msg" "$needle" "$hay" >&2
    return 1
  fi
}

assert_not_contains() {
  local hay="$1" needle="$2" msg="${3:-output contains forbidden substring}"
  if [[ "$hay" == *"$needle"* ]]; then
    printf '    %s\n      needle: %q\n      output: %s\n' "$msg" "$needle" "$hay" >&2
    return 1
  fi
}

# ---------- runner ----------

run_test() {
  local name="$1" fn="$2"
  (
    setup_env
    trap cleanup_env EXIT
    "$fn"
  )
  local rc=$?
  if (( rc == 0 )); then
    echo "  ok   $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL $name"
    FAIL=$((FAIL + 1))
    FAILED+=("$name")
  fi
}

# ========== scc-config tests ==========

t_config_help() {
  out="$("$CONFIG_TOOL" help 2>&1)"
  assert_contains "$out" "Usage: scc-config"
}

t_config_path() {
  out="$("$CONFIG_TOOL" path)"
  assert_eq "$out" "$CONFIG_FILE"
}

t_config_show_empty() {
  out="$("$CONFIG_TOOL" show)"
  assert_contains "$out" "no rules configured"
}

t_config_show_reads_file() {
  cat > "$CONFIG_FILE" <<EOF
# comment line
country=CN,HK

timezone=Asia/*
EOF
  out="$("$CONFIG_TOOL" show)"
  assert_contains "$out" "country=CN,HK"   || return 1
  assert_contains "$out" "timezone=Asia/*" || return 1
  assert_contains "$out" "from file"
}

t_config_env_overrides_file() {
  echo "country=US" > "$CONFIG_FILE"
  out="$(SCC_country=CN,HK "$CONFIG_TOOL" show)"
  assert_contains "$out" "country=CN,HK"        || return 1
  assert_contains "$out" "from env:SCC_country" || return 1
  assert_not_contains "$out" "country=US"
}

t_config_skips_reserved_vars() {
  out="$(SCC_API=http://example.com SCC_country=CN "$CONFIG_TOOL" show)"
  assert_contains     "$out" "country=CN" || return 1
  assert_not_contains "$out" "API="       || return 1
  assert_not_contains "$out" "CONFIG_FILE="
}

t_config_ignores_blank_and_comment_lines() {
  cat > "$CONFIG_FILE" <<EOF

# this is a comment
   # indented comment

country=CN
EOF
  out="$("$CONFIG_TOOL" show)"
  # Only one rule should appear.
  local n
  n="$(printf '%s\n' "$out" | grep -c '^[a-z]')"
  assert_eq "$n" "1" "expected exactly one rule line"
}

t_config_unknown_command_exits_1() {
  out="$("$CONFIG_TOOL" bogus 2>&1)"
  local rc=$?
  assert_eq "$rc" "1"                       || return 1
  assert_contains "$out" "Unknown command"
}

t_config_edit_creates_template() {
  EDITOR=true "$CONFIG_TOOL" edit
  [[ -f "$CONFIG_FILE" ]] || { echo "    config file was not created" >&2; return 1; }
  local content; content="$(cat "$CONFIG_FILE")"
  assert_contains "$content" "safe-claude-code rules"
}

t_config_edit_preserves_existing_file() {
  printf 'country=CN\n' > "$CONFIG_FILE"
  EDITOR=true "$CONFIG_TOOL" edit
  local content; content="$(cat "$CONFIG_FILE")"
  assert_eq "$content" "country=CN" "existing file should be untouched"
}

# ========== safe-claude-code tests ==========

t_main_no_rules_denies() {
  export MOCK_RESP='{"country":"CN"}'
  out="$(bash "$MAIN" 2>&1)"
  local rc=$?
  assert_eq "$rc" "1"                          || return 1
  assert_contains "$out" "No rules configured"
}

t_main_country_match_runs_claude() {
  export MOCK_RESP='{"country":"CN","timezone":"Asia/Shanghai"}'
  echo "country=CN,HK" > "$CONFIG_FILE"
  out="$(bash "$MAIN" 2>&1)"
  assert_contains "$out" "MOCK_CLAUDE_CALLED"
}

t_main_country_mismatch_denies() {
  export MOCK_RESP='{"country":"US"}'
  echo "country=CN,HK" > "$CONFIG_FILE"
  out="$(bash "$MAIN" 2>&1)"
  local rc=$?
  assert_eq "$rc" "1"                       || return 1
  assert_contains "$out" "does not match"   || return 1
  assert_not_contains "$out" "MOCK_CLAUDE_CALLED"
}

t_main_glob_match() {
  export MOCK_RESP='{"country":"CN","timezone":"Asia/Shanghai"}'
  echo "timezone=Asia/*" > "$CONFIG_FILE"
  out="$(bash "$MAIN" 2>&1)"
  assert_contains "$out" "MOCK_CLAUDE_CALLED"
}

t_main_case_insensitive() {
  export MOCK_RESP='{"country":"cn"}'
  echo "country=CN" > "$CONFIG_FILE"
  out="$(bash "$MAIN" 2>&1)"
  assert_contains "$out" "MOCK_CLAUDE_CALLED"
}

t_main_multi_pattern_any_match() {
  export MOCK_RESP='{"country":"HK"}'
  echo "country=CN,HK,TW" > "$CONFIG_FILE"
  out="$(bash "$MAIN" 2>&1)"
  assert_contains "$out" "MOCK_CLAUDE_CALLED"
}

t_main_env_overrides_file() {
  export MOCK_RESP='{"country":"CN"}'
  echo "country=US" > "$CONFIG_FILE"   # file says only US is OK
  out="$(SCC_country=CN bash "$MAIN" 2>&1)"
  assert_contains "$out" "MOCK_CLAUDE_CALLED"
}

t_main_args_forwarded_to_claude() {
  export MOCK_RESP='{"country":"CN"}'
  echo "country=CN" > "$CONFIG_FILE"
  bash "$MAIN" --foo bar 'baz qux' >/dev/null 2>&1
  local got want
  got="$(cat "$CLAUDE_LOG")"
  want=$'--foo\nbar\nbaz qux'
  assert_eq "$got" "$want" "args were not forwarded verbatim"
}

t_main_field_missing_in_response() {
  export MOCK_RESP='{"country":"CN"}'
  echo "city=Beijing" > "$CONFIG_FILE"   # response has no "city"
  out="$(bash "$MAIN" 2>&1)"
  local rc=$?
  assert_eq "$rc" "1"                  || return 1
  assert_contains "$out" "not present"
}

t_main_curl_failure_denies() {
  echo "country=CN" > "$CONFIG_FILE"
  out="$(MOCK_CURL_FAIL=1 bash "$MAIN" 2>&1)"
  local rc=$?
  assert_eq "$rc" "1"                       || return 1
  assert_contains "$out" "Failed to fetch"
}

t_main_invalid_json_denies() {
  export MOCK_RESP='not json at all'
  echo "country=CN" > "$CONFIG_FILE"
  out="$(bash "$MAIN" 2>&1)"
  local rc=$?
  assert_eq "$rc" "1"                     || return 1
  assert_contains "$out" "Invalid JSON"
}

t_main_reserved_env_not_treated_as_rule() {
  # Only SCC_API is set (which is reserved). No rules → should deny with "No rules configured",
  # NOT try to match an "API" field.
  export MOCK_RESP='{"country":"CN"}'
  out="$(SCC_API=http://example.com bash "$MAIN" 2>&1)"
  local rc=$?
  assert_eq "$rc" "1"                                 || return 1
  assert_contains "$out" "No rules configured"
}

# ---------- driver ----------

echo "scc-config:"
run_test "help prints usage"                          t_config_help
run_test "path prints rules file path"                t_config_path
run_test "show with no rules"                         t_config_show_empty
run_test "show reads rules from file"                 t_config_show_reads_file
run_test "env overrides file in show output"          t_config_env_overrides_file
run_test "show skips SCC_API and SCC_CONFIG_FILE"     t_config_skips_reserved_vars
run_test "show ignores blank and comment lines"       t_config_ignores_blank_and_comment_lines
run_test "unknown command exits 1"                    t_config_unknown_command_exits_1
run_test "edit creates template when file missing"    t_config_edit_creates_template
run_test "edit preserves existing file"               t_config_edit_preserves_existing_file

echo
echo "safe-claude-code:"
run_test "no rules → deny"                            t_main_no_rules_denies
run_test "country match → claude runs"                t_main_country_match_runs_claude
run_test "country mismatch → deny"                    t_main_country_mismatch_denies
run_test "timezone glob (Asia/*) matches"             t_main_glob_match
run_test "match is case-insensitive"                  t_main_case_insensitive
run_test "multi-pattern: any match passes"            t_main_multi_pattern_any_match
run_test "env rule overrides file rule"               t_main_env_overrides_file
run_test "args forwarded verbatim to claude"          t_main_args_forwarded_to_claude
run_test "field missing in response → deny"           t_main_field_missing_in_response
run_test "curl failure → deny"                        t_main_curl_failure_denies
run_test "invalid JSON response → deny"               t_main_invalid_json_denies
run_test "SCC_API is not treated as a rule"           t_main_reserved_env_not_treated_as_rule

echo
echo "===================="
printf "Passed: %d\nFailed: %d\n" "$PASS" "$FAIL"
if (( FAIL > 0 )); then
  echo
  echo "Failed tests:"
  for t in "${FAILED[@]}"; do echo "  - $t"; done
  exit 1
fi
