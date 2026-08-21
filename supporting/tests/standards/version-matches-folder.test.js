const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { distDir, relativeToRepo } = require('../helpers');

const standardsDir = path.join(distDir, 'standards');

// Every suffixed folder kind is a mutable working area whose `info.version` is
// the folder name verbatim: pre-release folders (`v2.2-draft1`, `v2.2-rc1`)
// before the version is published, erratas (`v2.1-errata3`) after. Base folders
// are excluded — their `info.version` is checked against the published release,
// not the folder.
const revisionDirs = fs.readdirSync(standardsDir, { withFileTypes: true })
  .filter(e => e.isDirectory() && /-(draft|rc|errata)\d+$/.test(e.name))
  .map(e => e.name);

describe('standards pre-release/errata files: info.version matches folder suffix', () => {
  if (revisionDirs.length === 0) {
    it('finds at least one standards pre-release or errata folder', () => {
      assert.fail(`No draft, rc or errata folders found under ${standardsDir}`);
    });
    return;
  }

  for (const dirName of revisionDirs) {
    const dir = path.join(standardsDir, dirName);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('-openapi.yaml'));
    for (const file of files) {
      const full = path.join(dir, file);
      it(`${relativeToRepo(full)} info.version === "${dirName}"`, () => {
        const doc = YAML.parse(fs.readFileSync(full, 'utf8'));
        assert.ok(doc && doc.info, 'Missing info block');
        assert.strictEqual(
          doc.info.version,
          dirName,
          `Expected info.version "${dirName}" but found "${doc.info.version}". Standards pre-release and errata files must carry the folder name as their version (e.g. "v2.1-errata1", "v2.2-rc1").`
        );
      });
    }
  }
});
