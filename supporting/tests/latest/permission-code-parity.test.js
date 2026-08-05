const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { distDir, parseVersion, compareVersions, relativeToRepo, findLatestSpecs } = require('../helpers');

// Permission codes originate in the Standards specs, are staged by the api-hub
// Consent Manager, and are forwarded unchanged to LFIs over Ozone Connect. Every
// spec on that path must be able to carry every code, or a consent that is valid
// at one hop fails validation at the next.
//
// Two rules are enforced per permission family:
//
//   1. Superset — each Hub-side enum carries every code that any still-supported
//      Standards version defines. The Hub is backward compatible: a consent
//      staged under an older Standards version is read back through it, so the
//      union across versions is the requirement, not just the latest version.
//      Extra codes the Standards never defined (e.g. `ReadConsents`) are allowed
//      — a superset does not break backward compatibility, only missing codes do.
//
//   2. Consistency — the Hub-side enums for one family are identical to each
//      other. The Consent Manager accepts the consent and the Consent Events and
//      Actions / CAAP Operations APIs deliver it; if they disagree, the Hub
//      accepts something it cannot forward. That is what the original
//      `ReadStatements` / `ReadProductFinanceRates` gap looked like — the codes
//      were added to the Consent Manager but not to the Ozone Connect side.

// Where each permission family's enum lives, per Standards base version
// (`vMAJOR.MINOR`) and per Hub-side consumer. Schema names changed at v2.1, so
// nothing here can be discovered by a fixed name.
//
// A `standards` entry may be `null` to record that the family did not exist in
// that Standards line. That is deliberate: the "every Standards version is
// accounted for" test below fails when a new Standards line appears and no
// decision has been recorded for it.
//
// `neverUsed` lists codes a Standards version defined but that were never used
// in production, so the Hub is not required to carry them. Removing an entry
// re-enables the requirement.
const FAMILIES = [
  {
    name: 'Bank Data Sharing',
    standards: {
      'v1.2': { file: 'uae-authorization-endpoints-openapi.yaml', schema: 'AEConsentPermissions' },
      'v2.0': { file: 'uae-authorization-endpoints-openapi.yaml', schema: 'AEConsentPermissions' },
      'v2.1': {
        file: 'uae-authorization-endpoints-openapi.yaml',
        schema: 'AEBankDataSharingRichAuthorizationRequests.AEBankDataSharingConsentPermissionCodes',
      },
    },
    consumers: [
      {
        category: 'api-hub',
        file: 'uae-api-hub-consent-manager-openapi.yaml',
        schema: 'AEAccountAccessConsentPermissionCodes',
      },
      {
        category: 'ozone-connect',
        file: 'uae-ozone-connect-consent-events-actions-openapi.yaml',
        schema: 'AEAccountAccessConsentPermissionCodes',
      },
      {
        category: 'ozone-connect',
        file: 'uae-ozone-connect-caap-operations-openapi.yaml',
        schema: 'OzoneConnectConsentEventActionAPIs.AEAccountAccessConsentPermissionCodes',
      },
    ],
    neverUsed: {
      ReadFXRemittanceCharges: 'defined in v2.0 and v2.1, never used',
      ReadProductLendingRates: 'defined in v2.0 only (renamed to ReadProductFinanceRates at v2.1), never used',
    },
  },
  {
    name: 'Bank Service Initiation',
    standards: {
      'v1.2': { file: 'uae-authorization-endpoints-openapi.yaml', schema: 'AEPaymentConsentPermissions' },
      'v2.0': { file: 'uae-authorization-endpoints-openapi.yaml', schema: 'AEPaymentConsentPermissions' },
      'v2.1': {
        file: 'uae-authorization-endpoints-openapi.yaml',
        schema: 'AEBankServiceInitiationRichAuthorizationRequests.AEBankServiceInitiationConsentPermissionCodes',
      },
    },
    consumers: [
      {
        category: 'api-hub',
        file: 'uae-api-hub-consent-manager-openapi.yaml',
        schema: 'AEServiceInitiationConsentPermissionCodes',
      },
      {
        category: 'api-hub',
        file: 'uae-api-hub-consent-manager-openapi.yaml',
        schema: 'AEConsentPermissions',
      },
      {
        category: 'ozone-connect',
        file: 'uae-ozone-connect-consent-events-actions-openapi.yaml',
        schema: 'AEServiceInitiationConsentPermissionCodes',
      },
      {
        category: 'ozone-connect',
        file: 'uae-ozone-connect-consent-events-actions-openapi.yaml',
        schema: 'AEConsentPermissions',
      },
      {
        category: 'ozone-connect',
        file: 'uae-ozone-connect-caap-operations-openapi.yaml',
        schema: 'OzoneConnectConsentEventActionAPIs.AEServiceInitiationConsentPermissionCodes',
      },
      {
        category: 'ozone-connect',
        file: 'uae-ozone-connect-caap-operations-openapi.yaml',
        schema: 'OzoneConnectConsentEventActionAPIs.AEConsentPermissions',
      },
    ],
    neverUsed: {},
  },
  {
    name: 'Insurance Data Sharing',
    standards: {
      // Insurance was introduced at v2.0; there is no v1.2 equivalent.
      'v1.2': null,
      'v2.0': { file: 'uae-insurance-openapi.yaml', schema: 'AEConsentPermissionCodes' },
      'v2.1': { file: 'uae-authorization-endpoints-openapi.yaml', schema: 'AEInsurance.AEConsentPermissionCodes' },
    },
    consumers: [
      {
        category: 'api-hub',
        file: 'uae-api-hub-consent-manager-openapi.yaml',
        schema: 'AEInsuranceConsentPermissionCodes',
      },
      {
        category: 'ozone-connect',
        file: 'uae-ozone-connect-consent-events-actions-openapi.yaml',
        schema: 'AEInsuranceConsentPermissionCodes',
      },
      {
        category: 'ozone-connect',
        file: 'uae-ozone-connect-caap-operations-openapi.yaml',
        schema: 'OzoneConnectConsentEventActionAPIs.AEInsuranceConsentPermissionCodes',
      },
    ],
    neverUsed: {},
  },
];

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

