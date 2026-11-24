const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { findLatestSpecs, relativeToRepo } = require('../helpers');

// The Bulk and Batch Risk object (`AEBulkBatchPaymentRisk`) carries the risk factors that apply to a Bulk and
// Batch Payment as a whole: the User who submits it, and the batch itself. It originates at the TPP and flows
// TPP → Hub → LFI twice — on the Bulk and Batch consent at `POST /par`, and on the Bulk and Batch Payment request
// at `POST /bulk-payments` — so, like the single-payment Risk (see risk-schema-parity.test.js), it must be
// schema-equivalent everywhere it appears, so a value the TPP sends can be carried through without translation.
//
//   Standards PAR — the Bulk and Batch consent PII on `POST /par`
//     `uae-authorization-endpoints-openapi.yaml` :: AEBulkBatchPaymentRisk
//
//   Standards Bulk Payments — the Bulk and Batch Payment PII on `POST /bulk-payments`
//     `uae-bank-initiation-openapi.yaml` :: AEBulkBatchPaymentRisk
//
//   Hub Consent-Manager — the stored consent PII, and the Bulk and Batch Payment request in the payment log
//     `uae-api-hub-consent-manager-openapi.yaml` :: AEBulkBatchPaymentRisk
//
//   Ozone Connect Consent-Events — the consent PII the LFI receives
//     `uae-ozone-connect-consent-events-actions-openapi.yaml` :: AEBulkBatchPaymentRisk
//
//   Ozone Connect CAAP Operations — the consent PII the LFI receives
//     `uae-ozone-connect-caap-operations-openapi.yaml` :: OzoneConnectConsentEventActionAPIs.AEBulkBatchPaymentRisk
//
//   Ozone Connect Bank-Service-Initiation — the Bulk and Batch Payment PII the Hub forwards to the LFI
//     `uae-ozone-connect-bank-service-initiation-openapi.yaml` :: AEBulkBatchPaymentRisk
//
// Each surface also names the schemas whose `Risk` property must reference it (`slots`), so a slot cannot drift
// back to the single-payment `AERisk`, or to an inline object, without failing this test.

const SURFACES = [
  {
    label: 'Standards PAR (Bulk and Batch consent)',
    category: 'standards',
    file: 'uae-authorization-endpoints-openapi.yaml',
    schema: 'AEBulkBatchPaymentRisk',
    slots: ['AEBankServiceInitiationRichAuthorizationRequests.AEBulkBatchPaymentPII'],
  },
  {
    label: 'Standards Bulk Payments',
    category: 'standards',
    file: 'uae-bank-initiation-openapi.yaml',
    schema: 'AEBulkBatchPaymentRisk',
    slots: ['AEBankServiceInitiation.AEFilePaymentRiskPIIProperties'],
  },
  {
    label: 'Hub Consent-Manager',
    category: 'api-hub',
    file: 'uae-api-hub-consent-manager-openapi.yaml',
    schema: 'AEBulkBatchPaymentRisk',
    slots: [
      'AEBankServiceInitiationRichAuthorizationRequests.AEBulkBatchPaymentPII',
      'AEBankServiceInitiation.AEFilePaymentRiskPIIProperties',
    ],
  },
  {
    label: 'Ozone Connect Consent-Events',
    category: 'ozone-connect',
    file: 'uae-ozone-connect-consent-events-actions-openapi.yaml',
    schema: 'AEBulkBatchPaymentRisk',
    slots: ['AEBankServiceInitiationRichAuthorizationRequests.AEBulkBatchPaymentPII'],
  },
  {
    label: 'Ozone Connect CAAP Operations',
    category: 'ozone-connect',
    file: 'uae-ozone-connect-caap-operations-openapi.yaml',
    schema: 'OzoneConnectConsentEventActionAPIs.AEBulkBatchPaymentRisk',
    slots: ['OzoneConnectConsentEventActionAPIs.AEBulkBatchPaymentPII'],
  },
  {
    label: 'Ozone Connect Bank-Service-Initiation',
    category: 'ozone-connect',
    file: 'uae-ozone-connect-bank-service-initiation-openapi.yaml',
    schema: 'AEBulkBatchPaymentRisk',
    slots: ['AEBankServiceInitiation.AEFilePaymentRiskPIIProperties'],
  },
];

