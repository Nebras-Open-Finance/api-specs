const fs = require('node:fs');
const path = require('node:path');

const distDir = path.join(__dirname, '..', 'dist');
const repoRoot = path.join(__dirname, '..');

function findOpenApiFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findOpenApiFiles(fullPath, files);
    } else if (entry.name.endsWith('-openapi.yaml')) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseVersion(versionDir) {
  const match = versionDir.match(/^v(\d+)\.(\d+)(?:\.x)?(?:-errata(\d+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    errata: match[3] ? parseInt(match[3], 10) : 0,
  };
}

function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.errata - b.errata;
}

function findLatestSpecs(dir = distDir) {
  const products = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  const latestFiles = [];

  for (const product of products) {
    const productDir = path.join(dir, product);
    const versionDirs = fs.readdirSync(productDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name, parsed: parseVersion(e.name) }))
      .filter(e => e.parsed);

    if (versionDirs.length === 0) continue;

    const highestBase = versionDirs.reduce((best, cur) => {
      const a = cur.parsed, b = best.parsed;
      if (a.major > b.major) return cur;
      if (a.major === b.major && a.minor > b.minor) return cur;
      return best;
    });
    const { major, minor } = highestBase.parsed;

    const matchingDirs = versionDirs
      .filter(v => v.parsed.major === major && v.parsed.minor === minor)
      .sort((a, b) => compareVersions(b.parsed, a.parsed));

    const specsByName = {};
    for (const { name: versionDir } of matchingDirs) {
      const specDir = path.join(productDir, versionDir);
      if (!fs.existsSync(specDir)) continue;

      for (const file of fs.readdirSync(specDir)) {
        if (!file.endsWith('-openapi.yaml')) continue;
        if (!specsByName[file]) {
          specsByName[file] = path.join(specDir, file);
        }
      }
    }

    latestFiles.push(...Object.values(specsByName));
  }

  return latestFiles;
}

function relativeToRepo(filePath) {
  return path.relative(repoRoot, filePath);
}

module.exports = {
  distDir,
  repoRoot,
  findOpenApiFiles,
  findLatestSpecs,
  parseVersion,
  compareVersions,
  relativeToRepo,
};
