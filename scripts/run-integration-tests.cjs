#!/usr/bin/env node
'use strict';

// Each PostgreSQL integration suite gets its own Jest process. A shared
// process previously let one suite's degraded connection pool (for example
// after Railway's temporary proxy was torn down mid-run) leak into every
// later suite instead of failing just that one.

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const rootDir = path.resolve(__dirname, '..');
const suiteRegex = /\.integration\.spec\.ts$/;
const perSuiteTimeoutMs = Number(process.env.SLE_INTEGRATION_SUITE_TIMEOUT_MS ?? 180_000);

function findSuites(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findSuites(fullPath, out);
    } else if (suiteRegex.test(entry.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

const suites = findSuites(rootDir, []).sort();

if (suites.length === 0) {
  console.log('No *.integration.spec.ts suites found.');
  process.exit(0);
}

const jestBin = path.join(rootDir, 'node_modules', '.bin', 'jest');
let failures = 0;

for (const suite of suites) {
  const relativePath = path.relative(rootDir, suite);
  console.log(`\n--- Running ${relativePath} (own process, timeout ${perSuiteTimeoutMs}ms) ---`);
  const result = spawnSync(
    jestBin,
    ['--config', 'jest.integration.config.cjs', '--runInBand', relativePath],
    {
      cwd: rootDir,
      stdio: 'inherit',
      timeout: perSuiteTimeoutMs,
      killSignal: 'SIGKILL',
    },
  );

  if (result.error) {
    console.error(`${relativePath} failed to start: ${result.error.message}`);
    failures += 1;
    continue;
  }
  if (result.signal) {
    console.error(`${relativePath} was killed (signal ${result.signal}), likely a timeout.`);
    failures += 1;
    continue;
  }
  if (result.status !== 0) {
    console.error(`${relativePath} exited with status ${result.status}.`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\n${failures} of ${suites.length} integration suite(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${suites.length} integration suite(s) passed.`);
