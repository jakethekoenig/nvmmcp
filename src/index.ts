#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { attach } from 'neovim';
import { z } from "zod";
import * as fs from 'fs/promises';
import * as path from 'path';

// Define types for working with the MCP SDK
type NeovimClient = any;
type ToolResponse = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

// Get the Neovim socket path from command line arguments
const socketPath = process.argv[2];
if (!socketPath) {
  console.error("Error: Socket path argument is required");
  console.error("Usage: npx nvmmcp /path/to/nvim/socket");
  process.exit(1);
}

// Connect to Neovim via socket
let nvim: NeovimClient;

// Function to connect to Neovim
async function connectToNeovim(): Promise<boolean> {
  try {
    console.error(`Connecting to Neovim via socket: ${socketPath}`);
    nvim = await attach({ socket: socketPath });
    console.error("Successfully connected to Neovim");
    return true;
  } catch (error) {
    console.error(`Failed to connect to Neovim: ${error}`);
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
    version: "1.0.0",
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

// Create proper request schemas
const ListToolsRequestSchema = z.object({
  method: z.literal("mcp.list_tools"),
});

const CallToolRequestSchema = z.object({
  method: z.literal("mcp.call_tool"),
  params: z.object({
    name: z.string(),
    arguments: z.any(),
  }),
});

// Handle tool requests
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;
    console.error(`Tool call: ${name} with args:`, args);

    // Ensure we're connected to Neovim
    if (!nvim) {
      const connected = await connectToNeovim();
      if (!connected) {
        return {
          content: [{ 
            type: "text", 
            text: `Error: Failed to connect to Neovim via socket: ${socketPath}` 
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
        for (let i = 0; i < windows.length; i++) {
          const window = windows[i];
          const windowNumber = await window.number;
          const isCurrentWindow = (await currentWindow.number) === windowNumber;
          
          // Get window's buffer
          const buffer = await window.buffer;
          const bufferName = await buffer.name;
          const bufferNumber = await buffer.number;
          
          // Get cursor position [row, col]
          const cursor = await window.cursor;
          
          // Get buffer lines
          const lineCount = await buffer.length;
          const content = await buffer.getLines(0, lineCount, false);
          
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
            bufferName,
            cursor,
            content: contentWithCursor.join('\n')
          });
        }
        
        // Format the result as text
        const formattedResult = result.map(window => {
          return `Window ${window.windowNumber}${window.isCurrentWindow ? ' (current)' : ''} - Buffer ${window.bufferNumber} (${window.bufferName || 'Unnamed'})
Cursor at line ${window.cursor[0]}, column ${window.cursor[1]}
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
    console.error(`Error in tool call:`, errorMessage);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    } as ToolResponse;
  }
});

// Start server
async function runServer() {
  // Connect to Neovim
  await connectToNeovim();
  
  // Start MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error("Neovim MCP Server running on stdio");
  console.error(`Connected to Neovim socket: ${socketPath}`);
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
