#!/bin/bash
set -e

# ANSI color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting nvmmcp integration test script${NC}"

# Check for neovim installation
if ! command -v nvim &> /dev/null; then
    echo -e "${RED}Error: Neovim is not installed or not in your PATH${NC}"
    echo "Please install Neovim before running this test"
    exit 1
fi

echo -e "${GREEN}✓ Neovim found${NC}"

# Check node version
NODE_VERSION=$(node -v | cut -d 'v' -f 2)
NODE_MAJOR=$(echo $NODE_VERSION | cut -d '.' -f 1)

if [ $NODE_MAJOR -lt 18 ]; then
    echo -e "${RED}Error: Node.js version must be 18 or higher (found v$NODE_VERSION)${NC}"
    echo "Please upgrade Node.js before running this test"
    exit 1
fi

echo -e "${GREEN}✓ Node.js version v$NODE_VERSION is compatible${NC}"

# Check if dist directory exists, if not, build project
if [ ! -d "./dist" ]; then
    echo "Building TypeScript project..."
    npm run build
fi

echo -e "${GREEN}✓ Project is built${NC}"

# Install dependencies if needed
if [ ! -d "./node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

echo -e "${GREEN}✓ Dependencies installed${NC}"

# Run the integration test
echo -e "${YELLOW}Running integration test...${NC}"
echo "This test will start NeoVim and the nvmmcp server, then test their interaction."
echo "The test may take up to 30 seconds to complete."

TEST_RESULT=0
npm run test:integration || TEST_RESULT=$?

# Check the result
if [ $TEST_RESULT -eq 0 ]; then
    echo -e "${GREEN}✓ Integration test passed successfully!${NC}"
    exit 0
else
    echo -e "${RED}✗ Integration test failed!${NC}"
    echo "Check the output above for details on what went wrong."
    exit 1
fi
