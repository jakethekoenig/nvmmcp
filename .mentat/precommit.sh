#!/bin/bash
set -e

# Check if package.json has changed but package-lock.json hasn't
if git diff --name-only --cached | grep -q "package.json" && ! git diff --name-only --cached | grep -q "package-lock.json"; then
  echo "package.json has changed but package-lock.json hasn't. Running npm install to update package-lock.json..."
  npm install
  git add package-lock.json
fi

# Exit with success
exit 0
