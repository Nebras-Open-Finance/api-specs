const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const YAML = require('yaml');
const { findLatestSpecs, relativeToRepo } = require('../helpers');

const COMPONENT_SECTIONS = [
  'schemas',
  'parameters',
  'responses',
  'requestBodies',
  'headers',
  'securitySchemes',
  'examples',
  'links',
  'callbacks',
];

function collectRefs(node, refs = []) {
  if (!node || typeof node !== 'object') return refs;
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
    return refs;
  }
  if (typeof node.$ref === 'string') refs.push(node.$ref);
  for (const value of Object.values(node)) collectRefs(value, refs);
  return refs;
}

const latestSpecs = findLatestSpecs();

describe('No dangling $refs to components', () => {
  for (const filePath of latestSpecs) {
    const relativePath = relativeToRepo(filePath);

    it(`${relativePath} resolves every #/components/... $ref`, () => {
      const doc = YAML.parse(fs.readFileSync(filePath, 'utf8'));
      const components = doc?.components || {};
      const refs = collectRefs(doc);

      const dangling = new Set();
      for (const ref of refs) {
        for (const section of COMPONENT_SECTIONS) {
          const prefix = `#/components/${section}/`;
          if (!ref.startsWith(prefix)) continue;
          const name = ref.slice(prefix.length);
          if (!components[section] || !(name in components[section])) {
            dangling.add(ref);
          }
        }
      }

      assert.deepStrictEqual(
        [...dangling],
        [],
        `Found ${dangling.size} dangling $ref(s):\n  ${[...dangling].join('\n  ')}`
      );
    });
  }
});
