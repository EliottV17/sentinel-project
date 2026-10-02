#!/bin/sh
set -eu

api_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM
mkdir -p "$tmp_dir/bin"

cat >"$tmp_dir/bin/bunx" <<'EOF'
#!/bin/sh
printf 'bunx %s\n' "$*" >>"$CALL_LOG"
EOF
cat >"$tmp_dir/bin/bun" <<'EOF'
#!/bin/sh
printf 'bun %s\n' "$*" >>"$CALL_LOG"
EOF
chmod +x "$tmp_dir/bin/bunx" "$tmp_dir/bin/bun"

CALL_LOG="$tmp_dir/calls.log" PATH="$tmp_dir/bin:$PATH" \
  "$api_dir/docker-entrypoint.sh" bun dist/main.js

expected=$(printf 'bunx prisma migrate deploy\nbun run prisma:seed\nbun dist/main.js')
actual=$(awk '{ if (NR > 1) printf "\n"; printf "%s", $0 }' "$tmp_dir/calls.log")
if [ "$actual" != "$expected" ]; then
  printf 'Expected startup calls:\n%s\nObserved startup calls:\n%s\n' "$expected" "$actual" >&2
  exit 1
fi
printf 'docker entrypoint startup order: PASS\n'
