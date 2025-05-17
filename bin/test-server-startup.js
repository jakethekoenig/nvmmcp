#!/usr/bin/env node

/**
 * Test script to verify that the server starts up properly
 * This is used in CI to ensure the server can start without errors
 * even when Neovim isn't available.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Create a temporary socket path for testing
const tempSocketPath = path.join(os.tmpdir(), `nvmmcp-test-${Date.now()}`);

// Start the server with the test socket path
console.log(`Starting server with socket path: ${tempSocketPath}`);

// Path to the server executable
const serverPath = path.join(__dirname, '..', 'dist', 'index.js');

// Verify the server executable exists
if (!fs.existsSync(serverPath)) {
  console.error(`Server executable not found at ${serverPath}`);
  console.error('Make sure you run "npm run build" first');
  process.exit(1);
}

// Start the server process
const serverProcess = spawn('node', [serverPath, tempSocketPath], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Track success state
let startupSuccessful = false;
let errorFound = false;
let serverOutput = '';

// Parse server output
serverProcess.stderr.on('data', (data) => {
  const output = data.toString();
  serverOutput += output;
  
  // Check for expected startup message
  if (output.includes('Neovim MCP Server running on stdio')) {
    console.log('✅ Server started successfully');
    startupSuccessful = true;
  }
  
  // Check for fatal errors (not the expected connection errors)
  if (output.includes('Fatal error running server:')) {
    console.error('❌ Server encountered a fatal error');
    errorFound = true;
  }
});

// Handle server error
serverProcess.on('error', (error) => {
  console.error(`❌ Failed to start server: ${error.message}`);
  process.exit(1);
});

// Set a timeout to check results
setTimeout(() => {
  // Kill the server process
  serverProcess.kill();
  
  console.log('\nServer output:\n' + serverOutput);
  
  if (errorFound) {
    console.error('❌ Test failed: Server encountered errors');
    process.exit(1);
  }
  
  if (!startupSuccessful) {
    console.error('❌ Test failed: Server did not start successfully');
    process.exit(1);
  }
  
  console.log('✅ Server startup test passed');
  process.exit(0);
}, 5000); // Wait 5 seconds for the server to start
