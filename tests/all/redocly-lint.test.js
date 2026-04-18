const { describe, it } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const { distDir, repoRoot, findOpenApiFiles, relativeToRepo } = require('../helpers');

const specFiles = findOpenApiFiles(distDir);

describe('Redocly lint', () => {
  it('should find OpenAPI spec files', () => {
    assert.ok(specFiles.length > 0, 'Expected at least one OpenAPI spec file in dist/');
  });

  for (const filePath of specFiles) {
    const relativePath = relativeToRepo(filePath);

    it(`${relativePath} passes redocly lint`, () => {
      const result = spawnSync(
        'npx',
        ['--no-install', 'redocly', 'lint', filePath],
        { cwd: repoRoot, encoding: 'utf8', shell: true }
      );

      assert.strictEqual(
        result.status,
        0,
        `redocly lint failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`
      );
    });
  }
});
