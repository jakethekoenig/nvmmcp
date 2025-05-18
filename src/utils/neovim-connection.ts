/**
 * Utility functions for Neovim connection handling
 */

import { attach } from 'neovim';
import { checkSocketExists, getSocketTroubleshootingGuidance, isTimeoutError } from '../socket-utils.js';
import { withTimeout, NVIM_API_TIMEOUT_MS, NVIM_CONNECTION_TIMEOUT_MS } from './timeout.js';

// Neovim client reference
let nvim: any;

/**
 * Check if Neovim connection is ready and connected
 */
export function isNeovimConnected(): boolean {
  return nvim !== undefined && nvim !== null;
}

/**
 * Check if the Neovim connection is alive by sending a test command
 */
export async function isNeovimAlive(): Promise<boolean> {
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

/**
 * Function to connect to Neovim with better error handling
 * @param socketPath Path to the Neovim socket file
 * @returns Promise resolving to a boolean indicating success
 */
export async function connectToNeovim(socketPath: string): Promise<boolean> {
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

/**
 * Get the Neovim client instance
 * @returns The Neovim client instance
 */
export function getNvim(): any {
  return nvim;
}

/**
 * Reset the Neovim connection
 */
export function resetNvimConnection(): void {
  nvim = null as any;
}
