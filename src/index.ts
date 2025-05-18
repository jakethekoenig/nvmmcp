#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { attach } from 'neovim';
import { z } from "zod";
import * as fs from 'fs/promises';
import * as path from 'path';

// Socket utilities
import { normalizeSocketPath, checkSocketExists, getSocketTroubleshootingGuidance } from './socket-utils.js';

// Define types for working with the MCP SDK
type NeovimClient = any;
type ToolResponse = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

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
const ViewBuffersArgsSchema = z.object({}).optional();

const SendNormalModeArgsSchema = z.object({
  keys: z.string().describe("Normal mode keystrokes to send to Neovim")
});

const SendCommandModeArgsSchema = z.object({
  command: z.string().describe("Command mode command to execute in Neovim")
});

// Initialize the MCP server
const server = new Server(
  {
    name: "neovim-mcp-server",
    version: "0.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define the tools available in this server
const tools = [
  {
    name: "view_buffers",
    description: "View the visible portion of buffers in Neovim with cursor position. Shows approximately ±100 lines around the cursor position rather than the entire file. The cursor position is marked with a 🔸 emoji.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "send_normal_mode",
    description: "Send keystrokes to Neovim in normal mode",
    inputSchema: {
      type: "object",
      properties: {
        keys: {
          type: "string",
          description: "Normal mode keystrokes to send to Neovim",
        },
      },
      required: ["keys"],
    },
  },
  {
    name: "send_command_mode",
    description: "Execute a command in Neovim's command mode and get the output",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command mode command to execute in Neovim",
        },
      },
      required: ["command"],
    },
  },
];

// Create proper request schemas using the MCP protocol standard method names
const ListToolsRequestSchema = z.object({
  method: z.literal("tools/list"),
});

const CallToolRequestSchema = z.object({
  method: z.literal("tools/call"),
  params: z.object({
    name: z.string(),
    arguments: z.any(),
  }),
});

// Handle tools/list request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tools/call request
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;
    
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
        } as ToolResponse;
      }
    }

    // Handle different tools
    switch (name) {
      case "view_buffers": {
        // Get all windows
        const windows = await nvim.windows;
        const currentWindow = await nvim.window;
        
        let result = [];
        
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
                bufferNumber: "Unknown",
                bufferName: "Buffer is undefined",
                cursor: [0, 0],
                content: "Error: Buffer object is undefined"
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
            
            // Add line numbers to content and format with cursor position info
            const formattedContent = contentWithCursor.map((line: string, idx: number) => {
              const lineNumber = startLine + idx + 1; // Convert to 1-based for display
              return `${lineNumber.toString().padStart(5, ' ')}: ${line}`;
            });
            
            // Add window info to result with context information
            result.push({
              windowNumber,
              isCurrentWindow,
              bufferNumber,
              bufferName: bufferName || "Unnamed",
              cursor,
              totalLines: lineCount,
              visibleRange: {
                startLine: startLine + 1, // Convert to 1-based for display
                endLine: endLine,
                context: contextLines
              },
              content: formattedContent.join('\n')
            });
          } catch (windowError) {
            result.push({
              windowNumber: "Error",
              isCurrentWindow: false,
              bufferNumber: "Error",
              bufferName: "Error processing window",
              cursor: [0, 0],
              content: `Error processing window: ${windowError}`
            });
          }
        }
        
        // Format the result as text with visible range information
        const formattedResult = result.map(window => {
          const visibilityInfo = window.visibleRange 
            ? `Showing lines ${window.visibleRange.startLine}-${window.visibleRange.endLine} of ${window.totalLines} total lines (±${window.visibleRange.context} lines around cursor)`
            : 'Full content';
            
          return `Window ${window.windowNumber}${window.isCurrentWindow ? ' (current)' : ''} - Buffer ${window.bufferNumber} (${window.bufferName})
Cursor at line ${window.cursor[0]}, column ${window.cursor[1]} (marked with 🔸)
${visibilityInfo}
Content:
${window.content}
${'='.repeat(80)}`;
        }).join('\n\n');
        
        return {
          content: [{ type: "text", text: formattedResult || "No visible buffers found" }]
        } as ToolResponse;
      }
      
      case "send_normal_mode": {
        const parsed = SendNormalModeArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for send_normal_mode: ${parsed.error}`);
        }
        
        // Execute keys in normal mode
        await nvim.command(`normal! ${parsed.data.keys}`);
        
        return {
          content: [{ 
            type: "text", 
            text: `Successfully sent normal mode keystrokes: ${parsed.data.keys}` 
          }]
        } as ToolResponse;
      }
      
      case "send_command_mode": {
        const parsed = SendCommandModeArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for send_command_mode: ${parsed.error}`);
        }
        
        // Execute command and get output
        const output = await nvim.commandOutput(parsed.data.command);
        
        return {
          content: [{ 
            type: "text", 
            text: `Command: ${parsed.data.command}\nOutput:\n${output}` 
          }]
        } as ToolResponse;
      }
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    } as ToolResponse;
  }
});

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
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
