const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

/**
 * Recursively find all OpenAPI YAML files under the dist directory.
 */
function findOpenApiFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findOpenApiFiles(fullPath, files);
    } else if (entry.name.endsWith('-openapi.yaml')) {
      files.push(fullPath);
    }
  }
  return files;
}

const distDir = path.join(__dirname, '..', 'dist');
const specFiles = findOpenApiFiles(distDir);

describe('OpenAPI spec validation', () => {
  it('should find OpenAPI spec files', () => {
    assert.ok(specFiles.length > 0, 'Expected at least one OpenAPI spec file in dist/');
  });

  for (const filePath of specFiles) {
    const relativePath = path.relative(path.join(__dirname, '..'), filePath);

    it(`${relativePath} should be valid YAML`, () => {
      const content = fs.readFileSync(filePath, 'utf8');
      const doc = YAML.parse(content);
      assert.ok(doc, 'YAML parse returned empty document');
    });

    it(`${relativePath} should have required OpenAPI fields`, () => {
      const content = fs.readFileSync(filePath, 'utf8');
      const doc = YAML.parse(content);

      assert.ok(doc.openapi, 'Missing "openapi" version field');
      assert.match(doc.openapi, /^3\./, 'Expected OpenAPI 3.x version');

      assert.ok(doc.info, 'Missing "info" object');
      assert.ok(doc.info.title, 'Missing "info.title"');
      assert.ok(doc.info.version, 'Missing "info.version"');

      assert.ok(doc.paths || doc.webhooks, 'Missing "paths" or "webhooks" object');
    });
  }
});