const docCache = new Map();
function loadDoc(filePath) {
  if (!docCache.has(filePath)) {
    docCache.set(filePath, YAML.parse(fs.readFileSync(filePath, 'utf8')));
  }
  return docCache.get(filePath);
}

function loadEnum(filePath, schemaName) {
  if (!fs.existsSync(filePath)) return { error: `file not found: ${relativeToRepo(filePath)}` };
  const schema = loadDoc(filePath)?.components?.schemas?.[schemaName];
  if (!schema) return { error: `schema ${schemaName} not found in ${relativeToRepo(filePath)}` };
  const values = extractEnum(schema);
  if (!values) return { error: `schema ${schemaName} in ${relativeToRepo(filePath)} has no enum` };
  return { values };
}

const standardsByBase = latestErrataByBase('standards');
const latestSpecs = findLatestSpecs();

function findLatestSpec(category, file) {
  const marker = `${path.sep}${category}${path.sep}`;
  return latestSpecs.find(f => f.endsWith(`${path.sep}${file}`) && f.includes(marker));
}

// Resolve every family up front so each `it` is a cheap assertion on the result.
const resolved = FAMILIES.map(family => {
  // codeOrigins: permission code -> Standards base versions that define it.
  const codeOrigins = {};
  const standards = {};
  for (const [base, src] of Object.entries(family.standards)) {
    if (!src) continue;
    const info = standardsByBase[base];
    if (!info) continue; // a missing folder is reported by its own test below
    const result = loadEnum(path.join(info.dir, src.file), src.schema);
    standards[base] = { src, ...result };
    for (const code of result.values || []) {
      (codeOrigins[code] ??= new Set()).add(base);
    }
  }

  const consumers = family.consumers.map(consumer => {
    const filePath = findLatestSpec(consumer.category, consumer.file);
    const label = `${consumer.category}/${consumer.file} :: ${consumer.schema}`;
    if (!filePath) return { consumer, label, error: `could not locate latest ${consumer.category} ${consumer.file}` };
    return { consumer, label, filePath, ...loadEnum(filePath, consumer.schema) };
  });

  return { family, codeOrigins, standards, consumers };
});

