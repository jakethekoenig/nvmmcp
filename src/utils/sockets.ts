/**
 * Socket utilities for nvmmcp
 * Handles socket validation, normalization, and connection management.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

/**
 * Validates and normalizes a socket path
 */
export function normalizeSocketPath(socketPath: string): string {
  if (!socketPath) {
    throw new Error("Socket path is required");
  }
  
  // Replace ~ with home directory if present
  if (socketPath.startsWith('~')) {
    socketPath = path.join(process.env.HOME || '', socketPath.slice(1));
  }
  
  // Ensure absolute path
  if (!path.isAbsolute(socketPath)) {
    socketPath = path.join(process.cwd(), socketPath);
  }
  
  return socketPath;
}

/**
 * Check if a socket file exists
 */
export async function checkSocketExists(socketPath: string): Promise<boolean> {
  try {
    await fs.access(socketPath);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Check if an error is likely a timeout error
 */
export function isTimeoutError(error: any): boolean {
  const errorMsg = String(error).toLowerCase();
  return errorMsg.includes('timeout') || 
         errorMsg.includes('timed out') || 
         errorMsg.includes('econnrefused') || 
         errorMsg.includes('connection refused');
}

/**
 * Provides user-friendly guidance for socket issues
 */
export function getSocketTroubleshootingGuidance(socketPath: string, isTimeout = false): string {
  const socketDir = path.dirname(socketPath);
  const socketDirExistsSync = existsSync(socketDir);
  
  let guidance = '';
  
  if (isTimeout) {
    guidance += `Connection timed out or refused. The Neovim RPC server is probably not running.\n`;
    guidance += `Make sure Neovim is running and listening on the socket.\n`;
  } else {
    guidance += `Socket not found at: ${socketPath}\n`;
    
    if (!socketDirExistsSync) {
      guidance += `Directory ${socketDir} does not exist. Create it or specify a different path.\n`;
    }
  }
  
  guidance += `Start Neovim with: nvim --listen ${socketPath}\n`;
  
  if (socketPath.includes(' ')) {
    guidance += `Note: Your socket path contains spaces. Make sure to quote it properly.\n`;
  }
  
  return guidance;
}
