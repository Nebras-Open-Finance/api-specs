const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const YAML = require('yaml');
const { findLatestSpecs, relativeToRepo } = require('../helpers');

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'];

const latestSpecs = findLatestSpecs();

describe('Every operation has a unique, non-empty operationId', () => {
  for (const filePath of latestSpecs) {
    const relativePath = relativeToRepo(filePath);

    it(`${relativePath} has no missing or duplicate operationIds`, () => {
      const doc = YAML.parse(fs.readFileSync(filePath, 'utf8'));
      const seen = new Map();
      const missing = [];

      for (const [pathKey, pathItem] of Object.entries(doc?.paths || {})) {
        if (!pathItem || typeof pathItem !== 'object') continue;
        for (const method of METHODS) {
          const op = pathItem[method];
          if (!op) continue;
          const location = `${method.toUpperCase()} ${pathKey}`;
          if (typeof op.operationId !== 'string' || op.operationId.length === 0) {
            missing.push(location);
            continue;
          }
          const existing = seen.get(op.operationId) || [];
          existing.push(location);
          seen.set(op.operationId, existing);
        }
      }

      const duplicates = [...seen.entries()].filter(([, locations]) => locations.length > 1);
      const problems = [];
      for (const location of missing) {
        problems.push(`missing operationId: ${location}`);
      }
      for (const [opId, locations] of duplicates) {
        problems.push(`duplicate operationId "${opId}": ${locations.join(', ')}`);
      }

      assert.deepStrictEqual(
        problems,
        [],
        `Found ${problems.length} operationId issue(s):\n  ${problems.join('\n  ')}`
      );
    });
  }
});
