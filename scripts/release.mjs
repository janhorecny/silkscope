#!/usr/bin/env node
// Cut a release: bump package.json and move CHANGELOG's Unreleased entries under the new version.
// Usage: npm run release -- patch|minor|major      (does not commit, tag or publish)

import fs from 'node:fs';

const kind = process.argv[2];
if (!['patch', 'minor', 'major'].includes(kind)) {
  console.error('usage: npm run release -- patch|minor|major');
  process.exit(1);
}

const pkgUrl = new URL('../package.json', import.meta.url);
const logUrl = new URL('../CHANGELOG.md', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(pkgUrl, 'utf8'));
let log = fs.readFileSync(logUrl, 'utf8');

const [maj, min, pat] = pkg.version.split('.').map(Number);
const next = kind === 'major' ? `${maj + 1}.0.0` : kind === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;

const head = '## [Unreleased]';
const start = log.indexOf(head);
const end = log.indexOf('\n## [', start + head.length);
const body = log.slice(start + head.length, end).trim();
if (!body) {
  console.error('CHANGELOG has nothing under [Unreleased]; add entries before releasing.');
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
log = log.slice(0, start) + `${head}\n\n## [${next}] - ${date}\n\n${body}\n` + log.slice(end);
const repo = 'https://github.com/janhorecny/silkscope';
log = log.replace(/^\[Unreleased\]: .*$/m, `[Unreleased]: ${repo}/compare/v${next}...HEAD\n[${next}]: ${repo}/compare/v${pkg.version}...v${next}`);

pkg.version = next;
fs.writeFileSync(pkgUrl, JSON.stringify(pkg, null, 2) + '\n');
fs.writeFileSync(logUrl, log);
console.log(`silkscope ${next}\n\nnext:\n  git commit -am "Release v${next}"\n  git tag v${next}\n  git push && git push --tags`);
