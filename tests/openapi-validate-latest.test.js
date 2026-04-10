const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

/**
 * Recursively find all OpenAPI YAML files under the dist directory.
 */
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

/**
 * Parse a version directory name into a comparable structure.
 * e.g. "v2.1.x-errata1" -> { major: 2, minor: 1, errata: 1 }
 *      "v2.1.x"          -> { major: 2, minor: 1, errata: 0 }
 *      "v2.1"             -> { major: 2, minor: 1, errata: 0 }
 *      "v1.2-errata1"     -> { major: 1, minor: 2, errata: 1 }
 */
function parseVersion(versionDir) {
  const match = versionDir.match(/^v(\d+)\.(\d+)(?:\.x)?(?:-errata(\d+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    errata: match[3] ? parseInt(match[3], 10) : 0,
  };
}

/**
 * Compare two parsed versions. Returns positive if a > b, negative if a < b, 0 if equal.
 */
function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.errata - b.errata;
}

/**
 * For each product area (api-hub, ozone-connect, standards), determine the
 * highest major.minor version, then collect all spec files from that version.
 * If an errata exists for that version, use the errata files instead of (or
 * in addition to) the base version files.
 *
 * Returns an array of file paths.
 */
function findLatestSpecs(distDir) {
  const products = fs.readdirSync(distDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  const latestFiles = [];

  for (const product of products) {
    const productDir = path.join(distDir, product);
    const versionDirs = fs.readdirSync(productDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name, parsed: parseVersion(e.name) }))
      .filter(e => e.parsed);

    if (versionDirs.length === 0) continue;

    // Find the highest major.minor version
    const highestBase = versionDirs.reduce((best, cur) => {
      const a = cur.parsed, b = best.parsed;
      if (a.major > b.major) return cur;
      if (a.major === b.major && a.minor > b.minor) return cur;
      return best;
    });
    const { major, minor } = highestBase.parsed;

    // Collect all version dirs that match this major.minor (base + errata)
    const matchingDirs = versionDirs
      .filter(v => v.parsed.major === major && v.parsed.minor === minor)
      .sort((a, b) => compareVersions(b.parsed, a.parsed));

    // For each spec filename, prefer the highest errata; fall back to base
    const specsByName = {};
    for (const { name: versionDir, parsed } of matchingDirs) {
      const openapiDir = path.join(productDir, versionDir, 'openapi');
      if (!fs.existsSync(openapiDir)) continue;

      for (const file of fs.readdirSync(openapiDir)) {
        if (!file.endsWith('-openapi.yaml')) continue;
        // First seen wins (sorted highest-first), so errata takes precedence
        if (!specsByName[file]) {
          specsByName[file] = path.join(openapiDir, file);
        }
      }
    }

    latestFiles.push(...Object.values(specsByName));
  }

  return latestFiles;
}

const distDir = path.join(__dirname, '..', 'dist');
const latestSpecs = findLatestSpecs(distDir);

describe('OpenAPI spec validation (latest versions)', () => {
  it('should find latest spec files', () => {
    assert.ok(latestSpecs.length > 0, 'Expected at least one latest spec file');
  });

  for (const filePath of latestSpecs) {
    const relativePath = path.relative(path.join(__dirname, '..'), filePath);

    it(`${relativePath} should not have double-escaped regex patterns (OF-6288)`, () => {
      const content = fs.readFileSync(filePath, 'utf8');
      const doubleEscaped = /pattern:\s.*\\\\d/g;
      const matches = content.match(doubleEscaped);
      assert.strictEqual(
        matches,
        null,
        `Found double-escaped regex pattern(s) — likely a bug:\n  ${(matches || []).join('\n  ')}`
      );
    });
  }
});
