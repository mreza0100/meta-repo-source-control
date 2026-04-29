#!/usr/bin/env bats
# Behavior tests for bin/metarepo-sc.
#
# Each test gets a fresh temp workspace with three fake repos:
#   alpha/  — has a tracked file with unstaged modifications
#   beta/   — has an untracked new file
#   gamma/  — clean (no changes — should be hidden in --collect output)
#
# HOME is also redirected to a temp dir so writes to ~/.config/metarepo-sc/cmd
# don't pollute the real user environment.

CLI="$BATS_TEST_DIRNAME/../bin/metarepo-sc"

setup() {
  WORKSPACE="$(mktemp -d -t metarepo-sc-test.XXXXXX)"
  HOME_DIR="$(mktemp -d -t metarepo-sc-home.XXXXXX)"
  export METAREPO_SC_ROOT="$WORKSPACE"
  export HOME="$HOME_DIR"

  _make_repo "alpha" "tracked.txt" "original" "modified"
  _make_repo "beta" "base.txt" "init"
  echo "new file content" > "$WORKSPACE/beta/newfile.txt"
  _make_repo "gamma" "only-clean.txt" "no changes here"
}

teardown() {
  [ -n "${WORKSPACE:-}" ] && rm -rf "$WORKSPACE"
  [ -n "${HOME_DIR:-}" ] && rm -rf "$HOME_DIR"
}

# Initialise a repo at $WORKSPACE/$1 with a single tracked file ($2) committed
# with content $3. If a fourth arg is given, the file is overwritten with that
# content after the commit (leaving an unstaged modification).
_make_repo() {
  local name="$1" file="$2" initial="$3" modified="${4:-}"
  mkdir -p "$WORKSPACE/$name"
  (
    cd "$WORKSPACE/$name"
    git init -q -b main
    git config user.email "test@example.com"
    git config user.name "Test"
    printf '%s\n' "$initial" > "$file"
    git add "$file"
    git commit -q -m "initial"
    if [ -n "$modified" ]; then
      printf '%s\n' "$modified" > "$file"
    fi
  )
}

@test "--collect lists only repos with changes (clean repos are hidden)" {
  run "$CLI" --collect
  [ "$status" -eq 0 ]
  [[ "$output" == *alpha* ]]
  [[ "$output" == *beta* ]]
  [[ "$output" != *gamma* ]]
}

@test "--collect emits exactly 4 tab-separated fields per row" {
  run "$CLI" --collect
  [ "$status" -eq 0 ]
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    field_count=$(awk -F'\t' '{print NF}' <<< "$line")
    [ "$field_count" -eq 4 ] || {
      echo "row had $field_count fields, expected 4: $line" >&2
      return 1
    }
  done <<< "$output"
}

@test "--open with tracked modified file writes 'diff' command" {
  run "$CLI" --open alpha tracked.txt " M"
  [ "$status" -eq 0 ]

  cmd_file="$HOME/.config/metarepo-sc/cmd"
  [ -f "$cmd_file" ]

  content="$(cat "$cmd_file")"
  [[ "$content" == diff$'\t'* ]]
  [[ "$content" == *"HEAD"*"Working"* ]]
}

@test "--open with tracked file materialises HEAD blob in .git/metarepo-sc-tmp/" {
  "$CLI" --open alpha tracked.txt " M"
  [ -f "$WORKSPACE/alpha/.git/metarepo-sc-tmp/tracked.txt" ]
  # HEAD blob should contain the original content, not the modified one.
  grep -q "original" "$WORKSPACE/alpha/.git/metarepo-sc-tmp/tracked.txt"
}

@test "--open with untracked file writes 'open' command (no diff target)" {
  run "$CLI" --open beta newfile.txt "??"
  [ "$status" -eq 0 ]

  cmd_file="$HOME/.config/metarepo-sc/cmd"
  [ -f "$cmd_file" ]

  content="$(cat "$cmd_file")"
  [[ "$content" == open$'\t'* ]]
  [[ "$content" != diff$'\t'* ]]
}

@test "--open with untracked directory is a no-op (no cmd written)" {
  mkdir -p "$WORKSPACE/beta/untracked-dir"
  echo "x" > "$WORKSPACE/beta/untracked-dir/inside.txt"
  rm -f "$HOME/.config/metarepo-sc/cmd"

  run "$CLI" --open beta untracked-dir "??"
  [ "$status" -eq 0 ]

  cmd_file="$HOME/.config/metarepo-sc/cmd"
  if [ -f "$cmd_file" ]; then
    [ ! -s "$cmd_file" ]
  fi
}

@test "empty workspace prints 'no changes' message and exits 0" {
  rm -rf "$WORKSPACE/alpha" "$WORKSPACE/beta"
  run "$CLI"
  [ "$status" -eq 0 ]
  [[ "$output" == *"no changes"* ]]
  [[ "$output" == *metarepo-sc* ]]
}

@test "METAREPO_SC_ROOT overrides current directory for repo discovery" {
  cd /tmp
  run "$CLI" --collect
  [ "$status" -eq 0 ]
  [[ "$output" == *alpha* ]]
}

@test "command file is written under \$HOME/.config/metarepo-sc/" {
  "$CLI" --open alpha tracked.txt " M"
  [ -d "$HOME/.config/metarepo-sc" ]
  [ -f "$HOME/.config/metarepo-sc/cmd" ]
}
