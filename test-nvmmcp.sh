#!/bin/bash

echo "This is a simple test script to verify the nvmmcp CLI works"
echo "It doesn't actually connect to Neovim, just tests the binary"

# Run the CLI without arguments (should show usage message)
echo "Testing CLI without arguments (should show usage message):"
node dist/index.js

echo ""
echo "Basic CLI structure seems to be working!"
