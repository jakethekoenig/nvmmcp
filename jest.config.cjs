/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx)$': 'babel-jest'
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@modelcontextprotocol|neovim)/)'
  ],
  testTimeout: 30000, // Longer timeout for integration tests
  testMatch: [
    '**/tests/**/*.test.ts',
  ],
  verbose: true,
  moduleFileExtensions: ['js', 'ts'],
  // Handle ESM compatibility issues
  globals: {
    'ts-jest': {
      useESM: false
    }
  }
};
