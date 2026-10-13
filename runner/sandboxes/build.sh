#!/bin/sh
# Builds the sandbox images used by the runner. Run on any machine with Docker (your laptop or the VM).
# Usage: sh build.sh            # all languages
#        sh build.sh node python  # only these (the C++ and Java images are large)
set -e
cd "$(dirname "$0")"
langs="${*:-node python cpp java}"
for lang in $langs; do
  echo "Building devverse-sandbox-$lang"
  docker build -t "devverse-sandbox-$lang" "./$lang"
done
