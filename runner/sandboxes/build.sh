#!/bin/sh
# Builds the sandbox images used by the runner. Run on any machine with Docker (your laptop or the VM).
set -e
cd "$(dirname "$0")"
for lang in node python cpp java; do
  echo "Building devverse-sandbox-$lang"
  docker build -t "devverse-sandbox-$lang" "./$lang"
done
