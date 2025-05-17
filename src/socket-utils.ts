/**
 * Socket utilities for nvmmcp
 * Handles socket validation, normalization, and connection management.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

/**
 * Validates and normalizes a socket path
 * 
 * @param socketPath The socket path provided by the user
 * @returns Normalized socket path
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
    // If relative, make it relative to current working directory
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
 * Provides user-friendly guidance for socket issues
 */
export function getSocketTroubleshootingGuidance(socketPath: string): string {
  const socketDir = path.dirname(socketPath);
  const socketExistsSync = existsSync(socketPath);
  const socketDirExistsSync = existsSync(socketDir);
  
  let guidance = `Socket not found at: ${socketPath}\n`;
  
  if (!socketDirExistsSync) {
    guidance += `Directory ${socketDir} does not exist. Create it or specify a different path.\n`;
  }
  
  guidance += `Start Neovim with: nvim --listen ${socketPath}\n`;
  
  if (socketPath.includes(' ')) {
    guidance += `Note: Your socket path contains spaces. Make sure to quote it properly.\n`;
  }
  
  guidance += `For temporary sockets, you can use: /tmp/nvim-socket\n`;
  
  return guidance;
}
