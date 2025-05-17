// Integration test specifically for view_buffers command
import * as childProcess from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import { promisify } from 'util';
const exec = promisify(childProcess.exec);

// Longer timeout for integration tests
const TEST_TIMEOUT = 60000;

// Check if Neovim is available
async function isNeovimAvailable(): Promise<boolean> {
  try {
    await exec('nvim --version');
    return true;
  } catch (error) {
    console.log('Neovim is not available:', error);
    return false;
  }
}

// Helper to create a temporary socket path
function getTempSocketPath() {
  const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvmmcp-socket-'));
  return path.join(socketDir, 'nvim.sock');
}

// Setup a Neovim instance with a socket connection
async function setupNeovim(socketPath: string): Promise<childProcess.ChildProcess> {
  console.log(`Setting up Neovim with socket: ${socketPath}`);
  
  // Ensure parent directory exists
  const socketDir = path.dirname(socketPath);
  if (!fs.existsSync(socketDir)) {
    fs.mkdirSync(socketDir, { recursive: true });
  }
  
  // Create a test file with known content
  const testFilePath = path.join(socketDir, 'test.txt');
  const testContent = 'Line 1: This is a test file\nLine 2: Created for testing view_buffers\nLine 3: The cursor should be here|';
  fs.writeFileSync(testFilePath, testContent.replace('|', '')); // Remove the cursor marker from the file
  
  // Start Neovim with a socket connection and open our file
  // Position cursor at the third line, column 30 (where the '|' marker was)
  const nvimProcess = childProcess.spawn('nvim', [
    '--headless', 
    '--listen', socketPath, 
    '-c', `e ${testFilePath}`,
    '-c', 'normal! 3G30|' // Move to line 3, column 30
  ]);
  
  // Wait for Neovim to be ready
  return new Promise((resolve, reject) => {
    const checkSocket = () => {
      if (fs.existsSync(socketPath)) {
        console.log(`Neovim socket is ready at: ${socketPath}`);
        resolve(nvimProcess);
      } else {
        console.log('Waiting for Neovim socket...');
        setTimeout(checkSocket, 500);
      }
    };
    
    // Handle process errors
    nvimProcess.on('error', (err) => {
      console.error('Failed to start Neovim:', err);
      reject(err);
    });
    
    // Start checking for socket
    checkSocket();
  });
}

// Start the MCP server
function startMCPServer(socketPath: string): childProcess.ChildProcess {
  console.log('Starting MCP server...');
  const serverProcess = childProcess.spawn('node', 
    ['dist/index.js', socketPath], 
    { 
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });
  
  // Log server output
  serverProcess.stdout.on('data', (data) => {
    console.log(`MCP server stdout: ${data}`);
  });
  
  serverProcess.stderr.on('data', (data) => {
    console.log(`MCP server stderr: ${data}`);
  });
  
  serverProcess.on('error', (err) => {
    console.error('Failed to start MCP server:', err);
  });
  
  return serverProcess;
}

// Create a simple MCP client that can call tools
async function callViewBuffersTool(serverProcess: childProcess.ChildProcess): Promise<string> {
  console.log('Calling view_buffers tool...');
  
  // Create a message to list tools
  const listToolsMsg = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list'
  }) + '\n';
  
  // Create a message to call view_buffers
  const callToolMsg = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'view_buffers',
      arguments: {}
    }
  }) + '\n';
  
  // Send to server and collect response
  return new Promise((resolve) => {
    let resultData = '';
    
    serverProcess.stdout.on('data', (data) => {
      resultData += data.toString();
      console.log(`Received data: ${data.toString()}`);
    });
    
    // Write messages to server process
    serverProcess.stdin.write(listToolsMsg);
    setTimeout(() => {
      serverProcess.stdin.write(callToolMsg);
    }, 1000); // Give a little time between requests
    
    // Resolve after waiting for response
    setTimeout(() => {
      console.log('Collected result data:', resultData);
      resolve(resultData);
    }, 5000);
  });
}

// Function to check if this test should run
beforeAll(async () => {
  // Check if Neovim is available before running the tests
  const nvimAvailable = await isNeovimAvailable();
  if (!nvimAvailable) {
    // If Neovim is not available, we'll skip the entire test suite
    console.log('Skipping view-buffers tests: Neovim is not available');
    // Skip all tests in this file by using test.only in another file
    // This is a Jest trick to effectively skip this file
    jest.resetModules();
    return;
  }
});

