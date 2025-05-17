#!/usr/bin/env node

/**
 * Test script to verify that the server starts up properly
 * This is used in CI to ensure the server can start without errors
 * even when Neovim isn't available.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

// Define an async main function since we need top-level await
async function main() {
  // Get the directory name in ESM
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Create a temporary socket path for testing
  const tempSocketPath = path.join(os.tmpdir(), `nvmmcp-test-${Date.now()}`);

  // Start the server with the test socket path
  console.log(`Starting server with socket path: ${tempSocketPath}`);

  // Path to the server executable
  const serverPath = path.join(__dirname, '..', 'dist', 'index.js');

  // Verify the server executable exists
  try {
    await fs.promises.access(serverPath, fs.constants.F_OK);
  } catch (error) {
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

  // Use a promise to wait for the result
  return new Promise((resolve) => {
    // Set a timeout to check results
    setTimeout(() => {
      // Kill the server process
      serverProcess.kill();
      
      console.log('\nServer output:\n' + serverOutput);
      
      if (errorFound) {
        console.error('❌ Test failed: Server encountered errors');
        resolve(1); // Exit with error code
      }
      
      if (!startupSuccessful) {
        console.error('❌ Test failed: Server did not start successfully');
        resolve(1); // Exit with error code
      }
      
      console.log('✅ Server startup test passed');
      resolve(0); // Exit with success code
    }, 5000); // Wait 5 seconds for the server to start
  });
}

// Run the main function and exit with the appropriate code
main().then(exitCode => process.exit(exitCode)).catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
