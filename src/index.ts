#!/usr/bin/env node

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server as ServerType } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { attach } from 'neovim';
import { z } from "zod";
import * as fs from 'fs/promises';
import * as path from 'path';

// Socket utilities
import { normalizeSocketPath, checkSocketExists, getSocketTroubleshootingGuidance, isTimeoutError } from './socket-utils.js';

// Import from neovim package but use 'any' type for flexibility
// The actual neovim types are complex and can cause TS errors

// We use ToolResponse for formatting our API responses
type ToolResponse = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

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
  allBuffers: {
    number: number | string;
    name: string;
    isLoaded: boolean;
  }[];
  tabs: {
    number: number;
    isCurrent: boolean;
    error?: string;
    windows: {
      number: number;
      bufferNumber: number | string;
      bufferName: string;
    }[];
  }[];
  timestamp: string;
}

// Simple interface for error handling
interface ErrorWithMessage {
  message: string;
}

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
let nvim: any;

// Define the timeout for checking if connection is alive
const NVIM_API_TIMEOUT_MS = 1000;

// Define timeout for RPC operations to prevent hanging
const NVIM_RPC_TIMEOUT_MS = 2000;

/**
 * Wraps a promise or value with a timeout to prevent hanging operations
 * @param valueOrPromise The promise or value to wrap with a timeout
 * @param timeoutMs Timeout in milliseconds
 * @param errorMessage Custom error message for timeout
 * @returns The result of the promise/value, or throws if timeout exceeded
 */
