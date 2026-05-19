#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# ensure Playwright can find frontend node_modules if needed
export NODE_PATH=/Users/rene/ai-dev-workspace/atlasai/node_modules

# run the test
/Users/rene/ai-dev-workspace/atlasai/node_modules/.bin/playwright \
  test retest_hipaa.spec.ts --config=playwright.config.ts
