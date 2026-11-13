#!/usr/bin/env bash
# Build a deterministic test repo: <dir>/origin.git (bare) and <dir>/work.
set -euo pipefail
[ $# -eq 1 ] || { echo "usage: $0 <dir>" >&2; exit 2; }
mkdir -p "$1"
DIR="$(cd "$1" && pwd)"

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0
export GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=t@example.com

STEP=0
tick() {
  local d
  d=$(date -u -r $((1767225600 + STEP * 3600)) +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -d "@$((1767225600 + STEP * 3600))" +%Y-%m-%dT%H:%M:%SZ)
  export GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d"
  STEP=$((STEP + 1))
}
g() { git -c init.defaultBranch=main -c commit.gpgsign=false -c tag.gpgSign=false -c core.autocrlf=false "$@"; }
commit() { tick; g commit -q -m "$1"; }

git init -q --bare -b main "$DIR/origin.git"
git init -q -b main "$DIR/work"
cd "$DIR/work"
g remote add origin "$DIR/origin.git"

echo init > README
g add README; commit init                                   # c1
echo a > a.txt
g add a.txt; commit "add a"                                 # c2

g checkout -q -b feature/x
echo x1 > x.txt; g add x.txt; commit "feat x 1"             # f1
echo x2 >> x.txt; g add x.txt; commit "feat x 2"            # f2

g checkout -q main
printf 'bin\0data\0\1\2\3' > bin.dat
echo work > work.txt
g add bin.dat work.txt; commit "main work"                  # c3

tick; g merge -q --no-ff feature/x -m "Merge feature/x"     # m1

g checkout -q -b topic HEAD~1
echo t > topic.txt; g add topic.txt; commit "topic 1"       # t1
g checkout -q main

g tag v1.0 "$(g rev-parse main~2)"                          # c2 (lightweight)
tick; g tag -a v1.1 -m "release 1.1" main                   # m1 (annotated)

g push -q origin main feature/x topic
g push -q origin --tags

g checkout -q -b remote-only "$(g rev-parse v1.0)"
echo r > r.txt; g add r.txt; commit "remote only"           # r1
g push -q origin remote-only
g checkout -q main
g branch -q -D remote-only

mkdir "dir with space"
g mv a.txt "dir with space/a renamed.txt"; commit rename    # c4

echo stashed >> README
tick; g stash push -q -m "wip stash"

echo modified >> README
echo staged > staged.txt; g add staged.txt
echo untracked > untracked.txt
