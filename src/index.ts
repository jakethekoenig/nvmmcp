#!/usr/bin/env node

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { attach } from 'neovim';
import { z } from "zod";
import * as fs from 'fs/promises';
import * as path from 'path';

// Socket utilities
import { normalizeSocketPath, checkSocketExists, getSocketTroubleshootingGuidance } from './socket-utils.js';

// Define types for working with the MCP SDK
type NeovimClient = any;

// Define buffer content types
interface BufferInfo {
  windowNumber: number | string;
  isCurrentWindow: boolean;
  isActiveBuffer: boolean;
  bufferNumber: number | string;
  bufferName: string;
  cursor: [number, number];
  totalLines: number;
  visibleRange: {
    startLine: number;
    endLine: number;
    context: number;
  };
  content: string[];
}

// Buffer resource structure
interface BufferResource {
  uri: string;
  name: string;
  windows: BufferInfo[];
  timestamp: string;
}

// Buffer Schema
const BufferSchema = z.object({
  windowNumber: z.union([z.number(), z.string()]),
  isCurrentWindow: z.boolean(),
  isActiveBuffer: z.boolean(),
  bufferNumber: z.union([z.number(), z.string()]),
  bufferName: z.string(),
  cursor: z.tuple([z.number(), z.number()]),
  totalLines: z.number(),
  visibleRange: z.object({
    startLine: z.number(),
    endLine: z.number(),
    context: z.number(),
  }),
  content: z.array(z.string()),
});

// Get the Neovim socket path from command line arguments
let socketPath: string;
try {
  // Get and normalize the socket path
  const rawSocketPath = process.argv[2];
  if (!rawSocketPath) {
    console.error("Error: Socket path argument is required");
    console.error("Usage: npx nvmmcp /path/to/nvim/socket");
    process.exit(1);
  }
  
  socketPath = normalizeSocketPath(rawSocketPath);
} catch (error) {
  console.error(`Error processing socket path: ${error}`);
  console.error("Usage: npx nvmmcp /path/to/nvim/socket");
  process.exit(1);
}

// Connect to Neovim via socket
let nvim: NeovimClient;

// Check if Neovim connection is ready and connected
function isNeovimConnected(): boolean {
  return nvim !== undefined && nvim !== null;
}

// Function to connect to Neovim with better error handling
async function connectToNeovim(): Promise<boolean> {
  console.error(`Connecting to Neovim via socket: ${socketPath}`);
  
  // Check if socket exists before attempting connection
  const socketExists = await checkSocketExists(socketPath);
  if (!socketExists) {
    console.error(`Error: Socket file not found at ${socketPath}`);
    console.error(getSocketTroubleshootingGuidance(socketPath));
    return false;
  }
  
  try {
    // Connection options with timeout to prevent hanging indefinitely
    const options = { 
      socket: socketPath,
      // Set timeout to 5 seconds (in milliseconds)
      timeout: 5000
    };
    
    nvim = await attach(options);
    console.error("Successfully connected to Neovim");
    return true;
  } catch (error) {
    console.error(`Failed to connect to Neovim: ${error}`);
    console.error(getSocketTroubleshootingGuidance(socketPath));
    return false;
  }
}

// Schema definitions for the tool arguments
const SendNormalModeArgsSchema = z.object({
  keys: z.string().describe("Normal mode keystrokes to send to Neovim")
});

const SendCommandModeArgsSchema = z.object({
  command: z.string().describe("Command mode command to execute in Neovim")
});

// Initialize the MCP server with resource types
const server = new McpServer({
  name: "neovim-mcp-server",
  version: "0.1.0"
});

