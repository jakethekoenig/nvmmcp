/**
 * Utility functions for timeout handling
 */

// Define timeout for RPC operations to prevent hanging
export const NVIM_RPC_TIMEOUT_MS = 2000;

// Define the timeout for checking if connection is alive
export const NVIM_API_TIMEOUT_MS = 1000;

// Define the connection timeout constant
export const NVIM_CONNECTION_TIMEOUT_MS = 2000;

/**
 * Wraps a promise or value with a timeout to prevent hanging operations
 * @param valueOrPromise The promise or value to wrap with a timeout
 * @param timeoutMs Timeout in milliseconds
 * @param errorMessage Custom error message for timeout
 * @returns The result of the promise/value, or throws if timeout exceeded
 */
export async function withTimeout<T>(
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
