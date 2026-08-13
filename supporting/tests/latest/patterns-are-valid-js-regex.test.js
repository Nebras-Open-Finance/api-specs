const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const YAML = require('yaml');
const { findLatestSpecs, relativeToRepo } = require('../helpers');

// Collect every JSON-Schema `pattern` keyword (string-valued) with a breadcrumb
// path for readable failure messages. Parsing the YAML (rather than scanning the
// text) means we test the *effective* regex the engine receives — so a
// double-quoted `"\/"`, which YAML collapses back to a bare `/`, is caught too.
function collectPatterns(node, path = '', out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectPatterns(item, `${path}[${i}]`, out));
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    const childPath = path ? `${path}.${key}` : key;
    if (key === 'pattern' && typeof value === 'string') {
      out.push({ path: childPath, pattern: value });
    } else {
      collectPatterns(value, childPath, out);
    }
  }
  return out;
}

// Inside the RegExp constructor an unescaped `/` is legal, but tooling that
// treats the pattern as a `/.../` literal breaks on it. The repo convention is
// to escape every slash as `\/` (e.g. `^https:\/\/.+`). NOTE: this must be an
// unquoted (or single-quoted) YAML scalar — a double-quoted `"\/"` is collapsed
// back to `/` by the YAML parser and defeats the escape. See CLAUDE.md.
function hasUnescapedSlash(s) {
  let escaped = false;
  for (const ch of s) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '/') return true;
  }
  return false;
}

const latestSpecs = findLatestSpecs();

describe('Schema `pattern`s are valid, literal-safe JS regexes', () => {
  it('should find latest spec files', () => {
    assert.ok(latestSpecs.length > 0, 'Expected at least one latest spec file');
  });

  for (const filePath of latestSpecs) {
    const relativePath = relativeToRepo(filePath);

    it(`${relativePath} has only valid, slash-escaped regex patterns`, () => {
      const doc = YAML.parse(fs.readFileSync(filePath, 'utf8'));
      const patterns = collectPatterns(doc);

      const invalid = [];
      const unescaped = [];
      for (const { path, pattern } of patterns) {
        try {
          new RegExp(pattern);
        } catch (err) {
          invalid.push(`${path}: ${pattern}  (${err.message})`);
        }
        if (hasUnescapedSlash(pattern)) {
          unescaped.push(`${path}: ${pattern}`);
        }
      }

      assert.deepStrictEqual(
        invalid,
        [],
        `Found ${invalid.length} invalid regex pattern(s) — must be a valid ECMAScript regex:\n  ${invalid.join('\n  ')}`
      );
      assert.deepStrictEqual(
        unescaped,
        [],
        `Found ${unescaped.length} pattern(s) with an unescaped '/'. Escape as '\\/' (in an unquoted YAML scalar) so the pattern is safe as a /.../ regex literal:\n  ${unescaped.join('\n  ')}`
      );
    });
  }
});
