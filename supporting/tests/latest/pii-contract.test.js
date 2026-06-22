const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const {
  distDir, repoRoot, findLatestSpecs, parseVersion, compareVersions, relativeToRepo,
} = require('../helpers');

// The `PersonalIdentifiableInformation` (PII) payload is shared, end-to-end, across the
// payment/consent specs: a TPP posts it, the Hub stores and forwards it, and the LFI
// receives it. Because the decoded contract is the same data in every spec, and the
// scenario (domestic vs international) — not the endpoint — dictates which `oneOf`/`anyOf`
// variant applies, this test guards the PII contract specifically:
//
//   Part 1: the decoded PII schema tree must not diverge between specs. The same schema
//           must have the same shape everywhere it appears.
//   Part 2: a breaking change to the decoded PII contract between two within-major
//           versions (e.g. v2.1 -> v2.1-errata2, or v2.1 -> v2.2) must carry a signed-off
//           breaking-changes record.
//
// The decoded contract is compared with the encoded `AEJWEPaymentPII` escape-hatch branch
// removed: at the full-spec level any value satisfies the schema via the encoded string,
// which masks tightening of the decoded Domestic/International objects. Stripping it makes
// the decoded contract the thing under test.

// Keys that don't affect the wire contract.
const NON_SEMANTIC_KEYS = new Set(['description', 'example', 'examples']);
// Risk is part of the PII envelope but is governed by its own Risk-parity test; exclude its
// subtree here so the two tests don't overlap.
const EXCLUDED_REF = /Risk/;

function canonicalize(node) {
  if (Array.isArray(node)) return node.map(canonicalize);
  if (node && typeof node === 'object') {
    const out = {};
    for (const key of Object.keys(node).sort()) {
      if (NON_SEMANTIC_KEYS.has(key)) continue;
      out[key] = canonicalize(node[key]);
    }
    return out;
  }
  return node;
}

function localRefName(ref) {
  const prefix = '#/components/schemas/';
  return typeof ref === 'string' && ref.startsWith(prefix) ? ref.slice(prefix.length) : null;
}

function collectRefs(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach(n => collectRefs(n, out));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      const name = key === '$ref' ? localRefName(value) : null;
      if (name) out.push(name);
      else collectRefs(value, out);
    }
  }
  return out;
}

// Schemas owned by the PII/creditor contract: everything reachable from a `*PaymentPII*` root
// (the decoded Domestic/International envelopes), minus
//   * the Risk subtree (its own parity test governs it), and
//   * broadly-shared infrastructure — schemas also referenced from outside the PII tree, such
//     as `AEAddress`/`AEName`. The Hub specs deliberately make some of those permissive (an
//     `anyOf` union to accept multiple standards versions), so their alignment is governed
//     independently. The PII envelopes themselves are always kept even though request wrappers
//     reference them.
function piiContractSchemas(schemas) {
  const closure = new Set();
  const stack = Object.keys(schemas).filter(n => /PaymentPII/.test(n));
  while (stack.length) {
    const name = stack.pop();
    if (closure.has(name) || EXCLUDED_REF.test(name) || !(name in schemas)) continue;
    closure.add(name);
    for (const ref of collectRefs(schemas[name])) {
      if (!EXCLUDED_REF.test(ref)) stack.push(ref);
    }
  }

  const externalRefs = new Set();
  for (const [name, def] of Object.entries(schemas)) {
    if (closure.has(name)) continue;
    for (const ref of collectRefs(def)) externalRefs.add(ref);
  }

  return [...closure].filter(name => /PaymentPII/.test(name) || !externalRefs.has(name));
}

