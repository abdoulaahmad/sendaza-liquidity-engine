module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['\\.integration\\.spec\\.ts$'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@sle/(domain|database|contracts|configuration|observability|testing)$':
      '<rootDir>/packages/$1/src',
  },
  collectCoverageFrom: ['apps/**/*.ts', 'packages/**/*.ts', '!**/main.ts'],
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
};
