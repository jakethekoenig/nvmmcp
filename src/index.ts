#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

// Import resources
import { getNvimUserView } from './resources/nvim-user-view.js';

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
const server = new McpServer({
  name: "neovim-mcp-server",
  version: "0.0.0",
});

// Helper function to ensure connection to Neovim
async function ensureNeovimConnection() {
  if (!isNeovimConnected()) {
    // Try to establish a new connection
    const connected = await connectToNeovim(socketPath);
    if (!connected) {
      throw new Error(`Could not connect to Neovim at ${socketPath}.\n` + 
            `This is likely because:\n` +
            `1. Neovim is not running\n` +
            `2. Neovim was not started with the '--listen ${socketPath}' option\n` +
            `3. The connection timed out after ${NVIM_CONNECTION_TIMEOUT_MS}ms\n\n` +
            `Please start Neovim with: nvim --listen ${socketPath}`);
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
        throw new Error(`Lost connection to Neovim.\n` + 
              `The Neovim process may have been closed or crashed.\n` +
              `Attempted to reconnect but failed after ${NVIM_CONNECTION_TIMEOUT_MS}ms.\n\n` +
              `Please ensure Neovim is running with: nvim --listen ${socketPath}`);
      }
    }
  }
}

// Function to transform our action responses to McpServer format
async function adaptToolResponse(responsePromise: Promise<any>) {
  try {
    const response = await responsePromise;
    // If the response already has the correct format, return it
    if (response && typeof response === 'object' && Array.isArray(response.content)) {
      // Make sure type is strictly "text"
      const adaptedContent = response.content.map((item: any) => {
        if (item.type && typeof item.text === 'string') {
          return { type: "text" as const, text: item.text };
        }
        return item;
      });
      
      return {
        content: adaptedContent,
        isError: response.isError
      };
    }
    
    // If not, create a properly formatted response
    return {
      content: [{ type: "text" as const, text: String(response) }]
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: `Error: ${errorMessage}` }],
      isError: true
    };
  }
}

// Register tools
server.tool(
  "view_buffers",
  "View the visible portion of buffers in Neovim with cursor position. Shows approximately ±100 lines around the cursor position rather than the entire file.",
  async () => {
    await ensureNeovimConnection();
    const result = await viewBuffers();
    
    // Transform to the format expected by McpServer
    return {
      content: result.content.map(item => ({
        type: "text" as const,
        text: item.text
      })),
      isError: result.isError
    };
  }
);

server.tool(
  "send_normal_mode",
  {
    keys: z.string().describe("Normal mode keystrokes to send to Neovim")
  },
  async (args) => {
    await ensureNeovimConnection();
    const result = await sendNormalMode(args);
    
    // Transform to the format expected by McpServer
    return {
      content: result.content.map(item => ({
        type: "text" as const,
        text: item.text
      })),
      isError: result.isError
    };
  }
);

server.tool(
  "send_command_mode",
  {
    command: z.string().describe("Command mode command to execute in Neovim")
  },
  async (args) => {
    await ensureNeovimConnection();
    const result = await sendCommandMode(args);
    
    // Transform to the format expected by McpServer
    return {
      content: result.content.map(item => ({
        type: "text" as const,
        text: item.text
      })),
      isError: result.isError
    };
  }
);

// Register the nvim_user_view resource
server.resource(
  "nvim_user_view",
  "nvim://user-view",
  async (uri) => {
    try {
      await ensureNeovimConnection();
      const viewText = await getNvimUserView();
      return {
        contents: [{
          uri: uri.href,
          text: viewText
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        contents: [{
          uri: uri.href,
          text: `Error accessing Neovim user view: ${errorMessage}`
        }]
      };
    }
  }
);

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
