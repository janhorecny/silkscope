import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const log = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

test('package version is semver', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test('CHANGELOG has an Unreleased section and an entry for the current version', () => {
  assert.match(log, /^## \[Unreleased\]$/m);
  assert.match(log, new RegExp(`^## \\[${pkg.version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm'));
});

test('version is not hard-coded in the UI', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /v\d+\.\d+\.\d+/);
});
