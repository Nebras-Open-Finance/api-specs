const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { distDir, parseVersion, compareVersions, relativeToRepo, findLatestSpecs } = require('../helpers');

// The api-hub Consent Manager is backward compatible: a consent staged under
// any still-supported Standards version is read back through it. It must
// therefore accept every Bank Data Sharing permission code that any Standards
// version can carry — the union across all versions, not just the latest.
//
// This test rebuilds that union from the Standards specs and asserts the
// Consent Manager's `AEAccountAccessConsentPermissionCodes` enum is a superset
// of it. A code added to Standards but not propagated to the Consent Manager
// (the `ReadStatements` / `ReadProductFinanceRates` gap this test was written
// for) fails the build.
//
// Direction is one-way on purpose: the Consent Manager is allowed to carry
// extra codes Standards never defined (e.g. `ReadConsents`) — a superset does
// not break backward compatibility. Only *missing* codes do.

// Where the Bank Data Sharing permission enum lives in each Standards line,
// keyed by base version (`vMAJOR.MINOR`). The schema name changed at v2.1, so
// it can't be discovered by a fixed name. When a new Standards line is added,
// the "every Standards version is registered" test below fails until a new
// entry is added here.
const STANDARDS_SOURCES = {
  'v1.2': { file: 'uae-authorization-endpoints-openapi.yaml', schema: 'AEConsentPermissions' },
  'v2.0': { file: 'uae-authorization-endpoints-openapi.yaml', schema: 'AEConsentPermissions' },
  'v2.1': {
    file: 'uae-authorization-endpoints-openapi.yaml',
    schema: 'AEBankDataSharingRichAuthorizationRequests.AEBankDataSharingConsentPermissionCodes',
  },
};

const HUB_FILE = 'uae-api-hub-consent-manager-openapi.yaml';
const HUB_SCHEMA = 'AEAccountAccessConsentPermissionCodes';

// Codes that were defined in a Standards version but never used in production.
// The Consent Manager is not required to carry them, so they're excluded from
// the parity check. Removing an entry here re-enables the requirement.
//
//   ReadFXRemittanceCharges  — defined in v2.0 and v2.1, never used.
//   ReadProductLendingRates  — defined in v2.0 only (renamed to
//                              ReadProductFinanceRates at v2.1), never used.
const NEVER_USED_IN_PRODUCTION = new Set(['ReadFXRemittanceCharges', 'ReadProductLendingRates']);

