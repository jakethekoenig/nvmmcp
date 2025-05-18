/**
 * Implementation of the view_buffers tool
 * Shows the visible portion of buffers in Neovim with cursor position
 */

import { getNvim } from '../utils/neovim-connection.js';
import { withTimeout, NVIM_RPC_TIMEOUT_MS } from '../utils/timeout.js';
import { ToolResponse, ErrorWithMessage } from '../utils/types.js';

/**
 * View the visible portion of buffers in Neovim with cursor position
 * Shows approximately ±100 lines around the cursor position rather than the entire file
 * Includes tab information and all buffers list
 */
export async function viewBuffers(): Promise<ToolResponse> {
  try {
    const nvim = getNvim();
    
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
              'Timeout getting buffer for window'
            );
            
            if (!buffer) {
              windowsInfo.push({
                number: windowNumber,
                bufferName: "Buffer is undefined",
                bufferNumber: "Unknown"
              });
              continue;
            }
            
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
            
            windowsInfo.push({
              number: windowNumber,
              bufferName: bufferName || "Unnamed",
              bufferNumber
            });
          } catch (winError) {
            windowsInfo.push({
              number: "Error",
              bufferName: "Error processing window",
              bufferNumber: "Error",
              error: `${winError}`
            });
          }
        }
        
        tabsInfo.push({
          number: tabNumber,
          isCurrent: tabNumber === currentTabNumber,
          windows: windowsInfo
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
    
    // Process each window in the current tab
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
    
    // Format all buffers list
    const buffersListText = allBuffersInfo.map(buf => 
      `Buffer ${buf.number}: ${buf.name}${buf.isLoaded ? ' (loaded)' : ''}`
    ).join('\n');
    
    // Format tabs list with windows
    const tabsListText = tabsInfo.map(tab => {
      const tabHeader = `Tab ${tab.number}${tab.isCurrent ? ' (current)' : ''}:`;
      const windowsList = tab.windows.map(win => 
        `  - Window ${win.number} - Buffer ${win.bufferNumber} (${win.bufferName})`
      ).join('\n');
      
      return `${tabHeader}\n${windowsList}`;
    }).join('\n\n');
    
    // Format the result as text with visible range information
    const formattedResult = result.map(window => {
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
    
    // Combine all information
    const finalOutput = 
`===== TABS =====
${tabsListText}

===== ALL BUFFERS =====
${buffersListText}

===== VISIBLE WINDOWS IN CURRENT TAB =====
${formattedResult || "No visible buffers found"}`;

    return {
      content: [{ type: "text", text: finalOutput }]
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
                `Please check if Neovim is still running and listening.`
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
