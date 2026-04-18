const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { findLatestSpecs, relativeToRepo } = require('../helpers');

const latestSpecs = findLatestSpecs();

describe('No double-escaped regex patterns (OF-6288)', () => {
  it('should find latest spec files', () => {
    assert.ok(latestSpecs.length > 0, 'Expected at least one latest spec file');
  });

  for (const filePath of latestSpecs) {
    const relativePath = relativeToRepo(filePath);

    it(`${relativePath} has no double-escaped regex patterns`, () => {
      const content = fs.readFileSync(filePath, 'utf8');
      const doubleEscaped = /pattern:\s.*\\\\d/g;
      const matches = content.match(doubleEscaped);
      assert.strictEqual(
        matches,
        null,
        `Found double-escaped regex pattern(s) — likely a bug:\n  ${(matches || []).join('\n  ')}`
      );
    });
  }
});