function loadDoc(filePath) {
  try {
    return YAML.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Part 1 — the decoded PII contract must not diverge between specs.
// ---------------------------------------------------------------------------
describe('PII contract alignment across specs', () => {
  const byName = new Map(); // schemaName -> Map<canonicalHash, specRelPath[]>

  for (const specPath of findLatestSpecs()) {
    const doc = loadDoc(specPath);
    const schemas = doc?.components?.schemas;
    if (!schemas) continue;
    const rel = relativeToRepo(specPath);
    for (const name of piiContractSchemas(schemas)) {
      const hash = JSON.stringify(canonicalize(schemas[name]));
      if (!byName.has(name)) byName.set(name, new Map());
      const shapes = byName.get(name);
      if (!shapes.has(hash)) shapes.set(hash, []);
      shapes.get(hash).push(rel);
    }
  }

  it('every shared PII schema has a single shape across all specs', () => {
    const divergent = [...byName.entries()].filter(([, shapes]) => shapes.size > 1);
    const report = divergent
      .map(([name, shapes]) => {
        const groups = [...shapes.values()]
          .map((specs, i) => `      shape ${i + 1}: ${specs.join(', ')}`)
          .join('\n');
        return `  ${name}:\n${groups}`;
      })
      .join('\n');
    assert.equal(
      divergent.length,
      0,
      `Found ${divergent.length} PII schema(s) that differ between specs — the decoded PII ` +
      `contract must be identical everywhere it appears:\n${report}`
    );
  });
});

// ---------------------------------------------------------------------------
// Part 2 — breaking changes to the decoded PII between within-major versions
// must be recorded.
// ---------------------------------------------------------------------------
const acceptedChangesRoot = path.join(repoRoot, 'supporting', 'breaking-changes');

function oasdiffAvailable() {
  return spawnSync('oasdiff', ['--version'], { encoding: 'utf8' }).status === 0;
}

// Remove the encoded `*JWE*` escape-hatch branch from every PersonalIdentifiableInformation
// `anyOf`, leaving the decoded Domestic/International branches. Returns how many were stripped.
function stripEncodedPii(node, count = { n: 0 }) {
  if (Array.isArray(node)) {
    node.forEach(n => stripEncodedPii(n, count));
  } else if (node && typeof node === 'object') {
    const pii = node.PersonalIdentifiableInformation;
    if (pii && Array.isArray(pii.anyOf)) {
      const decoded = pii.anyOf.filter(b => !(b && b.$ref && /JWE/.test(b.$ref)));
      if (decoded.length && decoded.length < pii.anyOf.length) {
        pii.anyOf = decoded;
        count.n += 1;
      }
    }
    for (const key of Object.keys(node)) stripEncodedPii(node[key], count);
  }
  return count.n;
}

function hasStrippableDecodedPii(doc) {
  return stripEncodedPii(structuredClone(doc)) > 0;
}

function writeStripped(doc, label) {
  const copy = structuredClone(doc);
  stripEncodedPii(copy);
  const file = path.join(os.tmpdir(), `pii-${label}-${process.pid}.yaml`);
  fs.writeFileSync(file, YAML.stringify(copy));
  return file;
}

function parseErrorLine(line) {
  const match = line.match(/in API (\S+) (\S+) .* \[([a-z-]+)\]/);
  if (!match) return null;
  return { method: match[1], path: match[2], rule: match[3] };
}

function loadAcceptedChanges(category, revisionDirName, specFileName) {
  const specBase = specFileName.replace(/\.yaml$/, '');
  const filePath = path.join(acceptedChangesRoot, category, revisionDirName, specBase, 'breaking-changes.yaml');
  if (!fs.existsSync(filePath)) return [];
  const doc = YAML.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(doc) ? doc : [];
}

function isAccepted(errorLine, accepted) {
  const parsed = parseErrorLine(errorLine);
  if (!parsed) return false;
  return accepted.some(entry => {
    const rules = entry.rules || (entry.rule ? [entry.rule] : []);
    if (!rules.includes(parsed.rule)) return false;
    if (!entry.endpoints || entry.endpoints.length === 0) return true;
    return entry.endpoints.some(e => e.method === parsed.method && e.path === parsed.path);
  });
}

// Within-major (base, revision) pairs per product, with per-file fallback to the most recent
// prior version in the same major that contains the file.
function buildPiiPairs() {
  const pairs = [];
  for (const product of fs.readdirSync(distDir, { withFileTypes: true }).filter(e => e.isDirectory())) {
    const productDir = path.join(distDir, product.name);
    const versions = fs.readdirSync(productDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name, parsed: parseVersion(e.name) }))
      .filter(e => e.parsed)
      .sort((a, b) => compareVersions(a.parsed, b.parsed));

    for (let i = 1; i < versions.length; i++) {
      const revision = versions[i];
      const priors = versions
        .slice(0, i)
        .filter(v => v.parsed.major === revision.parsed.major)
        .reverse();
      if (!priors.length) continue; // first version in a major; nothing within-major to compare
      pairs.push({ category: product.name, productDir, revision, priors });
    }
  }
  return pairs;
}

describe('No unrecorded breaking changes to the decoded PII contract', {
  skip: !oasdiffAvailable() && 'oasdiff not installed — see https://github.com/oasdiff/oasdiff#installation',
}, () => {
  for (const { category, productDir, revision, priors } of buildPiiPairs()) {
    const revDir = path.join(productDir, revision.name);
    const specFiles = fs.readdirSync(revDir).filter(f => f.endsWith('-openapi.yaml'));

    for (const file of specFiles) {
      const baseVersion = priors.find(v => fs.existsSync(path.join(productDir, v.name, file)));
      if (!baseVersion) continue; // new file in this version — additive, not breaking

      const baseDoc = loadDoc(path.join(productDir, baseVersion.name, file));
      const revDoc = loadDoc(revDir + path.sep + file);
      // Only compare where both sides actually expose a decoded PII contract; otherwise the
      // decoded structure is being introduced (additive), not changed.
      if (!baseDoc || !revDoc || !hasStrippableDecodedPii(baseDoc) || !hasStrippableDecodedPii(revDoc)) continue;

      const label = `${baseVersion.name} -> ${revision.name}`;
      it(`${category} ${label}: ${file} decoded PII has no unrecorded breaking changes`, () => {
        const baseFile = writeStripped(baseDoc, 'base');
        const revFile = writeStripped(revDoc, 'rev');
        const result = spawnSync(
          'oasdiff',
          ['breaking', baseFile, revFile, '--fail-on', 'ERR', '--color', 'never', '--format', 'singleline'],
          { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
        );
        if (result.status === 0) return;
        if (result.status !== 1) {
          throw new Error(`oasdiff exited with status ${result.status}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
        }
        const accepted = loadAcceptedChanges(category, revision.name, file);
        const allErrors = result.stdout.split('\n').filter(l => l.startsWith('error'));
        const unaccepted = allErrors.filter(l => !isAccepted(l, accepted));
        if (unaccepted.length === 0) return;
        const acceptedNote = allErrors.length - unaccepted.length > 0
          ? ` (${allErrors.length - unaccepted.length} accepted via supporting/breaking-changes/)` : '';
        assert.fail(`Found ${unaccepted.length} unrecorded breaking change(s) in the decoded PII${acceptedNote}:\n  ${unaccepted.join('\n  ')}`);
      });
    }
  }
});
