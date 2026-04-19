const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const YAML = require('yaml');
const { findLatestSpecs, relativeToRepo } = require('../helpers');

const COMPOSITION_KEYS = ['allOf', 'oneOf', 'anyOf'];

// A node inside an allOf/oneOf/anyOf branch can legitimately list `required`
// entries whose properties come from a sibling branch, so skip those.
function insideComposition(pathStack) {
  for (let i = 0; i < pathStack.length - 1; i++) {
    if (COMPOSITION_KEYS.includes(pathStack[i]) && typeof pathStack[i + 1] === 'number') {
      return true;
    }
  }
  return false;
}

function hasCompositionSibling(node) {
  return COMPOSITION_KEYS.some(k => Array.isArray(node[k]));
}

function walk(node, pathStack, findings) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, [...pathStack, i], findings));
    return;
  }

  if (
    Array.isArray(node.required) &&
    node.properties && typeof node.properties === 'object' &&
    !hasCompositionSibling(node) &&
    !insideComposition(pathStack)
  ) {
    for (const name of node.required) {
      if (typeof name === 'string' && !(name in node.properties)) {
        findings.push(`${pathStack.join('.') || '<root>'} requires "${name}" but it is not in properties`);
      }
    }
  }

  for (const [key, value] of Object.entries(node)) {
    walk(value, [...pathStack, key], findings);
  }
}

const latestSpecs = findLatestSpecs();

describe('required[] entries exist in properties', () => {
  for (const filePath of latestSpecs) {
    const relativePath = relativeToRepo(filePath);

    it(`${relativePath} lists no required property that is missing from properties`, () => {
      const doc = YAML.parse(fs.readFileSync(filePath, 'utf8'));
      const findings = [];
      walk(doc, [], findings);
      assert.deepStrictEqual(
        findings,
        [],
        `Found ${findings.length} required/properties mismatch(es):\n  ${findings.join('\n  ')}`
      );
    });
  }
});
