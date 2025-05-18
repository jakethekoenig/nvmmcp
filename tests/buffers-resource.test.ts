import { Server } from "@modelcontextprotocol/sdk/server/index.js";

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

// Mock for Neovim client
const mockNvim = {
  windows: [
    {
      number: async () => 1,
      buffer: {
        name: async () => "/path/to/test/file1.js",
        number: async () => 1,
        length: 10,
        getLines: async () => ["line 1", "line 2", "line 3", "line 4", "line 5"],
        id: async () => 1
      },
      cursor: async () => [2, 3]
    },
    {
      number: async () => 2,
      buffer: {
        name: async () => "/path/to/test/file2.md",
        number: async () => 2,
        length: 8,
        getLines: async () => ["# Header", "Content line 1", "Content line 2"],
        id: async () => 2
      },
      cursor: async () => [1, 0]
    }
  ],
  window: {
    number: async () => 1
  }
};

// Mock global objects and functions
global.nvim = mockNvim;
global.isNeovimConnected = () => true;
global.connectToNeovim = async () => true;

describe('buffers resource', () => {
  let server: Server;
  let transport: MockTransport;
  
  beforeAll(async () => {
    // Set up the server
    server = new Server(
      {
        name: "test-server",
        version: "0.0.0",
      },
      {
        capabilities: {
          resources: {
            types: ["buffers"],
          },
        },
      }
    );
    
    // Set up mock transport
    transport = new MockTransport();
    await server.connect(transport as any);
  });
  
  test('server correctly handles buffers resource creation', async () => {
    // Create resource request
    const request = {
      method: "resources/create",
      params: {
        type: "buffers"
      }
    };
    
    // Send the request to the server
    const response = await transport.sendRequest(request);
    
    // Verify the response structure
    expect(response).toBeDefined();
    expect(response.resource).toBeDefined();
    expect(response.resource.windows).toBeDefined();
    expect(Array.isArray(response.resource.windows)).toBe(true);
    expect(response.resource.timestamp).toBeDefined();
    
    // Verify windows content
    expect(response.resource.windows.length).toBe(2);
    
    // Check first window
    const window1 = response.resource.windows[0];
    expect(window1.windowNumber).toBe(1);
    expect(window1.isCurrentWindow).toBe(true);
    expect(window1.bufferNumber).toBe(1);
    expect(window1.bufferName).toBe("/path/to/test/file1.js");
    expect(window1.cursor).toEqual([2, 3]);
    expect(window1.content).toContain("line 1");
    
    // Verify cursor marker in current window
    const lines = window1.content.split('\n');
    expect(lines[1]).toContain("|"); // Cursor should be in line 2 (index 1)
    
    // Check second window
    const window2 = response.resource.windows[1];
    expect(window2.windowNumber).toBe(2);
    expect(window2.isCurrentWindow).toBe(false);
    expect(window2.bufferNumber).toBe(2);
    expect(window2.bufferName).toBe("/path/to/test/file2.md");
  });
  
  test('server handles unsupported resource type errors', async () => {
    // Invalid resource type request
    const request = {
      method: "resources/create",
      params: {
        type: "unsupported_type"
      }
    };
    
    // Expect error for unsupported resource type
    await expect(transport.sendRequest(request)).rejects.toThrow();
  });
});
