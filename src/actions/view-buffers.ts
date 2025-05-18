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
 */
export async function viewBuffers(): Promise<ToolResponse> {
  try {
    const nvim = getNvim();
    
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
    
    let result = [];
    
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
    
    return {
      content: [{ type: "text", text: formattedResult || "No visible buffers found" }]
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
