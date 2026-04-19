const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const YAML = require('yaml');
const { findLatestSpecs, relativeToRepo } = require('../helpers');

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'];
const PARAM_REF_PREFIX = '#/components/parameters/';

function resolveParam(doc, param) {
  if (!param || typeof param !== 'object') return null;
  if (typeof param.$ref === 'string' && param.$ref.startsWith(PARAM_REF_PREFIX)) {
    const name = param.$ref.slice(PARAM_REF_PREFIX.length);
    return doc?.components?.parameters?.[name] || null;
  }
  return param;
}

function pathParamNames(doc, params) {
  if (!Array.isArray(params)) return [];
  return params
    .map(p => resolveParam(doc, p))
    .filter(p => p && p.in === 'path' && typeof p.name === 'string')
    .map(p => p.name);
}

const latestSpecs = findLatestSpecs();

describe('Path parameters are declared on the operation', () => {
  for (const filePath of latestSpecs) {
    const relativePath = relativeToRepo(filePath);

    it(`${relativePath} declares every {placeholder} in its URL`, () => {
      const doc = YAML.parse(fs.readFileSync(filePath, 'utf8'));
      const problems = [];

      for (const [pathKey, pathItem] of Object.entries(doc?.paths || {})) {
        if (!pathItem || typeof pathItem !== 'object') continue;
        const placeholders = [...pathKey.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
        if (placeholders.length === 0) continue;

        const pathLevel = pathParamNames(doc, pathItem.parameters);

        for (const method of METHODS) {
          const op = pathItem[method];
          if (!op) continue;
          const declared = new Set([...pathLevel, ...pathParamNames(doc, op.parameters)]);
          for (const name of placeholders) {
            if (!declared.has(name)) {
              problems.push(`${method.toUpperCase()} ${pathKey} does not declare {${name}}`);
            }
          }
        }
      }

      assert.deepStrictEqual(
        problems,
        [],
        `Found ${problems.length} undeclared path parameter(s):\n  ${problems.join('\n  ')}`
      );
    });
  }
});
