const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const {
  distDir, relativeToRepo, parseVersion, compareVersions, listVersionDirs,
} = require('../helpers');

const SPEC_FILE = 'uae-authorization-endpoints-openapi.yaml';

// The consent `type` URN names the Standards version it belongs to
// (`urn:openfinanceuae:account-access-consent:v2.2`), so every copy of this spec
// must use the `major.minor` of the folder it sits in. A folder carried forward
// from the previous line without uplifting its URNs fails here — as v2.2-rc2 did
// when it was copied from v2.1-errata3 still reading `:v2.1`.
//
// Checked from v2.1, where `type` became an enum with a discriminator. Before
// that the file carried only an `example` under a version-agnostic `pattern`,
// and the published v2.0-errata1 example still reads `:v1.2`.
const START_VERSION = parseVersion('v2.1');

// A string that is, in its entirety, a consent type URN. Anchored, so prose that
// mentions a URN and the `pattern` regex that matches one are not picked up.
const URN = /^urn:openfinanceuae:[a-z-]+:(v\d+\.\d+)$/;

function escapePointerToken(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

// Every URN in the document — enum values, discriminator mapping keys, examples —
// with the JSON Pointer it was found at.
function collectUrns(node, pointer = '#', found = []) {
  if (typeof node === 'string') {
    const match = node.match(URN);
    if (match) found.push({ pointer, urn: node, version: match[1] });
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      const child = `${pointer}/${escapePointerToken(key)}`;
      const match = key.match(URN);
      if (match) found.push({ pointer: child, urn: key, version: match[1] });
      collectUrns(value, child, found);
    }
  }
  return found;
}

const standardsDir = path.join(distDir, 'standards');

const folders = listVersionDirs('standards')
  .filter(v => compareVersions(v.parsed, START_VERSION) >= 0)
  .filter(v => fs.existsSync(path.join(standardsDir, v.name, SPEC_FILE)));

describe(`standards ${SPEC_FILE}: consent type URNs match the folder version`, () => {
  if (folders.length === 0) {
    it(`finds at least one standards folder containing ${SPEC_FILE}`, () => {
      assert.fail(`No ${SPEC_FILE} found in any standards folder from v2.1 onward under ${standardsDir}`);
    });
    return;
  }

  for (const { name, parsed } of folders) {
    const expected = `v${parsed.major}.${parsed.minor}`;
    const full = path.join(standardsDir, name, SPEC_FILE);
    it(`${relativeToRepo(full)} consent type URNs end in :${expected}`, () => {
      const urns = collectUrns(YAML.parse(fs.readFileSync(full, 'utf8')));
      assert.ok(
        urns.length > 0,
        `No urn:openfinanceuae:* values found in ${relativeToRepo(full)}. The consent type enums are expected here; if they have moved, update this test.`
      );
      const wrong = urns.filter(u => u.version !== expected);
      if (wrong.length > 0) {
        assert.fail(
          `${wrong.length} consent type URN(s) in ${name} do not end in :${expected}:\n  ${wrong.map(u => `${u.pointer}: ${u.urn}`).join('\n  ')}`
        );
      }
    });
  }
});
