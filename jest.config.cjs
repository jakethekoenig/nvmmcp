/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: false, // Use CommonJS for tests
        isolatedModules: true
      }
    ]
  },
  testTimeout: 30000, // Longer timeout for integration tests
  testMatch: [
    '**/tests/**/*.test.ts',
  ],
  verbose: true,
};
