#!/bin/bash
# Double-click me: starts the Breezy dev server on port 8712 and opens it in
# your default browser. Close this Terminal window (or Ctrl-C) to stop it.
cd "$(dirname "$0")/.." || exit 1
( sleep 1.5; open "http://localhost:8712" ) &
exec python3 tools/serve.py 8712
