const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const util = require('node:util');
const YAML = require('yaml');
const { findLatestSpecs, relativeToRepo, repoRoot } = require('../helpers');

const BRANCH = 'main';

function deriveRepoSlug() {
  const url = execSync('git remote get-url origin', { encoding: 'utf8', cwd: repoRoot }).trim();
  const match = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!match) throw new Error(`Cannot derive GitHub repo slug from origin URL: ${url}`);
  return match[1];
}

const repoSlug = deriveRepoSlug();

async function fetchFromMain(relPath) {
  const posixPath = relPath.split(/[\\/]/).join('/');
  const url = `https://raw.githubusercontent.com/${repoSlug}/${BRANCH}/${posixPath}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status} ${res.statusText}`);
  return YAML.parse(await res.text());
}

const latestSpecs = findLatestSpecs();

describe(`No silent modification of a version already on ${BRANCH}`, () => {
  for (const filePath of latestSpecs) {
    const rel = relativeToRepo(filePath);

    it(`${rel} differs from ${BRANCH} only when info.version has been bumped`, async () => {
      const current = YAML.parse(fs.readFileSync(filePath, 'utf8'));
      const currentVersion = current?.info?.version;
      if (typeof currentVersion !== 'string') return;

      const mainDoc = await fetchFromMain(rel);
      if (!mainDoc) return;
      const mainVersion = mainDoc?.info?.version;
      if (typeof mainVersion !== 'string') return;

      if (mainVersion !== currentVersion) return;

      assert.ok(
        util.isDeepStrictEqual(current, mainDoc),
        `${rel} differs from ${BRANCH} but info.version is still "${currentVersion}". That version is already on ${BRANCH} (i.e. published); bump info.version to register this change.`
      );
    });
  }
});
