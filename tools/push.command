#!/bin/bash
# Double-click me: commits anything pending and pushes to GitHub using this
# Mac's stored git credentials. If Claude left a message in
# .claude/commit-msg.txt it is used for the commit and then removed.
cd "$(dirname "$0")/.." || exit 1
rm -f .git/index.lock .git/HEAD.lock .git/objects/maintenance.lock .git/objects/*/tmp_obj_*
git add -A
if ! git diff --cached --quiet; then
  MSG=".claude/commit-msg.txt"
  if [ -s "$MSG" ]; then
    git -c user.name="HJ" -c user.email="jackson.henry.a@pm.me" commit -q -F "$MSG" && rm -f "$MSG"
  else
    git -c user.name="HJ" -c user.email="jackson.henry.a@pm.me" commit -q -m "Update $(date '+%Y-%m-%d %H:%M')"
  fi
  echo "Committed: $(git log --oneline -1)"
else
  echo "Nothing new to commit."
fi
echo "Pushing main to origin..."
git push origin main
echo
echo "Done - you can close this window."
