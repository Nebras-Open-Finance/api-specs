const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { distDir, relativeToRepo } = require('../helpers');

const standardsDir = path.join(distDir, 'standards');

const erratadirs = fs.readdirSync(standardsDir, { withFileTypes: true })
  .filter(e => e.isDirectory() && /-errata\d+$/.test(e.name))
  .map(e => e.name);

describe('standards errata files: info.version matches folder suffix', () => {
  if (erratadirs.length === 0) {
    it('finds at least one standards errata folder', () => {
      assert.fail(`No errata folders found under ${standardsDir}`);
    });
    return;
  }

  for (const dirName of erratadirs) {
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
          `Expected info.version "${dirName}" but found "${doc.info.version}". Standards errata files must carry the folder suffix as their version (e.g. "v2.1-errata1").`
        );
      });
    }
  }
});