describe('Permission code parity across Standards, Consent Manager and Ozone Connect', () => {
  it('every Standards version is accounted for by every permission family', () => {
    const problems = [];
    for (const base of Object.keys(standardsByBase)) {
      for (const family of FAMILIES) {
        if (!(base in family.standards)) {
          problems.push(`${family.name}: Standards ${base} has no entry`);
        }
      }
    }
    assert.deepStrictEqual(
      problems, [],
      `A Standards version exists in dist/standards that a permission family does not account for:\n` +
      problems.map(p => `  - ${p}`).join('\n') + '\n' +
      `Add the permission schema location for that version, or \`null\` if the family did not exist yet.`
    );
  });

  for (const { family, codeOrigins, standards, consumers } of resolved) {
    describe(family.name, () => {
      for (const [base, src] of Object.entries(family.standards)) {
        if (!src) continue;
        it(`locates the ${base} Standards permission enum`, () => {
          assert.ok(standardsByBase[base], `No dist/standards folder found for base version ${base}`);
          const e = standards[base];
          assert.ok(e && !e.error, `${base}: ${e?.error} (${src.file} :: ${src.schema})`);
          assert.ok(e.values.length > 0, `${base}: ${src.schema} enum is empty`);
        });
      }

      for (const c of consumers) {
        it(`locates ${c.label}`, () => {
          assert.ok(!c.error, c.error);
        });
      }

      it('never-used allowlist entries still exist in the Standards union', () => {
        const stale = Object.keys(family.neverUsed).filter(code => !codeOrigins[code]);
        assert.deepStrictEqual(
          stale, [],
          `${family.name}: neverUsed lists ${stale.join(', ')}, which no longer appear in any ` +
          `Standards version. Remove the stale allowlist entr${stale.length === 1 ? 'y' : 'ies'}.`
        );
      });

      it('every Hub-side enum carries every Standards permission code', () => {
        const loaded = consumers.filter(c => !c.error);
        assert.strictEqual(loaded.length, consumers.length, 'Some enums could not be loaded — see earlier tests');

        const required = Object.keys(codeOrigins).filter(code => !(code in family.neverUsed));
        const failures = [];
        for (const c of loaded) {
          const present = new Set(c.values);
          const missing = required.filter(code => !present.has(code)).sort();
          if (missing.length === 0) continue;
          const detail = missing
            .map(code => `      - ${code}  (defined in Standards ${[...codeOrigins[code]].sort().join(', ')})`)
            .join('\n');
          failures.push(`  ${relativeToRepo(c.filePath)} :: ${c.consumer.schema}\n${detail}`);
        }

        if (failures.length === 0) return;

        assert.fail(
          `${family.name}: Hub-side permission enum(s) are missing codes that the Standards specs define.\n` +
          `The Hub is backward compatible and forwards consents unchanged to LFIs, so every spec on that ` +
          `path must accept every permission code from all supported Standards versions.\n` +
          `${failures.join('\n')}\n` +
          `Add the code(s) to the enum, or — if a code was genuinely never used in production — add it to ` +
          `\`neverUsed\` for this family in this test with a justifying comment.`
        );
      });

      it('all Hub-side enums agree with each other', () => {
        const loaded = consumers.filter(c => !c.error);
        assert.strictEqual(loaded.length, consumers.length, 'Some enums could not be loaded — see earlier tests');

        const [reference, ...rest] = loaded;
        const referenceCodes = new Set(reference.values);
        const failures = [];
        for (const c of rest) {
          const codes = new Set(c.values);
          const missing = [...referenceCodes].filter(code => !codes.has(code)).sort();
          const extra = [...codes].filter(code => !referenceCodes.has(code)).sort();
          if (missing.length === 0 && extra.length === 0) continue;
          const lines = [];
          if (missing.length) lines.push(`      missing: ${missing.join(', ')}`);
          if (extra.length) lines.push(`      extra:   ${extra.join(', ')}`);
          failures.push(`  ${relativeToRepo(c.filePath)} :: ${c.consumer.schema}\n${lines.join('\n')}`);
        }

        if (failures.length === 0) return;

        assert.fail(
          `${family.name}: Hub-side permission enums disagree.\n` +
          `Compared against ${relativeToRepo(reference.filePath)} :: ${reference.consumer.schema} ` +
          `(${[...referenceCodes].sort().join(', ')}).\n` +
          `${failures.join('\n')}\n` +
          `A consent the Consent Manager accepts must be forwardable over Ozone Connect, so these enums ` +
          `must hold the same set of codes. Update whichever side is wrong.`
        );
      });
    });
  }
});
