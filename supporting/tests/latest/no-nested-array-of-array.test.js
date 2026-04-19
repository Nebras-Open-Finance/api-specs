const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const YAML = require('yaml');
const { findLatestSpecs, relativeToRepo } = require('../helpers');

const LOCAL_SCHEMA_PREFIX = '#/components/schemas/';

function resolveRef(doc, ref) {
  if (typeof ref !== 'string' || !ref.startsWith(LOCAL_SCHEMA_PREFIX)) return null;
  return doc?.components?.schemas?.[ref.slice(LOCAL_SCHEMA_PREFIX.length)] ?? null;
}

function resolveItems(doc, items, seenRefs = new Set()) {
  if (!items || typeof items !== 'object') return null;
  if (typeof items.$ref === 'string') {
    if (seenRefs.has(items.$ref)) return null;
    seenRefs.add(items.$ref);
    return resolveItems(doc, resolveRef(doc, items.$ref), seenRefs);
  }
  return items;
}

function walkForNestedArrays(doc, node, pathStack, findings) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkForNestedArrays(doc, item, [...pathStack, i], findings));
    return;
  }
  if (node.type === 'array' && node.items) {
    const resolved = resolveItems(doc, node.items);
    if (resolved && resolved.type === 'array') {
      const refNote = typeof node.items.$ref === 'string' ? ` (items -> ${node.items.$ref})` : '';
      findings.push(`${pathStack.join('.') || '<root>'}${refNote}`);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    walkForNestedArrays(doc, value, [...pathStack, key], findings);
  }
}

const specFiles = findLatestSpecs();

describe('No array-of-array schemas', () => {
  for (const filePath of specFiles) {
    const relativePath = relativeToRepo(filePath);

    it(`${relativePath} has no schema where an array's items resolve to another array`, () => {
      const doc = YAML.parse(fs.readFileSync(filePath, 'utf8'));
      const findings = [];
      walkForNestedArrays(doc, doc, [], findings);
      assert.deepStrictEqual(
        findings,
        [],
        `Found ${findings.length} array-of-array schema(s):\n  ${findings.join('\n  ')}`
      );
    });
  }
});
