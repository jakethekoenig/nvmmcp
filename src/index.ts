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
  console.error(`Using socket path: ${socketPath}`);
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
    
    // Verify the connection is working by testing a simple command
    try {
      const apiInfo = await nvim.apiInfo;
      console.error(`Successfully connected to Neovim (API level: ${apiInfo[0]})`);
      return true;
    } catch (apiError) {
      console.error(`Connected but couldn't verify API: ${apiError}`);
      return true; // Still consider it connected
    }
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
    description: "View the content of visible buffers with cursor position",
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
    console.error(`Tool call: ${name} with args:`, args);

    // Ensure we're connected to Neovim
    if (!isNeovimConnected()) {
      console.error("Neovim connection not established, attempting to connect...");
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
        console.error("Starting view_buffers command");
        // Get all windows
        const windows = await nvim.windows;
        console.error(`Found ${windows.length} windows`);
        const currentWindow = await nvim.window;
        
        let result = [];
        
        // Process each window
        for (const window of windows) {
          try {
            console.error("Processing a window...");
            const windowNumber = await window.number;
            console.error(`Window number: ${windowNumber}`);
            const isCurrentWindow = (await currentWindow.number) === windowNumber;
            console.error(`Is current window: ${isCurrentWindow}`);
            
            // Get window's buffer with detailed error logging
            console.error(`Getting buffer for window ${windowNumber}...`);
            const buffer = await window.buffer;
            
            // Check if buffer is defined
            if (!buffer) {
              console.error(`Buffer is undefined for window ${windowNumber}`);
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
            
            console.error(`Buffer type: ${typeof buffer}`);
            console.error(`Buffer constructor: ${buffer.constructor?.name || 'unknown'}`);
            console.error(`Buffer properties: ${Object.getOwnPropertyNames(buffer)}`);
            
            // Try different API methods with explicit error handling
            try {
              // Get buffer info
              console.error("Getting buffer name...");
              const bufferName = await buffer.name;
              console.error(`Buffer name: ${bufferName || 'Unnamed'}`);
              
              console.error("Getting buffer number...");
              const bufferNumber = await buffer.number;
              console.error(`Buffer number: ${bufferNumber}`);
              
              // Get cursor position
              console.error("Getting cursor position...");
              const cursor = await window.cursor;
              console.error(`Cursor position: ${cursor}`);
              
              // Use a direct API call to nvim to get the buffer line count
              console.error("Getting buffer line count...");
              
              // Get the buffer ID, ensuring it's resolved
              const bufferId = await buffer.id;
              console.error(`Buffer ID: ${bufferId} (type: ${typeof bufferId})`);
              
              // Method that should work reliably: use buffer.length
              const bufLen = await buffer.length;
              console.error(`Buffer length property: ${bufLen} (type: ${typeof bufLen})`);
              
              // Ensure we have a valid integer to prevent the "Wrong type for argument 2" error
              // Convert to a JavaScript number using parseInt to ensure it's an integer
              // The user is still getting the type error, so let's be extra cautious
              const lineCount = parseInt(String(bufLen), 10);
              console.error(`Final line count: ${lineCount} (type: ${typeof lineCount})`);
              
              // Double check it's actually an integer, not a float
              if (!Number.isInteger(lineCount)) {
                console.error(`WARNING: lineCount is not an integer: ${lineCount}`);
              }
              
              const method = "buffer.length property";
              
              console.error(`Line count (using ${method}): ${lineCount}`);
              
              // Try to get buffer content directly using nvim_buf_get_lines API
              // to ensure exact parameter types
              console.error(`Getting buffer content with line count: ${lineCount}...`);
              
              // Initialize content variable
              let content = [];
              
              try {
                // First try the high-level buffer.getLines method
                console.error(`Attempting to use buffer.getLines(0, ${lineCount}, false)...`);
                content = await buffer.getLines(0, lineCount, false);
                console.error(`Got ${content.length} lines using buffer.getLines`);
              } catch (getlinesError) {
                console.error(`buffer.getLines failed, falling back to direct API call: ${getlinesError}`);
                
                try {
                  // Fall back to direct API call with carefully controlled types
                  const bufferId = await buffer.id;
                  
                  // Cast all parameters to the expected types explicitly
                  const start = 0;
                  const end = Math.max(1, lineCount); // ensure it's at least 1 to avoid empty buffer issues
                  
                  console.error(`Using direct API call nvim_buf_get_lines with params:`, {
                    buffer_id: bufferId,
                    start,
                    end,
                    strict: false
                  });
                  
                  // Use the direct API call
                  content = await nvim.request('nvim_buf_get_lines', [
                    bufferId,   // Buffer ID
                    start,      // Start (inclusive, 0-indexed)
                    end,        // End (exclusive, 0-indexed)
                    false       // Strict
                  ]);
                  
                  console.error(`Got ${content.length} lines using direct API call`);
                } catch (apiError) {
                  console.error(`Both methods failed to get buffer content: ${apiError}`);
                  // Provide some default content to prevent further errors
                  content = [`Error getting buffer content: ${apiError}`];
                }
              }
              
              // Format content with cursor marker
              const contentWithCursor = content.map((line: string, idx: number) => {
                if (isCurrentWindow && idx === cursor[0] - 1) {
                  // Insert cursor marker at the position
                  const beforeCursor = line.substring(0, cursor[1]);
                  const afterCursor = line.substring(cursor[1]);
                  return `${beforeCursor}|${afterCursor}`;
                }
                return line;
              });
              
              // Add window info to result
              result.push({
                windowNumber,
                isCurrentWindow,
                bufferNumber,
                bufferName: bufferName || "Unnamed",
                cursor,
                content: contentWithCursor.join('\n')
              });
              
            } catch (bufferError) {
              console.error(`Error processing buffer details: ${bufferError}`);
              result.push({
                windowNumber,
                isCurrentWindow,
                bufferNumber: "Error",
                bufferName: "Error processing buffer",
                cursor: [0, 0],
                content: `Error processing buffer: ${bufferError}`
              });
            }
          } catch (windowError) {
            console.error(`Error processing window: ${windowError}`);
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
        
        // Format the result as text
        console.error(`Formatting ${result.length} window results...`);
        const formattedResult = result.map(window => {
          return `Window ${window.windowNumber}${window.isCurrentWindow ? ' (current)' : ''} - Buffer ${window.bufferNumber} (${window.bufferName})
Cursor at line ${window.cursor[0]}, column ${window.cursor[1]}
Content:
${window.content}
${'='.repeat(80)}`;
        }).join('\n\n');
        
        console.error("View buffers command completed successfully");
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
