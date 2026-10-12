const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const YAML = require('yaml');
const { distDir, findOpenApiFiles, relativeToRepo } = require('../helpers');
const { parsePatchVersion } = require('../errata-uplift-shared');

// The api-hub and ozone-connect `vX.Y.x` folders each hold one minor line, and
// the changelog in info.description records only that line's history. When a
// spec is carried forward into a new line (e.g. v2.1.x -> v2.2.x), the previous
// line's `### v2.1.N` sections stay with the v2.1.x copy and are dropped from
// the new one, which starts again at `### v2.2.1`. Standards folders don't
// carry a patch changelog, so they're out of scope.
const LINE_FOLDER = /^v(\d+)\.(\d+)\.x$/;
const CHANGELOG_HEADING = /^#{2,4}[ \t]+(v\S+)/gm;

const lineSpecs = findOpenApiFiles(distDir)
  .map(filePath => {
    const [, category, versionDir] = relativeToRepo(filePath).split(/[\\/]/);
    const match = ['api-hub', 'ozone-connect'].includes(category) && versionDir.match(LINE_FOLDER);
    return match && { filePath, versionDir, major: +match[1], minor: +match[2] };
  })
  .filter(Boolean);

describe('Changelog headings belong to the version line of their folder', () => {
  for (const { filePath, versionDir, major, minor } of lineSpecs) {
    const rel = relativeToRepo(filePath);

    it(`${rel} only has v${major}.${minor}.N changelog headings`, () => {
      const description = YAML.parse(fs.readFileSync(filePath, 'utf8'))?.info?.description;
      if (typeof description !== 'string') return;

      const outOfLine = [...description.matchAll(CHANGELOG_HEADING)]
        .map(m => m[1])
        .filter(version => {
          const parsed = parsePatchVersion(version);
          return !parsed || parsed.major !== major || parsed.minor !== minor;
        });

      assert.deepStrictEqual(
        outOfLine,
        [],
        `${rel} has changelog headings outside the ${versionDir} line: ${outOfLine.join(', ')}. `
          + `History from other lines belongs in that line's folder, not here.`
      );
    });
  }
});
