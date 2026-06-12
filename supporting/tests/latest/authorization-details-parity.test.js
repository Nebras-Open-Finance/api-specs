const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { findLatestSpecs, relativeToRepo } = require('../helpers');

// The `authorization_details` Rich Authorization Request (RAR) is created by the
// TPP, stored by the Hub, and read back by the LFI without translation. It
// surfaces in two API Hub specs that must therefore agree field-for-field:
//
//   Consent Manager — the LFI fetches the stored consent
//     `uae-api-hub-consent-manager-openapi.yaml`
//     :: AuthorizationDetails (newConsent.request)
//
//   Authorisation Server — the LFI reads the unbundled RAR off the `getAuth`
//   success response (`AuthSuccessResponse.interaction.params.authorization_details`)
//     `uae-api-hub-authorisation-server-openapi.yaml`
//     :: AuthorizationDetails
//
// The Authorisation Server copy is a verbatim copy of the Consent Manager
// schema sub-tree (the specs are self-contained and cannot cross-reference each
// other). This test resolves both `AuthorizationDetails` schemas by inlining all
// `$ref`s and asserts they are deep-equal, so any drift on either side - shape,
// enum, pattern, required, or description - is caught.

const CANONICAL = {
  label: 'Hub Consent Manager',
  file: 'uae-api-hub-consent-manager-openapi.yaml',
};
const COPY = {
  label: 'Hub Authorisation Server',
  file: 'uae-api-hub-authorisation-server-openapi.yaml',
};
const SCHEMA = 'AuthorizationDetails';

const SCHEMAS_PREFIX = '#/components/schemas/';

function inlineRefs(node, schemas, seen = new Set()) {
  if (Array.isArray(node)) return node.map(n => inlineRefs(n, schemas, seen));
  if (node && typeof node === 'object') {
    if (typeof node.$ref === 'string' && node.$ref.startsWith(SCHEMAS_PREFIX)) {
      const name = node.$ref.slice(SCHEMAS_PREFIX.length);
      if (seen.has(name)) return { $cycle: name };
      const target = schemas[name];
      if (!target) throw new Error(`Unresolvable $ref ${node.$ref}`);
      return inlineRefs(target, schemas, new Set([...seen, name]));
    }
    const out = {};
    for (const k of Object.keys(node)) out[k] = inlineRefs(node[k], schemas, seen);
    return out;
  }
  return node;
}

function findDiffs(a, b, pathPrefix, diffs) {
  if (a === b) return;
  const aIsObj = a && typeof a === 'object';
  const bIsObj = b && typeof b === 'object';
  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);

  if (!aIsObj || !bIsObj || aIsArr !== bIsArr) {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diffs.push({ path: pathPrefix || '<root>', a, b });
    }
    return;
  }

  if (aIsArr) {
    if (a.length !== b.length || a.some((x, i) => JSON.stringify(x) !== JSON.stringify(b[i]))) {
      diffs.push({ path: pathPrefix || '<root>', a, b });
    }
    return;
  }

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const sub = pathPrefix ? `${pathPrefix}.${k}` : k;
    findDiffs(a[k], b[k], sub, diffs);
  }
}

function locate(latest, fileName) {
  const seg = `${path.sep}api-hub${path.sep}`;
  return latest.find(f => f.endsWith(fileName) && f.includes(seg));
}

function loadResolved(filePath) {
  const doc = YAML.parse(fs.readFileSync(filePath, 'utf8'));
  const schemas = doc?.components?.schemas;
  assert.ok(
    schemas?.[SCHEMA],
    `Missing schema ${SCHEMA} in ${relativeToRepo(filePath)}`
  );
  return inlineRefs(schemas[SCHEMA], schemas);
}

const latest = findLatestSpecs();
const canonicalPath = locate(latest, CANONICAL.file);
const copyPath = locate(latest, COPY.file);

describe('authorization_details (RAR) parity: Consent Manager vs Authorisation Server', () => {
  it(`locates ${CANONICAL.label} :: ${CANONICAL.file}`, () => {
    assert.ok(canonicalPath, `Could not locate latest api-hub ${CANONICAL.file}`);
  });
  it(`locates ${COPY.label} :: ${COPY.file}`, () => {
    assert.ok(copyPath, `Could not locate latest api-hub ${COPY.file}`);
  });

  if (!canonicalPath || !copyPath) return;

  it(`${COPY.label} ${SCHEMA} matches ${CANONICAL.label} ${SCHEMA}`, () => {
    const canonical = loadResolved(canonicalPath);
    const copy = loadResolved(copyPath);

    const diffs = [];
    findDiffs(canonical, copy, '', diffs);

    if (diffs.length === 0) return;

    const detail = diffs.map(d =>
      `  ${d.path}:\n` +
      `    ${CANONICAL.label} = ${JSON.stringify(d.a)}\n` +
      `    ${COPY.label} = ${JSON.stringify(d.b)}`
    ).join('\n');

    assert.fail(
      `${SCHEMA} diverges between ${CANONICAL.label} (${relativeToRepo(canonicalPath)}) ` +
      `and ${COPY.label} (${relativeToRepo(copyPath)}).\n` +
      `The TPP-originated RAR flows TPP -> Hub -> LFI without translation, so both API Hub specs must carry it identically. ` +
      `The Authorisation Server copy is a verbatim copy of the Consent Manager schema sub-tree - update both sides together.\n` +
      `Found ${diffs.length} difference(s):\n${detail}`
    );
  });
});