// Test the view_buffers command
describe('view_buffers command test', () => {
  let nvimProcess: childProcess.ChildProcess | null = null;
  let mcpProcess: childProcess.ChildProcess | null = null;
  let socketPath: string;
  let socketDir: string;
  
  beforeAll(async () => {
    // Setup temporary socket path
    socketPath = getTempSocketPath();
    socketDir = path.dirname(socketPath);
    
    try {
      // Start Neovim with the socket
      console.log('Setting up Neovim for tests...');
      nvimProcess = await setupNeovim(socketPath);
      
      // Wait for Neovim to be fully ready
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error('Error setting up Neovim:', error);
      // Skip the tests if we can't set up Neovim
      // We'll handle this in the test itself
    }
  }, TEST_TIMEOUT);
  
  afterAll(() => {
    // Clean up processes
    if (nvimProcess) {
      console.log('Terminating Neovim process...');
      nvimProcess.kill();
    }
    
    if (mcpProcess) {
      console.log('Terminating MCP server process...');
      mcpProcess.kill();
    }
    
    // Clean up socket file and directory
    try {
      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }
      if (fs.existsSync(socketDir)) {
        fs.rmdirSync(socketDir);
      }
    } catch (err) {
      console.error('Error cleaning up:', err);
    }
  });
  
  // Use the test.skip approach conditionally within the test
  test('should successfully retrieve buffer content with correct format', async () => {
    // Skip the test if nvimProcess is not available
    if (!nvimProcess) {
      console.log('Skipping test: Neovim process not available');
      return;
    }
    
    // Get the absolute path of the test file for verification
    const testFilePath = path.join(socketDir, 'test.txt');
    
    // Start the MCP server
    mcpProcess = startMCPServer(socketPath);
    
    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Call the view_buffers tool
    const result = await callViewBuffersTool(mcpProcess);
    
    // Verify the result contains basic expected elements
    expect(result).toBeTruthy();
    expect(result).toContain('jsonrpc');
    
    try {
      // Parse the JSON responses
      const responses = result
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
      
      // Find the tools/call response (id: 2)
      const toolResponse = responses.find(r => r.id === 2);
      expect(toolResponse).toBeDefined();
      expect(toolResponse.result).toBeDefined();
      expect(toolResponse.result.content).toBeDefined();
      expect(toolResponse.result.content[0].type).toBe('text');
      
      // Get the actual text content
      const outputText = toolResponse.result.content[0].text;
      console.log("Actual output text:", outputText);
      
      // Verify file content is correct
      expect(outputText).toContain('Line 1: This is a test file');
      expect(outputText).toContain('Line 2: Created for testing view_buffers');
      
      // Verify the cursor position is shown properly
      // The cursor marker should be right before the word "here"
      expect(outputText).toContain('Line 3: The cursor should be |here');
      
      // Verify window and buffer information is present
      expect(outputText).toContain(`Buffer`);
      expect(outputText).toContain(`(${testFilePath})`);
      expect(outputText).toContain('Cursor at line 3, column 30');
      
      // Verify formatting with separator line
      expect(outputText).toContain('='.repeat(80));
      
      // Specifically check for error messages to debug the issue
      expect(outputText).not.toContain('Wrong type for argument 2 when calling nvim_buf_get_lines');
      expect(outputText).not.toContain('Error retrieving buffer content');
      
      // Create an expected pattern for the output
      const expectedPattern = new RegExp(
        `Window \\d+.*Buffer \\d+ \\(${testFilePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\).*` + 
        `Cursor at line 3, column 30.*` +
        `Content:.*` +
        `Line 1: This is a test file.*` +
        `Line 2: Created for testing view_buffers.*` +
        `Line 3: The cursor should be \\|here.*` +
        `={80}`,
        's' // dot matches newline
      );
      
      // Test the full output format against our expected pattern
      expect(outputText).toMatch(expectedPattern);
    } catch (error) {
      console.error('Test failed with error:', error);
      console.error('Raw result:', result);
      throw error;
    }
  }, TEST_TIMEOUT);
});
