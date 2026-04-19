const fs = require('node:fs');
const path = require('node:path');
const { distDir, parseVersion } = require('./helpers');

const patchVersionRegex = /^v(\d+)\.(\d+)\.(\d+)$/;

function parsePatchVersion(version) {
  const m = typeof version === 'string' ? version.match(patchVersionRegex) : null;
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function patchKey(v) {
  return v.major * 1_000_000 + v.minor * 1_000 + v.patch;
}

function bodyWithoutVersionAndChangelog(doc) {
  const clone = JSON.parse(JSON.stringify(doc));
  if (clone.info) {
    delete clone.info.version;
    delete clone.info.description;
  }
  return JSON.stringify(clone);
}

function findChangelogSection(description, version) {
  if (typeof description !== 'string') return null;
  const heading = `### ${version}`;
  const idx = description.indexOf(heading);
  if (idx === -1) return null;
  const tail = description.slice(idx + heading.length);
  const nextHeading = tail.indexOf('### ');
  const section = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
  return section.trim();
}

function buildErrataPairs(category) {
  const pairs = [];
  const categoryDir = path.join(distDir, category);
  if (!fs.existsSync(categoryDir)) return pairs;

  const versionDirs = fs.readdirSync(categoryDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, parsed: parseVersion(e.name) }))
    .filter(e => e.parsed);

  const groups = new Map();
  for (const v of versionDirs) {
    const key = `${v.parsed.major}.${v.parsed.minor}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }

  for (const list of groups.values()) {
    list.sort((a, b) => a.parsed.errata - b.parsed.errata);
    for (let i = 1; i < list.length; i++) {
      const predecessor = list[i - 1];
      const errata = list[i];
      const errataDir = path.join(categoryDir, errata.name);
      const predecessorDir = path.join(categoryDir, predecessor.name);
      for (const file of fs.readdirSync(errataDir)) {
        if (!file.endsWith('-openapi.yaml')) continue;
        const predecessorPath = path.join(predecessorDir, file);
        const errataPath = path.join(errataDir, file);
        if (!fs.existsSync(predecessorPath)) continue;
        pairs.push({ predecessorPath, errataPath });
      }
    }
  }
  return pairs;
}

module.exports = {
  parsePatchVersion,
  patchKey,
  bodyWithoutVersionAndChangelog,
  findChangelogSection,
  buildErrataPairs,
};
