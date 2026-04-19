const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const YAML = require('yaml');
const { relativeToRepo } = require('../helpers');
const {
  parsePatchVersion,
  patchKey,
  bodyWithoutVersionAndChangelog,
  findChangelogSection,
  buildErrataPairs,
} = require('../errata-uplift-shared');

const pairs = buildErrataPairs('ozone-connect');

describe('ozone-connect errata: changes require patch uplift with changelog', () => {
  if (pairs.length === 0) {
    it('finds errata pairs to check', () => {
      // OK if there are no erratas yet.
    });
    return;
  }

  for (const { predecessorPath, errataPath } of pairs) {
    const rel = relativeToRepo(errataPath);
    const relPred = relativeToRepo(predecessorPath);

    it(`${rel} is uplifted and has a changelog entry when it differs from ${relPred}`, () => {
      const predecessorDoc = YAML.parse(fs.readFileSync(predecessorPath, 'utf8'));
      const errataDoc = YAML.parse(fs.readFileSync(errataPath, 'utf8'));

      const predecessorVer = parsePatchVersion(predecessorDoc.info && predecessorDoc.info.version);
      const errataVer = parsePatchVersion(errataDoc.info && errataDoc.info.version);

      if (!predecessorVer || !errataVer) return;

      const contentChanged =
        bodyWithoutVersionAndChangelog(predecessorDoc) !== bodyWithoutVersionAndChangelog(errataDoc);
      const versionChanged = patchKey(errataVer) !== patchKey(predecessorVer);

      if (contentChanged) {
        assert.ok(
          patchKey(errataVer) > patchKey(predecessorVer),
          `Content differs from ${relPred} (${predecessorDoc.info.version}) but info.version "${errataDoc.info.version}" is not a patch uplift. Bump the final segment (e.g. v2.1.6 -> v2.1.7) whenever an errata file changes.`
        );
      }

      if (versionChanged) {
        const section = findChangelogSection(errataDoc.info.description, errataDoc.info.version);
        assert.ok(
          section && section.length > 0,
          `info.version "${errataDoc.info.version}" has no "### ${errataDoc.info.version}" section with content in info.description. Every patch uplift must be accompanied by a matching changelog entry describing the change.`
        );
      }
    });
  }
});