// Latest errata folder for each base version under dist/<category>/.
function latestErrataByBase(category) {
  const categoryDir = path.join(distDir, category);
  const byBase = {};
  for (const entry of fs.readdirSync(categoryDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const parsed = parseVersion(entry.name);
    if (!parsed) continue;
    const base = `v${parsed.major}.${parsed.minor}`;
    if (!byBase[base] || compareVersions(parsed, byBase[base].parsed) > 0) {
      byBase[base] = { parsed, dir: path.join(categoryDir, entry.name) };
    }
  }
  return byBase;
}

// The permission enum may be modelled either as a string schema with an
// `enum`, or as an array schema whose `items` carry the `enum`.
function extractEnum(schema) {
  if (schema && Array.isArray(schema.enum)) return schema.enum;
  if (schema && schema.items && Array.isArray(schema.items.enum)) return schema.items.enum;
  return null;
}

function loadEnum(filePath, schemaName) {
  if (!fs.existsSync(filePath)) return { error: `file not found: ${filePath}` };
  const doc = YAML.parse(fs.readFileSync(filePath, 'utf8'));
  const schema = doc?.components?.schemas?.[schemaName];
  if (!schema) return { error: `schema ${schemaName} not found` };
  const values = extractEnum(schema);
  if (!values) return { error: `schema ${schemaName} has no enum` };
  return { values };
}

const standardsByBase = latestErrataByBase('standards');

// codeOrigins: permission code -> set of Standards base versions that define it.
const standardsEnums = {};
const codeOrigins = {};
for (const [base, src] of Object.entries(STANDARDS_SOURCES)) {
  const info = standardsByBase[base];
  if (!info) continue; // missing folder is caught by its own test below
  const filePath = path.join(info.dir, src.file);
  const result = loadEnum(filePath, src.schema);
  standardsEnums[base] = { filePath, schema: src.schema, ...result };
  for (const code of result.values || []) {
    (codeOrigins[code] ??= new Set()).add(base);
  }
}

const latest = findLatestSpecs();
const hubFilePath = latest.find(f => f.endsWith(HUB_FILE) && f.includes(`${path.sep}api-hub${path.sep}`));
const hubEnum = hubFilePath ? loadEnum(hubFilePath, HUB_SCHEMA) : { error: `latest ${HUB_FILE} not found` };

describe('Consent Manager Bank Data Sharing permission parity', () => {
  it('every Standards version is registered as a permission source', () => {
    const unregistered = Object.keys(standardsByBase).filter(b => !STANDARDS_SOURCES[b]);
    assert.deepStrictEqual(
      unregistered, [],
      `Standards version(s) ${unregistered.join(', ')} have no entry in STANDARDS_SOURCES. ` +
      `Add the Bank Data Sharing permission schema location for each so this parity check covers it.`
    );
  });

  for (const [base, src] of Object.entries(STANDARDS_SOURCES)) {
    it(`locates the ${base} Standards Bank Data Sharing permission enum`, () => {
      assert.ok(standardsByBase[base], `No dist/standards folder found for base version ${base}`);
      const e = standardsEnums[base];
      assert.ok(e && !e.error, `${base}: ${e?.error} (${src.file} :: ${src.schema})`);
      assert.ok(e.values.length > 0, `${base}: ${src.schema} enum is empty`);
    });
  }

  it(`locates the Consent Manager ${HUB_SCHEMA} enum`, () => {
    assert.ok(hubFilePath, `Could not locate latest api-hub ${HUB_FILE}`);
    assert.ok(!hubEnum.error, `${hubEnum.error} (${relativeToRepo(hubFilePath)})`);
  });

  it('never-used allowlist entries still exist in the Standards union', () => {
    const stale = [...NEVER_USED_IN_PRODUCTION].filter(c => !codeOrigins[c]);
    assert.deepStrictEqual(
      stale, [],
      `NEVER_USED_IN_PRODUCTION lists ${stale.join(', ')}, which no longer appear in any ` +
      `Standards version. Remove the stale allowlist entr${stale.length === 1 ? 'y' : 'ies'}.`
    );
  });

  it('Consent Manager carries every Standards Bank Data Sharing permission', () => {
    assert.ok(hubFilePath && !hubEnum.error, 'Consent Manager enum could not be loaded — see earlier test');

    const hubCodes = new Set(hubEnum.values);
    const missing = Object.keys(codeOrigins)
      .filter(code => !NEVER_USED_IN_PRODUCTION.has(code) && !hubCodes.has(code))
      .sort();

    if (missing.length === 0) return;

    const detail = missing
      .map(code => `  - ${code}  (defined in Standards ${[...codeOrigins[code]].sort().join(', ')})`)
      .join('\n');

    assert.fail(
      `The Consent Manager (${relativeToRepo(hubFilePath)} :: ${HUB_SCHEMA}) is missing ` +
      `${missing.length} Bank Data Sharing permission code(s) that the Standards specs define.\n` +
      `The Consent Manager is backward compatible and must accept every permission code from ` +
      `all supported Standards versions.\n` +
      `Missing:\n${detail}\n` +
      `Add the code(s) to ${HUB_SCHEMA}, or — if a code was genuinely never used in production — ` +
      `add it to NEVER_USED_IN_PRODUCTION in this test with a justifying comment.`
    );
  });
});
