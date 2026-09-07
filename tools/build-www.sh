#!/bin/bash
# Assemble the web app into www/ for Capacitor. The site is served from the
# repo root on GitHub Pages, but the native wrapper wants a folder holding
# nothing except the app, so this copies just the pieces that ship.
set -e
cd "$(dirname "$0")/.."
rm -rf www && mkdir www
cp index.html manifest.webmanifest sw.js www/
cp -R css fonts icons js www/
echo "www/ assembled"
