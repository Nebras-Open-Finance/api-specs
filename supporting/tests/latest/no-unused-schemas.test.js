const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const YAML = require('yaml');
const { findLatestSpecs, relativeToRepo } = require('../helpers');

const SCHEMA_REF_PREFIX = '#/components/schemas/';

function collectRefs(node, refs = new Set()) {
  if (!node || typeof node !== 'object') return refs;
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
    return refs;
  }
  if (typeof node.$ref === 'string') refs.add(node.$ref);
  for (const value of Object.values(node)) collectRefs(value, refs);
  return refs;
}

const latestSpecs = findLatestSpecs();

describe('No unused schemas in components.schemas', () => {
  for (const filePath of latestSpecs) {
    const relativePath = relativeToRepo(filePath);

    it(`${relativePath} references every schema it defines`, () => {
      const doc = YAML.parse(fs.readFileSync(filePath, 'utf8'));
      const schemas = doc?.components?.schemas;
      if (!schemas) return;

      const refs = collectRefs(doc);
      const unused = Object.keys(schemas)
        .filter(name => !refs.has(SCHEMA_REF_PREFIX + name));

      assert.deepStrictEqual(
        unused,
        [],
        `Found ${unused.length} unused schema(s):\n  ${unused.join('\n  ')}`
      );
    });
  }
});
