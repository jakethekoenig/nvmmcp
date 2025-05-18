#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { attach } from 'neovim';
import { z } from "zod";
import * as fs from 'fs/promises';
import * as path from 'path';

// Socket utilities
import { normalizeSocketPath, checkSocketExists, getSocketTroubleshootingGuidance, isTimeoutError } from './socket-utils.js';

/**
 * Interface for window information with position data
 */
interface WindowInfo {
  number: number | string;
  bufferNumber?: number | string;
  bufferName?: string;
  isModified?: boolean;
  position: {
    row: number;
    col: number;
    width: number;
    height: number;
  };
}

/**
 * Interface for the layout information return type
 */
interface LayoutInfo {
  type: string;
  description: string;
}

/**
 * Determines the window layout (vertical or horizontal splits) based on window positions
 * @param windows Array of window information objects with position data
 * @returns Object with layout type and description
 */
function determineWindowLayout(windows: WindowInfo[]): LayoutInfo {
  if (!windows || windows.length <= 1) {
    return { type: 'single', description: 'Single window' };
  }
  
  // Sort windows by position (row, col)
  const sortedWindows = [...windows].sort((a, b) => {
    // Sort by row first, then by column
    if (a.position.row !== b.position.row) {
      return a.position.row - b.position.row;
    }
    return a.position.col - b.position.col;
  });
  
  // Count how many unique row and column positions we have
  const uniqueRows = new Set(sortedWindows.map(w => w.position.row)).size;
  const uniqueCols = new Set(sortedWindows.map(w => w.position.col)).size;
  
  // Determine primary layout direction
  if (uniqueRows === 1 && uniqueCols > 1) {
    // All windows in same row = horizontal splits only
    return { 
      type: 'horizontal', 
      description: `${windows.length} windows with horizontal splits (side by side)` 
    };
  } else if (uniqueRows > 1 && uniqueCols === 1) {
    // All windows in same column = vertical splits only
    return { 
      type: 'vertical', 
      description: `${windows.length} windows with vertical splits (stacked)` 
    };
  } else if (uniqueRows > 1 && uniqueCols > 1) {
    // Mix of vertical and horizontal splits
    return { 
      type: 'mixed', 
      description: `${windows.length} windows with mixed layout (vertical and horizontal splits)` 
    };
  }
  
  // Fallback
  return { 
    type: 'complex', 
    description: `${windows.length} windows with complex layout` 
  };
}

// Import from neovim package but use 'any' type for flexibility
// The actual neovim types are complex and can cause TS errors

