/**
 * Common types used across the application
 */

import { z } from "zod";

// We use ToolResponse for formatting our API responses
export type ToolResponse = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

// Simple interface for error handling
export interface ErrorWithMessage {
  message: string;
}

// Schema definitions for the tool arguments
export const ViewBuffersArgsSchema = z.object({}).optional();

export const SendNormalModeArgsSchema = z.object({
  keys: z.string().describe("Normal mode keystrokes to send to Neovim")
});

export const SendCommandModeArgsSchema = z.object({
  command: z.string().describe("Command mode command to execute in Neovim")
});
