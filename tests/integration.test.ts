// Integration test for nvmmcp
const childProcess = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');

// Timeout for tests (ms)
const TEST_TIMEOUT = 15000;

// Simple MCP message structure
interface MCPMessage {
  id: number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

// Helper function to wait for a file to exist
async function waitForFile(filePath: string, timeout: number): Promise<void> {
  const startTime = Date.now();
  
  while (!fs.existsSync(filePath)) {
    if (Date.now() - startTime > timeout) {
      throw new Error(`Timeout waiting for file: ${filePath}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

describe('nvmmcp integration test', () => {
  let tempDir: string;
  let socketPath: string;
  let testFilePath: string;
  let nvimProcess: any;
  let nvmmcpProcess: any;
  let responses: string[] = [];
  
  beforeAll(async () => {
    // Create temporary directory for test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvmmcp-test-'));
    socketPath = path.join(tempDir, 'nvim.sock');
    testFilePath = path.join(tempDir, 'test-output.txt');
    
    console.log(`Using temp dir: ${tempDir}`);
    console.log(`Socket path: ${socketPath}`);
    console.log(`Test file path: ${testFilePath}`);
    
    // Start Neovim with socket
    nvimProcess = childProcess.spawn('nvim', ['--headless', '--clean', '--listen', socketPath]);
    console.log('Started NeoVim process');
    
    // Capture NeoVim output for debugging
    nvimProcess.stderr?.on('data', (data) => {
      console.log(`NeoVim stderr: ${data.toString()}`);
    });
    
    nvimProcess.stdout?.on('data', (data) => {
      console.log(`NeoVim stdout: ${data.toString()}`);
    });
    
    nvimProcess.on('error', (error) => {
      console.error('NeoVim process error:', error);
    });
    
    // Wait for the socket to be created
    try {
      await waitForFile(socketPath, 5000);
      console.log('NeoVim socket is ready');
    } catch (error) {
      console.error('Error waiting for NeoVim socket:', error);
      throw error;
    }
    
    // Give NeoVim a moment to fully initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Start nvmmcp server
    const cwd = process.cwd();
    const serverPath = path.join(cwd, 'dist', 'index.js');
    
    nvmmcpProcess = childProcess.spawn('node', [serverPath, socketPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(`Started nvmmcp process with ${serverPath} ${socketPath}`);
    
    // Set up error handlers
    nvmmcpProcess.on('error', (error) => {
      console.error('nvmmcp process error:', error);
    });
    
    // Capture stdout for responses
    nvmmcpProcess.stdout?.on('data', (data) => {
      const str = data.toString();
      responses.push(str);
      console.log(`nvmmcp stdout: ${str}`);
    });
    
    // Capture stderr for debugging
    nvmmcpProcess.stderr?.on('data', (data) => {
      console.log(`nvmmcp stderr: ${data.toString()}`);
    });
    
    // Give the server time to start up
    await new Promise(resolve => setTimeout(resolve, 1000));
  }, TEST_TIMEOUT);
  
  afterAll(() => {
    // Clean up processes
    if (nvmmcpProcess && !nvmmcpProcess.killed) {
      nvmmcpProcess.kill('SIGKILL');
    }
    
    if (nvimProcess && !nvimProcess.killed) {
      nvimProcess.kill('SIGKILL');
    }
    
    // Clean up temporary files
    try {
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
      
      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }
      
      fs.rmdirSync(tempDir);
    } catch (error) {
      console.error('Error cleaning up:', error);
    }
  });
  
  test('should interact with NeoVim via MCP tools', async () => {
    // Helper function to send MCP request and get response
    async function sendMcpRequest(message: MCPMessage): Promise<MCPMessage> {
      return new Promise((resolve, reject) => {
        const messageText = JSON.stringify(message) + '\n';
        const timeoutId = setTimeout(() => {
          reject(new Error(`Timeout waiting for response to message ID ${message.id}`));
        }, 5000);
        
        // Clear previous responses
        responses = [];
        
        const responseHandler = () => {
          for (const responseStr of responses) {
            try {
              // Each line could be a separate JSON object
              const lines = responseStr.trim().split('\n');
              
              for (const line of lines) {
                if (!line.trim()) continue;
                
                const response = JSON.parse(line) as MCPMessage;
                
                if (response.id === message.id) {
                  clearTimeout(timeoutId);
                  nvmmcpProcess.stdout?.removeListener('data', responseCollector);
                  resolve(response);
                  return;
                }
              }
            } catch (error) {
              console.warn(`Failed to parse response as JSON: ${responseStr}`);
            }
          }
        };
        
        const responseCollector = (data: Buffer) => {
          const str = data.toString();
          responses.push(str);
          responseHandler();
        };
        
        nvmmcpProcess.stdout?.on('data', responseCollector);
        
        nvmmcpProcess.stdin?.write(messageText);
        console.log(`Sent MCP request: ${messageText}`);
      });
    }
    
    // Step 1: Call the tools/list method to verify server is responding
    const listToolsRequest: MCPMessage = {
      id: 1,
      method: 'tools/list'
    };
    
    console.log('Sending tools/list request');
    const listToolsResponse = await sendMcpRequest(listToolsRequest);
    console.log('Received tools/list response:', JSON.stringify(listToolsResponse));
    
    expect(listToolsResponse.result).toBeDefined();
    expect(Array.isArray(listToolsResponse.result.tools)).toBe(true);
    
    // Step 2: Use normal mode to insert text
    const normalModeRequest: MCPMessage = {
      id: 2,
      method: 'tools/call',
      params: {
        name: 'send_normal_mode',
        arguments: {
          keys: 'iHello from NeoVim integration test\u001b'  // i to enter insert mode, Esc to exit
        }
      }
    };
    
    console.log('Sending normal mode request');
    const normalModeResponse = await sendMcpRequest(normalModeRequest);
    console.log('Received normal mode response:', JSON.stringify(normalModeResponse));
    
    expect(normalModeResponse.result).toBeDefined();
    expect(normalModeResponse.result.content).toBeDefined();
    expect(normalModeResponse.result.isError).toBeUndefined();
    
    // Step 3: Save the buffer to a file using command mode
    const commandModeRequest: MCPMessage = {
      id: 3,
      method: 'tools/call',
      params: {
        name: 'send_command_mode',
        arguments: {
          command: `w ${testFilePath}`
        }
      }
    };
    
    console.log('Sending command mode request to save file');
    const commandModeResponse = await sendMcpRequest(commandModeRequest);
    console.log('Received command mode response:', JSON.stringify(commandModeResponse));
    
    expect(commandModeResponse.result).toBeDefined();
    expect(commandModeResponse.result.content).toBeDefined();
    expect(commandModeResponse.result.isError).toBeUndefined();
    
    // Step 4: Wait a moment for file operations to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 5: Verify the file exists and has the expected content
    try {
      await waitForFile(testFilePath, 3000);
      
      const fileExists = fs.existsSync(testFilePath);
      expect(fileExists).toBe(true);
      
      const fileContent = fs.readFileSync(testFilePath, 'utf8');
      console.log(`File content: "${fileContent}"`);
      expect(fileContent).toContain('Hello from NeoVim integration test');
    } catch (error) {
      console.error('Error verifying file:', error);
      throw error;
    }
  }, TEST_TIMEOUT);
});