// Function to get current buffer contents
async function getBufferContents(): Promise<BufferInfo[]> {
  if (!isNeovimConnected()) {
    const connected = await connectToNeovim();
    if (!connected) {
      throw new Error(`Could not connect to Neovim at ${socketPath}. Make sure Neovim is running with '--listen ${socketPath}'.`);
    }
  }

  // Get all windows
  const windows = await nvim.windows;
  const currentWindow = await nvim.window;
  
  let result: BufferInfo[] = [];
  
  // Process each window
  for (const window of windows) {
    try {
      const windowNumber = await window.number;
      const isCurrentWindow = (await currentWindow.number) === windowNumber;
      
      // Get window's buffer
      const buffer = await window.buffer;
      
      // Check if buffer is defined
      if (!buffer) {
        result.push({
          windowNumber,
          isCurrentWindow,
          isActiveBuffer: isCurrentWindow,
          bufferNumber: "Unknown",
          bufferName: "Buffer is undefined",
          cursor: [0, 0],
          totalLines: 0,
          visibleRange: {
            startLine: 0,
            endLine: 0,
            context: 0
          },
          content: ["Error: Buffer object is undefined"]
        });
        continue;
      }
      
      // Get buffer info
      const bufferName = await buffer.name;
      const bufferNumber = await buffer.number;
      
      // Get cursor position
      const cursor = await window.cursor;
      
      // Get buffer line count using buffer.length
      const bufLen = await buffer.length;
      const lineCount = parseInt(String(bufLen), 10);
      
      // Calculate the range of lines to show (±100 lines around cursor)
      const cursorLine = cursor[0] - 1; // Convert to 0-based index
      const contextLines = 100; // Number of lines to show above and below cursor
      const startLine = Math.max(0, cursorLine - contextLines);
      const endLine = Math.min(lineCount, cursorLine + contextLines + 1);
      
      // Get the buffer content (only the lines around the cursor)
      let content = [];
      try {
        content = await buffer.getLines(startLine, endLine, false);
      } catch (getlinesError) {
        try {
          // Fall back to direct API call
          const bufferId = await buffer.id;
          content = await nvim.request('nvim_buf_get_lines', [
            bufferId,
            startLine,
            endLine,
            false
          ]);
        } catch (apiError) {
          content = [`Error getting buffer content: ${apiError}`];
        }
      }
      
      // Format content with cursor emoji
      const cursorEmoji = "🔸"; // Cursor indicator emoji
      const contentWithCursor = content.map((line: string, idx: number) => {
        const actualLineNumber = startLine + idx;
        if (isCurrentWindow && actualLineNumber === cursorLine) {
          // Insert cursor emoji at the position
          const beforeCursor = line.substring(0, cursor[1]);
          const afterCursor = line.substring(cursor[1]);
          return `${beforeCursor}${cursorEmoji}${afterCursor}`;
        }
        return line;
      });
      
      // Add line numbers to content
      const formattedContent = contentWithCursor.map((line: string, idx: number) => {
        const lineNumber = startLine + idx + 1; // Convert to 1-based for display
        return `${lineNumber.toString().padStart(5, ' ')}: ${line}`;
      });
      
      // Add window info to result with context information
      result.push({
        windowNumber,
        isCurrentWindow,
        isActiveBuffer: isCurrentWindow, // The buffer in the current window is the active one
        bufferNumber,
        bufferName: bufferName || "Unnamed",
        cursor,
        totalLines: lineCount,
        visibleRange: {
          startLine: startLine + 1, // Convert to 1-based for display
          endLine: endLine,
          context: contextLines
        },
        content: formattedContent
      });
    } catch (windowError) {
      result.push({
        windowNumber: "Error",
        isCurrentWindow: false,
        isActiveBuffer: false,
        bufferNumber: "Error",
        bufferName: "Error processing window",
        cursor: [0, 0],
        totalLines: 0,
        visibleRange: {
          startLine: 0,
          endLine: 0,
          context: 0
        },
        content: [`Error processing window: ${windowError}`]
      });
    }
  }
  
  return result;
}

// Format buffer content for display
function formatBufferContent(bufferInfo: BufferInfo): string {
  const visibilityInfo = bufferInfo.visibleRange 
    ? `Showing lines ${bufferInfo.visibleRange.startLine}-${bufferInfo.visibleRange.endLine} of ${bufferInfo.totalLines} total lines (±${bufferInfo.visibleRange.context} lines around cursor)`
    : 'Full content';
  
  // Create a prominent indicator for the active buffer
  const activeBufferIndicator = bufferInfo.isActiveBuffer 
    ? ' 🟢 [ACTIVE BUFFER - Commands in normal mode will affect this buffer]' 
    : '';
    
  return `Window ${bufferInfo.windowNumber}${bufferInfo.isCurrentWindow ? ' (current)' : ''} - Buffer ${bufferInfo.bufferNumber} (${bufferInfo.bufferName})${activeBufferIndicator}
Cursor at line ${bufferInfo.cursor[0]}, column ${bufferInfo.cursor[1]} (marked with 🔸)
${visibilityInfo}
Content:
${bufferInfo.content.join('\n')}
${'='.repeat(80)}`;
}