// Stripped before comparison — these affect documentation only.
const NON_SEMANTIC_KEYS = new Set(['description', 'example', 'examples']);

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

function stripNonSemantic(node) {
  if (Array.isArray(node)) return node.map(stripNonSemantic);
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) {
      if (NON_SEMANTIC_KEYS.has(k)) continue;
      out[k] = stripNonSemantic(node[k]);
    }
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
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ path: pathPrefix || '<root>', a, b });
    return;
  }
  if (aIsArr) {
    if (a.length !== b.length || a.some((x, i) => JSON.stringify(x) !== JSON.stringify(b[i]))) {
      diffs.push({ path: pathPrefix || '<root>', a, b });
    }
    return;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    findDiffs(a[k], b[k], pathPrefix ? `${pathPrefix}.${k}` : k, diffs);
  }
}

function findLatestFile(latest, category, fileName) {
  const seg = `${path.sep}${category}${path.sep}`;
  return latest.find(f => f.endsWith(fileName) && f.includes(seg));
}

function loadSchemas(surface) {
  return YAML.parse(fs.readFileSync(surface.filePath, 'utf8'))?.components?.schemas || {};
}

function loadResolvedRisk(surface) {
  const schemas = loadSchemas(surface);
  assert.ok(schemas[surface.schema], `Missing schema ${surface.schema} in ${relativeToRepo(surface.filePath)}`);
  return stripNonSemantic(inlineRefs(schemas[surface.schema], schemas));
}

const latest = findLatestSpecs();
const surfaces = SURFACES.map(s => ({ ...s, filePath: findLatestFile(latest, s.category, s.file) }));

describe('Bulk and Batch Risk schema parity across PAR / Bulk Payments / Hub / Ozone Connect', () => {
  for (const s of surfaces) {
    it(`locates ${s.label} :: ${s.file}`, () => {
      assert.ok(s.filePath, `Could not locate latest ${s.category} ${s.file}`);
    });
  }

  if (surfaces.some(s => !s.filePath)) return;

  for (const s of surfaces) {
    for (const slot of s.slots) {
      it(`${s.label}: ${slot}.Risk references ${s.schema}`, () => {
        const schemas = loadSchemas(s);
        const risk = schemas[slot]?.properties?.Risk;
        assert.ok(risk, `Missing ${slot}.properties.Risk in ${relativeToRepo(s.filePath)}`);
        assert.strictEqual(
          risk.$ref,
          `${SCHEMAS_PREFIX}${s.schema}`,
          `${slot}.Risk in ${relativeToRepo(s.filePath)} must be a $ref to ${s.schema}, so the Bulk and Batch Risk ` +
          `is defined once per spec and covered by the parity check below.`
        );
      });
    }
  }

  // Standards PAR is the canonical Bulk and Batch Risk shape — it sits at the start of the TPP → Hub → LFI
  // chain. Every other surface must match it field-for-field.
  const canonical = surfaces[0];

  for (let i = 1; i < surfaces.length; i++) {
    const other = surfaces[i];
    it(`${other.label} matches ${canonical.label}`, () => {
      const diffs = [];
      findDiffs(loadResolvedRisk(canonical), loadResolvedRisk(other), '', diffs);
      if (diffs.length === 0) return;

      const detail = diffs.map(d =>
        `  ${d.path}:\n` +
        `    ${canonical.label} = ${JSON.stringify(d.a)}\n` +
        `    ${other.label} = ${JSON.stringify(d.b)}`
      ).join('\n');

      assert.fail(
        `Bulk and Batch Risk schema diverges between ${canonical.label} ` +
        `(${relativeToRepo(canonical.filePath)} :: ${canonical.schema}) and ${other.label} ` +
        `(${relativeToRepo(other.filePath)} :: ${other.schema}).\n` +
        `The TPP-originated Bulk and Batch Risk must flow TPP → Hub → LFI without translation, so every surface ` +
        `that carries it must agree field-for-field.\nFound ${diffs.length} difference(s):\n${detail}`
      );
    });
  }
});
