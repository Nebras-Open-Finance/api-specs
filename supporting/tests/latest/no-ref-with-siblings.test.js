const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const YAML = require('yaml');
const { findLatestSpecs, relativeToRepo } = require('../helpers');

function walk(node, pathStack, findings) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, [...pathStack, i], findings));
    return;
  }
  if (typeof node.$ref === 'string') {
    const siblings = Object.keys(node).filter(k => k !== '$ref');
    if (siblings.length > 0) {
      findings.push(`${pathStack.join('.') || '<root>'} has $ref alongside: ${siblings.join(', ')}`);
    }
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    walk(value, [...pathStack, key], findings);
  }
}

const latestSpecs = findLatestSpecs();

describe('No $ref with sibling keys (OpenAPI 3.0 ignores siblings)', () => {
  for (const filePath of latestSpecs) {
    const relativePath = relativeToRepo(filePath);

    it(`${relativePath} has no object mixing $ref with other keys`, () => {
      const doc = YAML.parse(fs.readFileSync(filePath, 'utf8'));
      const findings = [];
      walk(doc, [], findings);
      assert.deepStrictEqual(
        findings,
        [],
        `Found ${findings.length} $ref-with-siblings object(s):\n  ${findings.join('\n  ')}`
      );
    });
  }
});
