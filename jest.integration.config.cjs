module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.integration\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@sle/(domain|database|contracts|configuration|observability|testing)$':
      '<rootDir>/packages/$1/src',
  },
  setupFiles: ['<rootDir>/packages/testing/src/integration-env.ts'],
  testEnvironment: 'node',
  testTimeout: 60000,
};