// Add the buffers resource with URI scheme neovim-buffer://
server.resource(
  "buffers",
  new ResourceTemplate("neovim-buffer://current", { 
    list: async () => {
      // List only the current buffer resource
      return [{ 
        uri: "neovim-buffer://current",
        name: "Current Neovim Buffers",
        mimeType: "application/json"
      }];
    }
  }),
  async (uri) => {
    try {
      // Get the current buffers
      const buffers = await getBufferContents();
      
      const resource: BufferResource = {
        uri: uri.toString(),
        name: "Neovim Buffers",
        windows: buffers,
        timestamp: new Date().toISOString()
      };
      
      // Return as both JSON and formatted text
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify(resource, null, 2)
          },
          {
            uri: uri.toString(),
            mimeType: "text/plain",
            text: buffers.map(buffer => formatBufferContent(buffer)).join('\n\n')
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Error reading buffer resource: ${errorMessage}`);
    }
  }
);
      
// Add the normal mode tool
server.tool(
  "send_normal_mode",
  SendNormalModeArgsSchema,
  async ({ keys }) => {
    try {
      // Ensure we're connected to Neovim
      if (!isNeovimConnected()) {
        const connected = await connectToNeovim();
        if (!connected) {
          return {
            content: [{ 
              type: "text", 
              text: `Error: Could not connect to Neovim at ${socketPath}. Make sure Neovim is running with '--listen ${socketPath}'.` 
            }],
            isError: true
          };
        }
      }
      
      // Execute keys in normal mode
      await nvim.command(`normal! ${keys}`);
      
      // After changing buffer state, send a notification that buffers changed
      server.server.sendNotification({
        method: "resources/changed",
        params: {
          resources: ["neovim-buffer://current"]
        }
      });
      
      return {
        content: [{ 
          type: "text", 
          text: `Successfully sent normal mode keystrokes: ${keys}` 
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true
      };
    }
  }
);

// Add the command mode tool
server.tool(
  "send_command_mode",
  SendCommandModeArgsSchema,
  async ({ command }) => {
    try {
      // Ensure we're connected to Neovim
      if (!isNeovimConnected()) {
        const connected = await connectToNeovim();
        if (!connected) {
          return {
            content: [{ 
              type: "text", 
              text: `Error: Could not connect to Neovim at ${socketPath}. Make sure Neovim is running with '--listen ${socketPath}'.` 
            }],
            isError: true
          };
        }
      }
      
      // Execute command and get output
      const output = await nvim.commandOutput(command);
      
      // After changing buffer state, send a notification that buffers changed
      server.server.sendNotification({
        method: "resources/changed",
        params: {
          resources: ["neovim-buffer://current"]
        }
      });
      
      return {
        content: [{ 
          type: "text", 
          text: `Command: ${command}\nOutput:\n${output}` 
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true
      };
    }
  }
);

// Start server
async function runServer() {
  // Try to connect to Neovim, but continue even if it fails
  const connected = await connectToNeovim();
  
  // Start MCP server regardless of Neovim connection status
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  if (connected) {
    console.error("Neovim MCP Server running on stdio with active Neovim connection");
  } else {
    console.error("Neovim MCP Server running on stdio WITHOUT Neovim connection");
    console.error(`The server will retry connecting when tools are used`);
    console.error(`Start Neovim with: nvim --listen ${socketPath}`);
  }
  
  // Setup buffer change monitoring if connected
  if (connected) {
    try {
      // Subscribe to buffer events to detect changes
      await nvim.command('augroup MCPBufferMonitor');
      await nvim.command('autocmd!');
      await nvim.command('autocmd BufEnter,BufWritePost,CursorMoved,CursorMovedI * call rpcnotify(0, "buffer_changed")');
      await nvim.command('augroup END');
      
      // Handle buffer change notifications
      nvim.on('notification', (method: string, _args: any[]) => {
        if (method === 'buffer_changed') {
          // Send notification that buffer resources have changed
          server.server.sendNotification({
            method: "resources/changed",
            params: {
              resources: ["neovim-buffer://current"]
            }
          });
        }
      });
      
      console.error("Buffer change monitoring enabled");
    } catch (error) {
      console.error("Failed to setup buffer change monitoring:", error);
    }
  }
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
