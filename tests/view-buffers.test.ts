// Integration test specifically for view_buffers command
import * as childProcess from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';

// Longer timeout for integration tests
const TEST_TIMEOUT = 60000;

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
  
  // Start Neovim with a socket connection
  const nvimProcess = childProcess.spawn('nvim', 
    ['--headless', '--listen', socketPath, '-c', 'e test.txt', '-c', 'normal! iTest content for buffer view']);
  
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
    
    // Start Neovim with the socket
    nvimProcess = await setupNeovim(socketPath);
    
    // Wait for Neovim to be fully ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
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
  
  test('should successfully retrieve buffer content', async () => {
    // Start the MCP server
    mcpProcess = startMCPServer(socketPath);
    
    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Call the view_buffers tool
    const result = await callViewBuffersTool(mcpProcess);
    
    // Verify the result
    expect(result).toBeTruthy();
    expect(result).toContain('jsonrpc');
    
    // Expect to see buffer content in the response
    expect(result).toContain('test.txt');
    
    // Specifically check for error messages to debug the issue
    expect(result).not.toContain('Wrong type for argument 2 when calling nvim_buf_get_lines');
    
  }, TEST_TIMEOUT);
});
