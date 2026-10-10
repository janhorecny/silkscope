#!/usr/bin/env node
// Runs test/*.test.mjs with node:test. A script rather than a shell glob, because npm on Windows
// runs PowerShell/cmd, which pass "test/*.test.mjs" through unexpanded.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../test/', import.meta.url));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(dir, f));
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
