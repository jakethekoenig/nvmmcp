#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as path from 'path';

// Import socket utilities
import { normalizeSocketPath } from './utils/sockets.js';

// Import connection utilities
import { 
  connectToNeovim, 
  isNeovimConnected, 
  isNeovimAlive, 
  resetNvimConnection 
} from './utils/neovim-connection.js';

// Import timeout constants
import { NVIM_CONNECTION_TIMEOUT_MS } from './utils/timeout.js';

// Import actions
import { viewBuffers } from './actions/view-buffers.js';
import { sendNormalMode } from './actions/send-normal-mode.js';
import { sendCommandMode } from './actions/send-command-mode.js';

// Import types
import { ToolResponse } from './utils/types.js';

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
    description: "View the visible portion of buffers in Neovim with cursor position. Shows approximately ±100 lines around the cursor position rather than the entire file. The cursor position is marked with a 🔸 emoji. Clearly identifies the active buffer (the one that will be affected by normal mode commands) with a 🟢 indicator.",
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
    
    // Ensure we're connected to Neovim and the connection is alive
    if (!isNeovimConnected()) {
      // Try to establish a new connection
      const connected = await connectToNeovim(socketPath);
      if (!connected) {
        return {
          content: [{ 
            type: "text", 
            text: `Error: Could not connect to Neovim at ${socketPath}.\n` + 
                  `This is likely because:\n` +
                  `1. Neovim is not running\n` +
                  `2. Neovim was not started with the '--listen ${socketPath}' option\n` +
                  `3. The connection timed out after ${NVIM_CONNECTION_TIMEOUT_MS}ms\n\n` +
                  `Please start Neovim with: nvim --listen ${socketPath}`
          }],
          isError: true
        } as ToolResponse;
      }
    } else {
      // Check if the existing connection is still alive
      const connectionAlive = await isNeovimAlive();
      if (!connectionAlive) {
        console.error("Neovim connection is stale, attempting to reconnect...");
        
        // Reset the connection
        resetNvimConnection();
        
        // Try to reconnect
        const reconnected = await connectToNeovim(socketPath);
        if (!reconnected) {
          return {
            content: [{ 
              type: "text", 
              text: `Error: Lost connection to Neovim.\n` + 
                    `The Neovim process may have been closed or crashed.\n` +
                    `Attempted to reconnect but failed after ${NVIM_CONNECTION_TIMEOUT_MS}ms.\n\n` +
                    `Please ensure Neovim is running with: nvim --listen ${socketPath}`
            }],
            isError: true
          } as ToolResponse;
        }
      }
    }

    // Handle different tools
    switch (name) {
      case "view_buffers":
        return await viewBuffers();
      
      case "send_normal_mode":
        return await sendNormalMode(args);
      
      case "send_command_mode":
        return await sendCommandMode(args);
      
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
  const connected = await connectToNeovim(socketPath);
  
  // Start MCP server regardless of Neovim connection status
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  if (connected) {
    console.error("Neovim MCP Server running on stdio with active Neovim connection");
  } else {
    console.error("Neovim MCP Server running on stdio WITHOUT Neovim connection");
    console.error(`Connection failed or timed out after ${NVIM_CONNECTION_TIMEOUT_MS}ms`);
    console.error(`The server will retry connecting when tools are used`);
    console.error(`To fix this issue:`);
    console.error(`1. Make sure Neovim is running`);
    console.error(`2. Start Neovim with: nvim --listen ${socketPath}`);
  }
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
