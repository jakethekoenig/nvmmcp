/**
 * Implementation of the send_command_mode tool
 * Executes a command in Neovim's command mode and gets the output
 */

import { getNvim } from '../utils/neovim-connection.js';
import { withTimeout, NVIM_RPC_TIMEOUT_MS } from '../utils/timeout.js';
import { ToolResponse, ErrorWithMessage, SendCommandModeArgsSchema } from '../utils/types.js';

/**
 * Execute a command in Neovim's command mode and get the output
 * @param args The command to execute in command mode
 * @returns A response containing the command output or error
 */
export async function sendCommandMode(args: any): Promise<ToolResponse> {
  const parsed = SendCommandModeArgsSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(`Invalid arguments for send_command_mode: ${parsed.error}`);
  }
  
  try {
    const nvim = getNvim();
    
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
                `Please check if Neovim is still running and listening.`
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