// We use ToolResponse for formatting our API responses
type ToolResponse = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

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
    description: "View information about Neovim buffers and tabs. Shows: 1) A summary of all open tabs and their contents, 2) A list of all open buffers with numbers and filenames, and 3) Detailed content of visible buffers in the current tab. For visible buffers, shows approximately ±100 lines around the cursor position. The cursor position is marked with a 🔸 emoji. Clearly identifies the active buffer (the one that will be affected by normal mode commands) with a 🟢 indicator.",
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
        } as ToolResponse;
      }
    } else {
      // Check if the existing connection is still alive
      const connectionAlive = await isNeovimAlive();
      if (!connectionAlive) {
        console.error("Neovim connection is stale, attempting to reconnect...");
        
        // Since there's no disconnect method in the neovim client,
        // we'll just reset the connection
        
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
          } as ToolResponse;
        }
      }
    }

    // Handle different tools
    switch (name) {
      case "view_buffers": {
        try {
          // Get current tab page
          const currentTabpage = await withTimeout(
            nvim.tabpage,
            NVIM_RPC_TIMEOUT_MS,
            'Timeout getting current tabpage'
          );
          
          const currentTabNumber = await withTimeout(
            currentTabpage.number,
            NVIM_RPC_TIMEOUT_MS,
            'Timeout getting current tabpage number'
          );
          
          // Get all tabpages
          const tabpages = await withTimeout(
            nvim.tabpages,
            NVIM_RPC_TIMEOUT_MS,
            'Timeout getting all tabpages'
          );
          
          // Get windows in current tab
          const windowsInCurrentTab = await withTimeout(
            currentTabpage.windows,
            NVIM_RPC_TIMEOUT_MS,
            'Timeout getting windows in current tab'
          );
          
          const currentWindow = await withTimeout(
            nvim.window,
            NVIM_RPC_TIMEOUT_MS,
            'Timeout getting current Neovim window'
          );
          
          // Get list of all buffers
          const allBuffers = await withTimeout(
            nvim.buffers,
            NVIM_RPC_TIMEOUT_MS,
            'Timeout getting all buffers'
          );
          
          // Get info about all open buffers
          let allBuffersInfo = [];
          for (const buffer of allBuffers) {
            try {
              const bufferNumber = await withTimeout(
                buffer.number,
                NVIM_RPC_TIMEOUT_MS,
                'Timeout getting buffer number'
              );
              
              const bufferName = await withTimeout(
                buffer.name,
                NVIM_RPC_TIMEOUT_MS,
                'Timeout getting buffer name'
              );
              
              // Check if buffer is loaded
              const isLoaded = await withTimeout(
                nvim.request('nvim_buf_is_loaded', [buffer.id]),
                NVIM_RPC_TIMEOUT_MS,
                'Timeout checking if buffer is loaded'
              );
              
              allBuffersInfo.push({
                number: bufferNumber,
                name: bufferName || 'Unnamed',
                isLoaded
              });
            } catch (bufferError) {
              allBuffersInfo.push({
                number: "Error",
                name: "Error retrieving buffer info",
                isLoaded: false
              });
            }
          }
          
          // Get tab information
          let tabsInfo = [];
          for (const tabpage of tabpages) {
            try {
              const tabNumber = await withTimeout(
                tabpage.number,
                NVIM_RPC_TIMEOUT_MS,
                'Timeout getting tab number'
              );
              
              const tabWindows = await withTimeout(
                tabpage.windows,
                NVIM_RPC_TIMEOUT_MS,
                'Timeout getting tab windows'
              );
              
              let windowsInfo = [];
              for (const win of tabWindows) {
                try {
                  const windowNumber = await withTimeout(
                    win.number,
                    NVIM_RPC_TIMEOUT_MS,
                    'Timeout getting window number'
                  );
                  
                  const buffer = await withTimeout(
                    win.buffer,
                    NVIM_RPC_TIMEOUT_MS,
                    'Timeout getting window buffer'
                  );
                  
                  const bufferNumber = await withTimeout(
                    buffer.number,
                    NVIM_RPC_TIMEOUT_MS,
                    'Timeout getting buffer number'
                  );
                  
                  const bufferName = await withTimeout(
                    buffer.name,
                    NVIM_RPC_TIMEOUT_MS,
                    'Timeout getting buffer name'
                  );
                  
                  // Check if buffer is modified (has unsaved changes)
                  const isModified = await withTimeout(
                    nvim.request('nvim_buf_get_option', [buffer.id, 'modified']),
                    NVIM_RPC_TIMEOUT_MS,
                    'Timeout checking if buffer is modified'
                  );
                  
                  // Get window position and dimensions
                  const winPosition = await withTimeout(
                    nvim.request('nvim_win_get_position', [win.id]),
                    NVIM_RPC_TIMEOUT_MS,
                    'Timeout getting window position'
                  );
                  
                  const winWidth = await withTimeout(
                    nvim.request('nvim_win_get_width', [win.id]),
                    NVIM_RPC_TIMEOUT_MS,
                    'Timeout getting window width'
                  );
                  
                  const winHeight = await withTimeout(
                    nvim.request('nvim_win_get_height', [win.id]),
                    NVIM_RPC_TIMEOUT_MS,
                    'Timeout getting window height'
                  );
                  
                  windowsInfo.push({
                    number: windowNumber,
                    bufferNumber,
                    bufferName: bufferName || 'Unnamed',
                    isModified,
                    position: {
                      row: winPosition[0],
                      col: winPosition[1],
                      width: winWidth,
                      height: winHeight
                    }
                  });
                } catch (windowError) {
                  windowsInfo.push({
                    number: "Error",
                    bufferNumber: "Error",
                    bufferName: "Error retrieving window info"
                  });
                }
              }
              
              // Determine the window layout based on window positions
              let layoutType = 'unknown';
              let layoutDescription = '';
              
              if (windowsInfo.length > 1) {
                // Check if windows are primarily arranged horizontally or vertically
                const layoutInfo = determineWindowLayout(windowsInfo);
                layoutType = layoutInfo.type;
                layoutDescription = layoutInfo.description;
              } else if (windowsInfo.length === 1) {
                layoutType = 'single';
                layoutDescription = 'Single window';
              } else {
                layoutType = 'empty';
                layoutDescription = 'No windows';
              }
              
              tabsInfo.push({
                number: tabNumber,
                isCurrent: tabNumber === currentTabNumber,
                windows: windowsInfo,
                layout: {
                  type: layoutType,
                  description: layoutDescription
                }
              });
            } catch (tabError) {
              tabsInfo.push({
                number: "Error",
                isCurrent: false,
                windows: [],
                error: `Error retrieving tab info: ${tabError}`
              });
            }
          }
          
          // Process windows in current tab
          let result = [];
          
          // Only process windows in the current tab
          for (const window of windowsInCurrentTab) {
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
                  bufferNumber: "Unknown",
                  bufferName: "Buffer is undefined",
                  cursor: [0, 0],
                  content: "Error: Buffer object is undefined"
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
              
              // Get the buffer content
              let content: string[] = [];
              try {
                content = await withTimeout(
                  buffer.getLines(0, lineCount, false),
                  NVIM_RPC_TIMEOUT_MS,
                  'Timeout getting buffer lines'
                );
              } catch (getlinesError) {
                try {
                  // Fall back to direct API call
                  const bufferId = await withTimeout(
                    buffer.id,
                    NVIM_RPC_TIMEOUT_MS,
                    'Timeout getting buffer ID'
                  );
                  const start = 0;
                  const end = Math.max(1, lineCount);
                  
                  content = await withTimeout(
                    nvim.request('nvim_buf_get_lines', [
                      bufferId,
                      start,
                      end,
                      false
                    ]),
                    NVIM_RPC_TIMEOUT_MS,
                    'Timeout making direct nvim_buf_get_lines request'
                  );
                } catch (apiError) {
                  content = [`Error getting buffer content: ${apiError}`];
                }
              }
            
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
          
          // Format tab summary
          const tabSummary = tabsInfo.map(tab => {
            const tabHeader = `Tab ${tab.number}${tab.isCurrent ? ' (current)' : ''}`;
            
            if (tab.error) {
              return `${tabHeader}\nError: ${tab.error}`;
            }
            
            // Add layout information if available
            let layoutInfo = '';
            if (tab.layout && tab.layout.type !== 'unknown') {
              // Create a simple visual representation of the layout
              let layoutSymbol = '';
              
              switch (tab.layout.type) {
                case 'horizontal':
                  layoutSymbol = '║║'; // Horizontal splits (side by side)
                  break;
                case 'vertical':
                  layoutSymbol = '═══'; // Vertical splits (stacked)
                  break;
                case 'mixed':
                  layoutSymbol = '╬'; // Mixed layout
                  break;
                case 'single':
                  layoutSymbol = '□'; // Single window
                  break;
                default:
                  layoutSymbol = '?'; // Unknown
              }
              
              layoutInfo = `  Layout: ${layoutSymbol} ${tab.layout.description}\n`;
            }
            
            const windowsInfo = tab.windows.map(win => {
              // Add [+] indicator for modified buffers
              const modifiedIndicator = win.isModified ? ' [+]' : '';
              return `  Window ${win.number}: Buffer ${win.bufferNumber} (${win.bufferName}${modifiedIndicator})`;
            }).join('\n');
            
            return `${tabHeader}\n${layoutInfo}${windowsInfo || '  No windows'}`;
          }).join('\n\n');
          
          // Format all buffers summary
          allBuffersInfo.sort((a, b) => {
            const numA = typeof a.number === 'number' ? a.number : -1;
            const numB = typeof b.number === 'number' ? b.number : -1;
            return numA - numB;
          });
          
          const allBuffersSummary = allBuffersInfo.map(buf => 
            `Buffer ${buf.number}: ${buf.name}${buf.isLoaded ? '' : ' (not loaded)'}`
          ).join('\n');
          
          // Format the visible buffers (in current tab) as text with visible range information
          const visibleBuffersContent = result.map(window => {
            // Handle potential undefined values with defaults
            const windowNumberText = window.windowNumber !== undefined ? window.windowNumber : 'N/A';
            const bufferNameText = window.bufferName || 'Unnamed';
            const cursorLine = window.cursor?.[0] !== undefined ? window.cursor[0] : 'N/A';
            const cursorColumn = window.cursor?.[1] !== undefined ? window.cursor[1] : 'N/A';
            
            // Ensure content is a string
            const contentText = window.content || "No content available";
            
            const visibilityInfo = window.visibleRange 
              ? `Showing lines ${window.visibleRange.startLine}-${window.visibleRange.endLine} of ${window.totalLines} total lines (±${window.visibleRange.context} lines around cursor)`
              : 'Full content';
            
            // Create a prominent indicator for the active buffer
            const activeBufferIndicator = window.isActiveBuffer 
              ? ' 🟢 [ACTIVE BUFFER - Commands in normal mode will affect this buffer]' 
              : '';
            
            // Construct window header with conditional buffer number
            let windowHeader = `Window ${windowNumberText}${window.isCurrentWindow ? ' (current)' : ''}`;
            
            // Only add buffer number if it's defined
            if (window.bufferNumber !== undefined) {
              windowHeader += ` - Buffer ${window.bufferNumber}`;
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
          const finalReport = [
            `## OPEN TABS SUMMARY`,
            `${tabSummary}`,
            `\n## ALL OPEN BUFFERS (${allBuffersInfo.length})`,
            `${allBuffersSummary}`,
            `\n## BUFFERS VISIBLE IN CURRENT TAB (${result.length})`,
            `${visibleBuffersContent || "No visible buffers found in current tab"}`
          ].join('\n');
          
          return {
            content: [{ type: "text", text: finalReport }]
          } as ToolResponse;
        } catch (error) {
          // Handle timeout errors specifically
          const err = error as ErrorWithMessage;
          if (err.message && err.message.includes('Timeout')) {
            console.error(`Timeout error in view_buffers: ${err.message}`);
            return {
              content: [{ 
                type: "text", 
                text: `Error: Neovim RPC operation timed out after ${NVIM_RPC_TIMEOUT_MS}ms.\n` +
                      `The Neovim process may have been closed or become unresponsive.\n` +
                      `Please check if Neovim is still running and listening on ${socketPath}.`
              }],
              isError: true
            } as ToolResponse;
          }
          
          // Handle other errors
          return {
            content: [{ 
              type: "text", 
              text: `Error in view_buffers: ${error}`
            }],
            isError: true
          } as ToolResponse;
        }
      }
      
      case "send_normal_mode": {
        const parsed = SendNormalModeArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for send_normal_mode: ${parsed.error}`);
        }
        
        try {
          // Execute keys in normal mode with timeout protection
          await withTimeout(
            nvim.command(`normal! ${parsed.data.keys}`),
            NVIM_RPC_TIMEOUT_MS,
            `Timeout sending normal mode command: ${parsed.data.keys}`
          );
          
          return {
            content: [{ 
              type: "text", 
              text: `Successfully sent normal mode keystrokes: ${parsed.data.keys}` 
            }]
          } as ToolResponse;
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
                      `Failed to send normal mode keystrokes: ${parsed.data.keys}\n` +
                      `Please check if Neovim is still running and listening on ${socketPath}.`
              }],
              isError: true
            } as ToolResponse;
          }
          
          // Handle other errors
          return {
            content: [{ 
              type: "text", 
              text: `Error sending normal mode keystrokes: ${error}`
            }],
            isError: true
          } as ToolResponse;
        }
      }
      
      case "send_command_mode": {
        const parsed = SendCommandModeArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for send_command_mode: ${parsed.error}`);
        }
        
        try {
          // Execute command and get output with timeout protection
          const output = await withTimeout(
            nvim.commandOutput(parsed.data.command),
            NVIM_RPC_TIMEOUT_MS,
            `Timeout executing command: ${parsed.data.command}`
          );
          
          return {
            content: [{ 
              type: "text", 
              text: `Command: ${parsed.data.command}\nOutput:\n${output}` 
            }]
          } as ToolResponse;
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
                      `Failed to execute command: ${parsed.data.command}\n` +
                      `Please check if Neovim is still running and listening on ${socketPath}.`
              }],
              isError: true
            } as ToolResponse;
          }
          
          // Handle other errors
          return {
            content: [{ 
              type: "text", 
              text: `Error executing command: ${error}`
            }],
            isError: true
          } as ToolResponse;
        }
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
