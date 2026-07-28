/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/tests/integration'],
  testMatch: ['**/*.integration.test.ts'],
  setupFiles: ['<rootDir>/src/tests/integration/env.setup.ts'],
  maxWorkers: 1,
  // PostgreSQL integration tests exercise several authenticated HTTP calls in
  // one case; CI and Docker startup can legitimately exceed Jest's 5s default.
  testTimeout: 15000,
};
