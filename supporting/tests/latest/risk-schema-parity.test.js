const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { findLatestSpecs, relativeToRepo } = require('../helpers');

// The `Risk` object originates at the TPP and flows TPP → Hub → LFI through
// the payment journey. It surfaces in seven places across all three
// categories; the same logical Risk must be schema-equivalent everywhere,
// so a value the TPP sends can be carried through without translation.
//
// Each Hub/Ozone-Connect spec carries the Risk under two parallel schema
// names — one in the `AEBankServiceInitiationRichAuthorizationRequests.*`
// namespace (consent / RAR-shape payloads) and one as bare `AERisk`
// (payment-initiation-shape payloads). Both describe the same logical Risk.
//
//   Standards PAR — TPP-facing `POST /par` request body
//     `uae-authorization-endpoints-openapi.yaml`
//     :: AEBankServiceInitiationRichAuthorizationRequests.AERisk
//
//   Standards Payments — TPP-facing `POST /payments` request body
//     `uae-bank-initiation-openapi.yaml`
//     :: AERisk
//
//   Hub Consent-Manager — RAR-shape consent payload (LFI reads back the
//   stored RAR-derived consent)
//     `uae-api-hub-consent-manager-openapi.yaml`
//     :: AEBankServiceInitiationRichAuthorizationRequests.AERisk
//
//   Hub Consent-Manager — payment-initiation-shape payload
//     `uae-api-hub-consent-manager-openapi.yaml`
//     :: AERisk
//
//   Ozone Connect Consent-Events — RAR-shape consent action payload
//     `uae-ozone-connect-consent-events-actions-openapi.yaml`
//     :: AEBankServiceInitiationRichAuthorizationRequests.AERisk
//
//   Ozone Connect Consent-Events — payment-initiation-shape payload
//     `uae-ozone-connect-consent-events-actions-openapi.yaml`
//     :: AERisk
//
//   Ozone Connect Bank-Service-Initiation — payment-initiation Risk the Hub
//   forwards to the LFI
//     `uae-ozone-connect-bank-service-initiation-openapi.yaml`
//     :: AERisk

const SURFACES = [
  {
    label: 'Standards PAR (RAR shape)',
    category: 'standards',
    file: 'uae-authorization-endpoints-openapi.yaml',
    schema: 'AEBankServiceInitiationRichAuthorizationRequests.AERisk',
  },
  {
    label: 'Standards Payments',
    category: 'standards',
    file: 'uae-bank-initiation-openapi.yaml',
    schema: 'AERisk',
  },
  {
    label: 'Hub Consent-Manager (RAR shape)',
    category: 'api-hub',
    file: 'uae-api-hub-consent-manager-openapi.yaml',
    schema: 'AEBankServiceInitiationRichAuthorizationRequests.AERisk',
  },
  {
    label: 'Hub Consent-Manager (payment-init shape)',
    category: 'api-hub',
    file: 'uae-api-hub-consent-manager-openapi.yaml',
    schema: 'AERisk',
  },
  {
    label: 'Ozone Connect Consent-Events (RAR shape)',
    category: 'ozone-connect',
    file: 'uae-ozone-connect-consent-events-actions-openapi.yaml',
    schema: 'AEBankServiceInitiationRichAuthorizationRequests.AERisk',
  },
  {
    label: 'Ozone Connect Consent-Events (payment-init shape)',
    category: 'ozone-connect',
    file: 'uae-ozone-connect-consent-events-actions-openapi.yaml',
    schema: 'AERisk',
  },
  {
    label: 'Ozone Connect Bank-Service-Initiation',
    category: 'ozone-connect',
    file: 'uae-ozone-connect-bank-service-initiation-openapi.yaml',
    schema: 'AERisk',
  },
];

// Stripped before comparison — these affect documentation only.
const NON_SEMANTIC_KEYS = new Set(['description', 'example', 'examples']);

