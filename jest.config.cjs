module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  collectCoverageFrom: ['apps/**/*.ts', 'packages/**/*.ts', '!**/main.ts'],
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
};