async function withTimeout<T>(
  valueOrPromise: T | Promise<T>, 
  timeoutMs: number = NVIM_RPC_TIMEOUT_MS, 
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  // Ensure we're working with a promise
  const promise = Promise.resolve(valueOrPromise);
  
  // Use Promise.race with explicit typing to preserve the return type
  return Promise.race<T>([
    promise,
    new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

// Check if Neovim connection is ready and connected
function isNeovimConnected(): boolean {
  return nvim !== undefined && nvim !== null;
}

// Check if the Neovim connection is alive by sending a test command
async function isNeovimAlive(): Promise<boolean> {
  if (!isNeovimConnected()) {
    return false;
  }
  
  try {
    // Use our withTimeout utility to add a timeout to the API call
    await withTimeout(
      nvim.apiInfo(),
      NVIM_API_TIMEOUT_MS,
      'Timeout checking Neovim connection'
    );
    
    // If we get here, the command succeeded
    return true;
  } catch (error) {
    console.error(`Neovim connection check failed: ${error}`);
    return false;
  }
}

// Define the connection timeout constant
const NVIM_CONNECTION_TIMEOUT_MS = 2000;

// Function to connect to Neovim with better error handling
async function connectToNeovim(): Promise<boolean> {
  console.error(`Connecting to Neovim via socket: ${socketPath}`);
  
  // Check if socket exists before attempting connection
  const socketExists = await checkSocketExists(socketPath);
  if (!socketExists) {
    console.error(`Error: Socket file not found at ${socketPath}`);
    console.error(getSocketTroubleshootingGuidance(socketPath, false));
    return false;
  }
  
  // Connection options with shorter timeout to prevent hanging 
  const options = { 
    socket: socketPath,
    // Set timeout to 2 seconds (in milliseconds)
    timeout: NVIM_CONNECTION_TIMEOUT_MS
  };
  
  try {
    nvim = await attach(options);
    console.error("Successfully connected to Neovim");
    return true;
  } catch (error) {
    const isTimeout = isTimeoutError(error);
    if (isTimeout) {
      console.error(`Timed out connecting to Neovim (${NVIM_CONNECTION_TIMEOUT_MS}ms). The Neovim process is probably not running or not listening on this socket.`);
    } else {
      console.error(`Failed to connect to Neovim: ${error}`);
    }
    console.error(getSocketTroubleshootingGuidance(socketPath, isTimeout));
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

// Initialize the MCP server with resources
const server = new McpServer({
  name: "neovim-mcp-server",
  version: "0.1.0",
});

// Define a function to process and format buffer content
async function getBufferContents(): Promise<{ 
  buffers: BufferInfo[]; 
  allBuffers: { number: number | string; name: string; isLoaded: boolean; }[];
  tabs: { 
    number: number; 
    isCurrent: boolean; 
    error?: string;
    windows: { number: number; bufferNumber: number | string; bufferName: string; }[]; 
  }[];
}> {
  // Ensure we're connected to Neovim and the connection is alive
  if (!isNeovimConnected()) {
    // Try to establish a new connection
    const connected = await connectToNeovim();
    if (!connected) {
      throw new Error(`Could not connect to Neovim at ${socketPath}. Make sure Neovim is running with '--listen ${socketPath}'.`);
    }
  }

  try {
    // Get all windows with timeout protection - nvim.windows is already a Promise
    const windows = await withTimeout(
      nvim.windows,
      NVIM_RPC_TIMEOUT_MS,
      'Timeout getting Neovim windows'
    );
    const currentWindow = await withTimeout(
      nvim.window,
      NVIM_RPC_TIMEOUT_MS,
      'Timeout getting current Neovim window'
    );
    
    // Get tabs info
    const tabs = await withTimeout(
      nvim.tabpages,
      NVIM_RPC_TIMEOUT_MS,
      'Timeout getting Neovim tabpages'
    );
    
    const currentTab = await withTimeout(
      nvim.tabpage,
      NVIM_RPC_TIMEOUT_MS,
      'Timeout getting current tabpage'
    );
    
    // Get list of all buffers
    const buffersList = await withTimeout(
      nvim.buffers,
      NVIM_RPC_TIMEOUT_MS,
      'Timeout getting buffer list'
    );
    
    // Process all buffers
    const allBuffersInfo = [];
    for (const buffer of buffersList) {
      try {
        const bufNumber = await withTimeout(
          buffer.number,
          NVIM_RPC_TIMEOUT_MS,
          'Timeout getting buffer number'
        );
        
        const bufName = await withTimeout(
          buffer.name,
          NVIM_RPC_TIMEOUT_MS,
          'Timeout getting buffer name'
        );
        
        const isLoaded = await withTimeout(
          buffer.isLoaded(),
          NVIM_RPC_TIMEOUT_MS,
          'Timeout checking if buffer is loaded'
        );
        
        allBuffersInfo.push({
          number: bufNumber,
          name: bufName || '[No Name]',
          isLoaded
        });
      } catch (bufferError) {
        allBuffersInfo.push({
          number: 'Error',
          name: `Error getting buffer info: ${bufferError}`,
          isLoaded: false
        });
      }
    }
    
    // Process tabs
    const tabsInfo = [];
    for (const tab of tabs) {
      try {
        const tabNumber = await withTimeout(
          tab.number,
          NVIM_RPC_TIMEOUT_MS,
          'Timeout getting tab number'
        );
        
        const isCurrentTab = (await withTimeout(
          currentTab.number,
          NVIM_RPC_TIMEOUT_MS,
          'Timeout getting current tab number'
        )) === tabNumber;
        
        // Get windows in this tab
        const tabWindows = await withTimeout(
          tab.windows,
          NVIM_RPC_TIMEOUT_MS,
          'Timeout getting windows for tab'
        );
        
        const windowsInfo = [];
        for (const win of tabWindows) {
          try {
            const winNumber = await withTimeout(
              win.number,
              NVIM_RPC_TIMEOUT_MS,
              'Timeout getting window number in tab'
            );
            
            const winBuffer = await withTimeout(
              win.buffer,
              NVIM_RPC_TIMEOUT_MS,
              'Timeout getting buffer for window in tab'
            );
            
            const bufNumber = await withTimeout(
              winBuffer.number,
              NVIM_RPC_TIMEOUT_MS,
              'Timeout getting buffer number for window in tab'
            );
            
            const bufName = await withTimeout(
              winBuffer.name,
              NVIM_RPC_TIMEOUT_MS,
              'Timeout getting buffer name for window in tab'
            );
            
            windowsInfo.push({
              number: winNumber,
              bufferNumber: bufNumber,
              bufferName: bufName || '[No Name]'
            });
          } catch (winError) {
            windowsInfo.push({
              number: 'Error',
              bufferNumber: 'Error',
              bufferName: `Error processing window: ${winError}`
            });
          }
        }
        
        tabsInfo.push({
          number: tabNumber,
          isCurrent: isCurrentTab,
          windows: windowsInfo
        });
      } catch (tabError) {
        tabsInfo.push({
          number: 'Error',
          isCurrent: false,
          error: `Error processing tab: ${tabError}`,
          windows: []
        });
      }
    }
    
    // Process visible buffers in current windows (as before)
    let result: BufferInfo[] = [];
    
    // Process each window
    for (const window of windows) {
      try {
        const windowNumber = await withTimeout(
          window.number,
          NVIM_RPC_TIMEOUT_MS,
          'Timeout getting window number'
        );
        const isCurrentWindow = (await withTimeout(
          currentWindow.number,
          NVIM_RPC_TIMEOUT_MS,
          'Timeout getting current window number'
        )) === windowNumber;
        
        // Get window's buffer
        const buffer = await withTimeout(
          window.buffer,
          NVIM_RPC_TIMEOUT_MS,
          'Timeout getting buffer for window'
        );
        
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
        const bufferName = await withTimeout(
          buffer.name,
          NVIM_RPC_TIMEOUT_MS,
          'Timeout getting buffer name'
        );
        const bufferNumber = await withTimeout(
          buffer.number,
          NVIM_RPC_TIMEOUT_MS,
          'Timeout getting buffer number'
        );
        
        // Get cursor position
        const cursor = await withTimeout(
          window.cursor,
          NVIM_RPC_TIMEOUT_MS,
          'Timeout getting cursor position'
        );
        
        // Get buffer line count using buffer.length
        const bufLen = await withTimeout(
          buffer.length,
          NVIM_RPC_TIMEOUT_MS,
          'Timeout getting buffer length'
        );
        const lineCount = parseInt(String(bufLen), 10);
        
        // Calculate the range of lines to show (±100 lines around cursor)
        const cursorLine = cursor[0] - 1; // Convert to 0-based index
        const contextLines = 100; // Number of lines to show above and below cursor
        const startLine = Math.max(0, cursorLine - contextLines);
        const endLine = Math.min(lineCount, cursorLine + contextLines + 1);
        
        // Get the buffer content (only the lines around the cursor)
        let contentSection: string[] = [];
        try {
          contentSection = await withTimeout(
            buffer.getLines(startLine, endLine, false),
            NVIM_RPC_TIMEOUT_MS,
            'Timeout getting buffer lines section'
          );
        } catch (getlinesError) {
          try {
            // Fall back to direct API call
            const bufferId = await withTimeout(
              buffer.id,
              NVIM_RPC_TIMEOUT_MS,
              'Timeout getting buffer ID'
            );
            
            contentSection = await withTimeout(
              nvim.request('nvim_buf_get_lines', [
                bufferId,
                startLine,
                endLine,
                false
              ]),
              NVIM_RPC_TIMEOUT_MS,
              'Timeout making direct nvim_buf_get_lines request'
            );
          } catch (apiError) {
            contentSection = [`Error getting buffer content: ${apiError}`];
          }
        }
        
        // Format content with cursor emoji
        const cursorEmoji = "🔸"; // Cursor indicator emoji
        const contentWithCursor = contentSection.map((line: string, idx: number) => {
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
          bufferName: `Error processing window: ${windowError}`,
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
    
    return {
      buffers: result,
      allBuffers: allBuffersInfo,
      tabs: tabsInfo
    };
  } catch (error) {
    const err = error as ErrorWithMessage;
    if (err.message && err.message.includes('Timeout')) {
      console.error(`Timeout error in getBufferContents: ${err.message}`);
      throw new Error(`Neovim RPC operation timed out after ${NVIM_RPC_TIMEOUT_MS}ms.\n` +
                     `The Neovim process may have been closed or become unresponsive.\n` +
                     `Please check if Neovim is still running and listening on ${socketPath}.`);
    }
    
    // Rethrow the error for handling at a higher level
    throw error;
  }
}

// Format buffer content for display
function formatBufferContent(resource: BufferResource): string {
  // Format tab summary
  const tabSummary = resource.tabs.map(tab => {
    const tabHeader = `Tab ${tab.number}${tab.isCurrent ? ' (current)' : ''}`;
    
    if (tab.error) {
      return `${tabHeader}\nError: ${tab.error}`;
    }
    
    const windowsInfo = tab.windows.map(win => 
      `  Window ${win.number}: Buffer ${win.bufferNumber} (${win.bufferName})`
    ).join('\n');
    
    return `${tabHeader}\n${windowsInfo || '  No windows'}`;
  }).join('\n\n');
  
  // Format all buffers summary
  const allBuffersSummary = resource.allBuffers
    .sort((a, b) => {
      const numA = typeof a.number === 'number' ? a.number : -1;
      const numB = typeof b.number === 'number' ? b.number : -1;
      return numA - numB;
    })
    .map(buf => 
      `Buffer ${buf.number}: ${buf.name}${buf.isLoaded ? '' : ' (not loaded)'}`
    ).join('\n');
  
  // Format the visible buffers (in current tab)
  const visibleBuffersContent = resource.windows.map(bufferInfo => {
    // Handle potential undefined values with defaults
    const windowNumberText = bufferInfo.windowNumber !== undefined ? bufferInfo.windowNumber : 'N/A';
    const bufferNameText = bufferInfo.bufferName || 'Unnamed';
    const cursorLine = bufferInfo.cursor?.[0] !== undefined ? bufferInfo.cursor[0] : 'N/A';
    const cursorColumn = bufferInfo.cursor?.[1] !== undefined ? bufferInfo.cursor[1] : 'N/A';
    
    // Ensure content is a string array and is properly joined
    const contentText = Array.isArray(bufferInfo.content) && bufferInfo.content.length > 0 
      ? bufferInfo.content.join('\n') 
      : "No content available";
    
    const visibilityInfo = bufferInfo.visibleRange 
      ? `Showing lines ${bufferInfo.visibleRange.startLine}-${bufferInfo.visibleRange.endLine} of ${bufferInfo.totalLines} total lines (±${bufferInfo.visibleRange.context} lines around cursor)`
      : 'Full content';
    
    // Create a prominent indicator for the active buffer
    const activeBufferIndicator = bufferInfo.isActiveBuffer 
      ? ' 🟢 [ACTIVE BUFFER - Commands in normal mode will affect this buffer]' 
      : '';
      
    // Construct window header with conditional buffer number
    let windowHeader = `Window ${windowNumberText}${bufferInfo.isCurrentWindow ? ' (current)' : ''}`;
      
    // Only add buffer number if it's defined
    if (bufferInfo.bufferNumber !== undefined) {
      windowHeader += ` - Buffer ${bufferInfo.bufferNumber}`;
    }
      
    // Add buffer name and active indicator
    windowHeader += ` (${bufferNameText})${activeBufferIndicator}`;
      
    return `${windowHeader}
Cursor at line ${cursorLine}, column ${cursorColumn} (marked with 🔸)
${visibilityInfo}
Content:
${contentText}
${'='.repeat(80)}`;
  }).join('\n\n');
  
  // Combine all sections into one comprehensive report
  const separator = '\n' + '='.repeat(80) + '\n\n';
  return [
    `## OPEN TABS SUMMARY`,
    `${tabSummary}`,
    `\n## ALL OPEN BUFFERS (${resource.allBuffers.length})`,
    `${allBuffersSummary}`,
    `\n## BUFFERS VISIBLE IN CURRENT TAB (${resource.windows.length})`,
    `${visibleBuffersContent || "No visible buffers found in current tab"}`
  ].join('\n');
}
}

// Add the buffers resource with URI scheme neovim-buffer://
server.resource(
  "buffers",
  new ResourceTemplate("neovim-buffer://current", { 
    list: async () => {
      // List only the current buffer resource
      return {
        resources: [{ 
          uri: "neovim-buffer://current",
          name: "Current Neovim Buffers",
          mimeType: "application/json"
        }]
      };
    }
  }),
  async (uri) => {
    try {
      // Get the current buffers
      const { buffers, allBuffers, tabs } = await getBufferContents();
      
      const resource: BufferResource = {
        uri: uri.toString(),
        name: "Neovim Buffers",
        windows: buffers,
        allBuffers,
        tabs,
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
            text: formatBufferContent(resource)
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
  { keys: z.string().describe("Normal mode keystrokes to send to Neovim") },
  async (params) => {
    const { keys } = params;
    try {
      // Ensure we're connected to Neovim
      if (!isNeovimConnected()) {
        // Try to establish a new connection
        const connected = await connectToNeovim();
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
          };
        }
      } else {
        // Check if the existing connection is still alive
        const connectionAlive = await isNeovimAlive();
        if (!connectionAlive) {
          console.error("Neovim connection is stale, attempting to reconnect...");
          
          // Reset the connection
          nvim = null as any;
          
          // Try to reconnect
          const reconnected = await connectToNeovim();
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
            };
          }
        }
      }
      
      try {
        // Execute keys in normal mode with timeout protection
        await withTimeout(
          nvim.command(`normal! ${keys}`),
          NVIM_RPC_TIMEOUT_MS,
          `Timeout sending normal mode command: ${keys}`
        );
        
        // After changing buffer state, send a notification that buffers changed
        server.server.notification({
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
        // Handle timeout errors specifically
        const err = error as ErrorWithMessage;
        if (err.message && err.message.includes('Timeout')) {
          console.error(`Timeout error in send_normal_mode: ${err.message}`);
          return {
            content: [{ 
              type: "text", 
              text: `Error: Neovim RPC operation timed out after ${NVIM_RPC_TIMEOUT_MS}ms.\n` +
                    `The Neovim process may have been closed or become unresponsive.\n` +
                    `Failed to send normal mode keystrokes: ${keys}\n` +
                    `Please check if Neovim is still running and listening on ${socketPath}.`
            }],
            isError: true
          };
        }
        
        // Handle other errors
        return {
          content: [{ 
            type: "text", 
            text: `Error sending normal mode keystrokes: ${error}`
          }],
          isError: true
        };
      }
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
  { command: z.string().describe("Command mode command to execute in Neovim") },
  async (params) => {
    const { command } = params;
    try {
      // Ensure we're connected to Neovim
      if (!isNeovimConnected()) {
        // Try to establish a new connection
        const connected = await connectToNeovim();
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
          };
        }
      } else {
        // Check if the existing connection is still alive
        const connectionAlive = await isNeovimAlive();
        if (!connectionAlive) {
          console.error("Neovim connection is stale, attempting to reconnect...");
          
          // Reset the connection
          nvim = null as any;
          
          // Try to reconnect
          const reconnected = await connectToNeovim();
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
            };
          }
        }
      }
      
      try {
        // Execute command and get output with timeout protection
        const output = await withTimeout(
          nvim.commandOutput(command),
          NVIM_RPC_TIMEOUT_MS,
          `Timeout executing command: ${command}`
        );
        
        // After changing buffer state, send a notification that buffers changed
        server.server.notification({
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
        // Handle timeout errors specifically
        const err = error as ErrorWithMessage;
        if (err.message && err.message.includes('Timeout')) {
          console.error(`Timeout error in send_command_mode: ${err.message}`);
          return {
            content: [{ 
              type: "text", 
              text: `Error: Neovim RPC operation timed out after ${NVIM_RPC_TIMEOUT_MS}ms.\n` +
                    `The Neovim process may have been closed or become unresponsive.\n` +
                    `Failed to execute command: ${command}\n` +
                    `Please check if Neovim is still running and listening on ${socketPath}.`
            }],
            isError: true
          };
        }
        
        // Handle other errors
        return {
          content: [{ 
            type: "text", 
            text: `Error executing command: ${error}`
          }],
          isError: true
        };
      }
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
    
    // Setup buffer change monitoring if connected
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
          const mcpServer = server.server as ServerType;
          server.server.notification({
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

