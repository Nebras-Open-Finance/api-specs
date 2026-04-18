const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const YAML = require('yaml');
const { findLatestSpecs, relativeToRepo } = require('../helpers');

const SCHEMA_REF_PREFIX = '#/components/schemas/';

function collectUnguardedRefs(node, refs = new Set()) {
  if (!node || typeof node !== 'object') return refs;
  if (Array.isArray(node)) {
    for (const item of node) collectUnguardedRefs(item, refs);
    return refs;
  }
  if (typeof node.$ref === 'string') {
    refs.add(node.$ref);
    return refs;
  }
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    if (Array.isArray(node[key])) {
      for (const item of node[key]) collectUnguardedRefs(item, refs);
    }
  }
  if (node.not) collectUnguardedRefs(node.not, refs);
  return refs;
}

function findCycles(graph) {
  const cycles = [];
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map();
  for (const name of Object.keys(graph)) colour.set(name, WHITE);

  function visit(name, stack) {
    colour.set(name, GREY);
    stack.push(name);
    for (const next of graph[name] || []) {
      if (!(next in graph)) continue;
      if (colour.get(next) === GREY) {
        const cycleStart = stack.indexOf(next);
        cycles.push([...stack.slice(cycleStart), next]);
      } else if (colour.get(next) === WHITE) {
        visit(next, stack);
      }
    }
    stack.pop();
    colour.set(name, BLACK);
  }

  for (const name of Object.keys(graph)) {
    if (colour.get(name) === WHITE) visit(name, []);
  }
  return cycles;
}

const latestSpecs = findLatestSpecs();

describe('No circular schema references', () => {
  for (const filePath of latestSpecs) {
    const relativePath = relativeToRepo(filePath);

    it(`${relativePath} has no unguarded $ref cycles in components.schemas`, () => {
      const doc = YAML.parse(fs.readFileSync(filePath, 'utf8'));
      const schemas = doc?.components?.schemas;
      if (!schemas) return;

      const graph = {};
      for (const [name, schema] of Object.entries(schemas)) {
        const refs = collectUnguardedRefs(schema);
        graph[name] = [...refs]
          .filter(r => r.startsWith(SCHEMA_REF_PREFIX))
          .map(r => r.slice(SCHEMA_REF_PREFIX.length));
      }

      const cycles = findCycles(graph);
      assert.strictEqual(
        cycles.length,
        0,
        `Found ${cycles.length} circular reference chain(s):\n  ${cycles.map(c => c.join(' -> ')).join('\n  ')}`
      );
    });
  }
});