// Stripped before comparison — these property names are intentionally allowed
// to vary across surfaces. They're either adjacent to (not part of) the Risk
// contract, or they resolve to a schema whose shape is deliberately broader
// on some surfaces than on Standards.
//
//   ConfirmationOfPayeeResponse — Hub Consent-Manager and Ozone Connect
//     Consent-Events nest a copy inside `AECreditorIndicators`. The canonical
//     placement (on `AEDomesticCreditor` / equivalent, outside Risk) is
//     correct everywhere; the in-Risk copy is a Hub/OC-side risk-scoring
//     convenience and should not block parity.
//
//   NationalAddress — resolves to `AEAddress`, which on Hub + OC consent-events
//     is intentionally an `anyOf` accepting both the deprecated v1.2 compact
//     address format and the v2.0+ Standards format (variant 2 is identical
//     to the Standards `AEAddress`). Standards documents only the modern
//     shape; the Hub is a backward-compatible superset by design. Comparing
//     the sub-tree here would flag that superset as a divergence.
const FIELD_NAMES_TO_IGNORE = new Set(['ConfirmationOfPayeeResponse', 'NationalAddress']);

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

function stripNonSemantic(node, parentKey) {
  if (Array.isArray(node)) return node.map(item => stripNonSemantic(item, parentKey));
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) {
      if (NON_SEMANTIC_KEYS.has(k)) continue;
      // Drop intentionally-allowed-to-vary fields when they appear as
      // properties of a schema object (i.e. directly under a `properties:`
      // map). Don't drop them as random keys elsewhere.
      if (parentKey === 'properties' && FIELD_NAMES_TO_IGNORE.has(k)) continue;
      out[k] = stripNonSemantic(node[k], k);
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

function findLatestFile(latest, category, fileName) {
  const seg = `${path.sep}${category}${path.sep}`;
  return latest.find(f => f.endsWith(fileName) && f.includes(seg));
}

function loadResolvedRisk(surface) {
  const doc = YAML.parse(fs.readFileSync(surface.filePath, 'utf8'));
  const schemas = doc?.components?.schemas;
  assert.ok(
    schemas?.[surface.schema],
    `Missing schema ${surface.schema} in ${relativeToRepo(surface.filePath)}`
  );
  return stripNonSemantic(inlineRefs(schemas[surface.schema], schemas));
}

const latest = findLatestSpecs();
const surfaces = SURFACES.map(s => ({ ...s, filePath: findLatestFile(latest, s.category, s.file) }));

describe('Risk schema parity across PAR / Payments / Hub / Ozone Connect', () => {
  for (const s of surfaces) {
    it(`locates ${s.label} :: ${s.file}`, () => {
      assert.ok(s.filePath, `Could not locate latest ${s.category} ${s.file}`);
    });
  }

  if (surfaces.some(s => !s.filePath)) return;

  // Standards PAR is the canonical Risk shape — it sits at the start of the
  // TPP → Hub → LFI chain. Every other surface must match it field-for-field.
  const canonical = surfaces[0];

  for (let i = 1; i < surfaces.length; i++) {
    const other = surfaces[i];
    it(`${other.label} matches ${canonical.label}`, () => {
      const canonicalRisk = loadResolvedRisk(canonical);
      const otherRisk = loadResolvedRisk(other);

      const diffs = [];
      findDiffs(canonicalRisk, otherRisk, '', diffs);

      if (diffs.length === 0) return;

      const detail = diffs.map(d =>
        `  ${d.path}:\n` +
        `    ${canonical.label}                = ${JSON.stringify(d.a)}\n` +
        `    ${other.label} = ${JSON.stringify(d.b)}`
      ).join('\n');

      assert.fail(
        `Risk schema diverges between ${canonical.label} (${relativeToRepo(canonical.filePath)} :: ${canonical.schema}) ` +
        `and ${other.label} (${relativeToRepo(other.filePath)} :: ${other.schema}).\n` +
        `The TPP-originated Risk must flow TPP → Hub → LFI without translation, so every surface that carries it must agree field-for-field.\n` +
        `Found ${diffs.length} difference(s):\n${detail}`
      );
    });
  }
});
