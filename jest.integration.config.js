/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/tests/integration'],
  testMatch: ['**/*.integration.test.ts'],
  setupFiles: ['<rootDir>/src/tests/integration/env.setup.ts'],
  maxWorkers: 1,
};
