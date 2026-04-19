const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const YAML = require('yaml');
const { distDir, findOpenApiFiles, relativeToRepo } = require('../helpers');

const specFiles = findOpenApiFiles(distDir);

describe('YAML is a valid OpenAPI file', () => {
  it('should find OpenAPI spec files', () => {
    assert.ok(specFiles.length > 0, 'Expected at least one OpenAPI spec file in dist/');
  });

  for (const filePath of specFiles) {
    const relativePath = relativeToRepo(filePath);

    it(`${relativePath} is a valid OpenAPI 3.x YAML document`, () => {
      const content = fs.readFileSync(filePath, 'utf8');
      const doc = YAML.parse(content);
      assert.ok(doc, 'YAML parse returned empty document');

      assert.ok(doc.openapi, 'Missing "openapi" version field');
      assert.match(doc.openapi, /^3\./, 'Expected OpenAPI 3.x version');

      assert.ok(doc.info, 'Missing "info" object');
      assert.ok(doc.info.title, 'Missing "info.title"');
      assert.ok(doc.info.version, 'Missing "info.version"');

      assert.ok(doc.paths || doc.webhooks, 'Missing "paths" or "webhooks" object');
    });
  }
});
