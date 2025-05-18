import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { z } from "zod";

// Mock for StdioServerTransport
class MockTransport {
  private requestHandler: any = null;

  setRequestHandler(handler: any) {
    this.requestHandler = handler;
  }

  async sendRequest(request: any) {
    if (!this.requestHandler) {
      throw new Error("No request handler set");
    }
    return this.requestHandler(request);
  }
}

describe('view_files resource', () => {
  let server: Server;
  let transport: MockTransport;
  let tempDir: string;
  let testFile1: string;
  let testFile2: string;
  
  // Set up test files
  beforeAll(async () => {
    // Create a temporary directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvmmcp-test-'));
    
    // Create test files with known content
    testFile1 = path.join(tempDir, 'test1.txt');
    testFile2 = path.join(tempDir, 'test2.txt');
    
    // Write content to test files
    fs.writeFileSync(testFile1, 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5');
    fs.writeFileSync(testFile2, 'File 2 Line 1\nFile 2 Line 2\nFile 2 Line 3');
    
    // Set up the server
    server = new Server(
      {
        name: "test-server",
        version: "0.0.0",
      },
      {
        capabilities: {
          resources: {
            types: ["view_files"],
          },
        },
      }
    );
    
    // Set up mock transport
    transport = new MockTransport();
    await server.connect(transport as any);
  });
  
  afterAll(() => {
    // Clean up test files
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
    fs.rmdirSync(tempDir);
  });
  
  // Mock resources/create handler
  test('server correctly handles view_files resource creation - single file', async () => {
    // Single file request
    const request = {
      method: "resources/create",
      params: {
        type: "view_files",
        data: {
          path: testFile1
        }
      }
    };
    
    // Send the request to the server
    const response = await transport.sendRequest(request);
    
    // Verify the response
    expect(response).toBeDefined();
    expect(response.resource).toBeDefined();
    expect(response.resource.path).toBe(testFile1);
    expect(response.resource.content).toBe('Line 1\nLine 2\nLine 3\nLine 4\nLine 5');
  });
  
  test('server correctly handles view_files resource creation - single file with line range', async () => {
    // Single file with line range request
    const request = {
      method: "resources/create",
      params: {
        type: "view_files",
        data: {
          path: testFile1,
          startLine: 2,
          endLine: 4
        }
      }
    };
    
    // Send the request to the server
    const response = await transport.sendRequest(request);
    
    // Verify the response
    expect(response).toBeDefined();
    expect(response.resource).toBeDefined();
    expect(response.resource.path).toBe(testFile1);
    expect(response.resource.startLine).toBe(2);
    expect(response.resource.endLine).toBe(4);
    expect(response.resource.content).toBe('Line 2\nLine 3\nLine 4');
  });
  
  test('server correctly handles view_files resource creation - multiple files', async () => {
    // Multiple files request
    const request = {
      method: "resources/create",
      params: {
        type: "view_files",
        data: [
          { path: testFile1 },
          { path: testFile2 }
        ]
      }
    };
    
    // Send the request to the server
    const response = await transport.sendRequest(request);
    
    // Verify the response
    expect(response).toBeDefined();
    expect(response.resource).toBeDefined();
    expect(Array.isArray(response.resource)).toBe(true);
    expect(response.resource.length).toBe(2);
    
    // Check first file
    expect(response.resource[0].path).toBe(testFile1);
    expect(response.resource[0].content).toBe('Line 1\nLine 2\nLine 3\nLine 4\nLine 5');
    
    // Check second file
    expect(response.resource[1].path).toBe(testFile2);
    expect(response.resource[1].content).toBe('File 2 Line 1\nFile 2 Line 2\nFile 2 Line 3');
  });
  
  test('server correctly handles view_files resource creation - nonexistent file', async () => {
    // Nonexistent file request
    const request = {
      method: "resources/create",
      params: {
        type: "view_files",
        data: {
          path: path.join(tempDir, 'nonexistent.txt')
        }
      }
    };
    
    // Send the request to the server
    const response = await transport.sendRequest(request);
    
    // Verify the response
    expect(response).toBeDefined();
    expect(response.resource).toBeDefined();
    expect(response.resource.path).toBe(path.join(tempDir, 'nonexistent.txt'));
    expect(response.resource.content).toContain('Error reading file');
  });
  
  test('server correctly handles view_files resource creation - invalid type', async () => {
    // Invalid type request
    const request = {
      method: "resources/create",
      params: {
        type: "invalid_type",
        data: {
          path: testFile1
        }
      }
    };
    
    // Send the request to the server should throw an error
    await expect(transport.sendRequest(request)).rejects.toThrow();
  });
});
