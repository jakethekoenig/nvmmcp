/**
 * Implementation of the send_normal_mode tool
 * Sends keystrokes to Neovim in normal mode
 */

import { getNvim } from '../utils/neovim-connection.js';
import { withTimeout, NVIM_RPC_TIMEOUT_MS } from '../utils/timeout.js';
import { ToolResponse, ErrorWithMessage, SendNormalModeArgsSchema } from '../utils/types.js';

/**
 * Send keystrokes to Neovim in normal mode
 * @param args The keys to send in normal mode
 * @returns A response indicating success or failure
 */
export async function sendNormalMode(args: any): Promise<ToolResponse> {
  const parsed = SendNormalModeArgsSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(`Invalid arguments for send_normal_mode: ${parsed.error}`);
  }
  
  try {
    const nvim = getNvim();
    
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
                `Please check if Neovim is still running and listening.`
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
