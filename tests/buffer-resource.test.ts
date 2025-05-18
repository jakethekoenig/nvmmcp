import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

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
  },
  command: async () => {},
  on: () => {},
  apiInfo: async () => ({})
};

// Mock global objects and functions
let globalNvim = mockNvim;
let isNvimConnected = true;
let connectToNeovimMock = jest.fn().mockImplementation(async () => true);

// Test for buffer resource
describe('buffer resource', () => {
  let server: McpServer;
  let transport: MockTransport;

  beforeEach(() => {
    // Reset mocks
    globalNvim = mockNvim;
    isNvimConnected = true;
    connectToNeovimMock.mockClear();

    // Create a new server instance for each test
    server = new McpServer({
      name: "test-server",
      version: "0.0.0"
    });

    transport = new MockTransport();

    // Mock the global objects
    global.nvim = globalNvim;
    global.isNeovimConnected = () => isNvimConnected;
    global.connectToNeovim = connectToNeovimMock;
    global.withTimeout = async (promise, _timeout, _errorMessage) => promise;
  });

  test('list_resources returns buffer resource', async () => {
    // Add the buffer resource to the server
    server.resource(
      "buffers",
      new ResourceTemplate("neovim-buffer://current", { 
        list: async () => {
          return {
            resources: [{ 
              uri: "neovim-buffer://current",
              name: "Current Neovim Buffers",
              mimeType: "application/json"
            }]
          };
        }
      }),
      async () => ({ contents: [] })
    );

    // Connect transport
    await server.connect(transport as any);

    // Test list_resources request
    const request = {
      method: "resources/list"
    };

    const response = await transport.sendRequest(request);
    
    // Verify the response contains the buffer resource
    expect(response.resources).toBeDefined();
    expect(response.resources.length).toBeGreaterThan(0);
    expect(response.resources.some((r: any) => r.uri === "neovim-buffer://current")).toBe(true);
  });

  test('read_resource returns buffer content', async () => {
    // Add buffer resource handling
    server.resource(
      "buffers",
      new ResourceTemplate("neovim-buffer://current", { 
        list: async () => {
          return [{ 
            uri: "neovim-buffer://current",
            name: "Current Neovim Buffers",
            mimeType: "application/json"
          }];
        }
      }),
      async (uri) => {
        // Mock buffer content for testing
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({
                uri: uri.toString(),
                name: "Neovim Buffers",
                windows: [{
                  windowNumber: 1,
                  isCurrentWindow: true,
                  isActiveBuffer: true,
                  bufferNumber: 1,
                  bufferName: "/path/to/test.js",
                  cursor: [2, 3],
                  totalLines: 5,
                  visibleRange: {
                    startLine: 1,
                    endLine: 5,
                    context: 100
                  },
                  content: ["    1: line 1", "    2: li🔸ne 2", "    3: line 3"]
                }],
                timestamp: new Date().toISOString()
              }, null, 2)
            },
            {
              uri: uri.toString(),
              mimeType: "text/plain",
              text: "Window 1 (current) - Buffer 1 (/path/to/test.js) 🟢 [ACTIVE BUFFER]\nCursor at line 2, column 3 (marked with 🔸)\nShowing lines 1-5 of 5 total lines\nContent:\n    1: line 1\n    2: li🔸ne 2\n    3: line 3"
            }
          ]
        };
      }
    );

    // Connect transport
    await server.connect(transport as any);

    // Test read_resource request
    const request = {
      method: "resources/read",
      params: {
        uri: "neovim-buffer://current"
      }
    };

    const response = await transport.sendRequest(request);
    
    // Verify the response
    expect(response.contents).toBeDefined();
    expect(response.contents.length).toBe(2);
    
    // The first content should be JSON
    const jsonContent = response.contents.find((c: any) => c.mimeType === "application/json");
    expect(jsonContent).toBeDefined();
    
    // The second content should be text/plain
    const textContent = response.contents.find((c: any) => c.mimeType === "text/plain");
    expect(textContent).toBeDefined();
    
    // Parse the JSON response
    const parsed = JSON.parse(jsonContent.text);
    expect(parsed.windows).toBeDefined();
    expect(parsed.windows.length).toBe(1);
    expect(parsed.windows[0].isActiveBuffer).toBe(true);
    expect(parsed.windows[0].cursor).toEqual([2, 3]);
    expect(parsed.windows[0].content).toContain("🔸");
  });
});
