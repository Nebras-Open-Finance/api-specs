const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const util = require('node:util');
const YAML = require('yaml');
const { findLatestSpecs, relativeToRepo, repoRoot } = require('../helpers');

const BRANCH = 'main';

// Re-wrapping prose to a column budget (supporting/scripts/format-specs.js) is a
// pure formatting change, not a content change, and must not require an
// info.version bump. It shifts line breaks inside block scalars, which changes
// the parsed string. So before comparing, collapse intra-paragraph whitespace in
// every string value while preserving blank-line paragraph breaks: a re-wrapped
// paragraph then compares equal to its origin, but any word- or paragraph-level
// edit (and every structural change) is still caught.
function normalizeWhitespace(str) {
  return str
    .split(/\n[ \t]*\n/)
    .map(para => para.replace(/\s+/g, ' ').trim())
    .join('\n');
}

function normalizeForFormatting(node) {
  if (typeof node === 'string') return normalizeWhitespace(node);
  if (Array.isArray(node)) return node.map(normalizeForFormatting);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) out[key] = normalizeForFormatting(value);
    return out;
  }
  return node;
}

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

// Standards errata folders are mutable working areas by design: CLAUDE.md
// requires info.version to equal the errata folder suffix verbatim (so it
// cannot be bumped) and instructs editing the latest errata folder in place.
// Modifying such a file after it has reached main is therefore the sanctioned
// workflow, not a silent modification — the errata mechanism and
// supporting/breaking-changes/ are the governance for it. This test only
// enforces the patch-bump rule, which applies to api-hub and ozone-connect.
function isStandardsErrataSpec(filePath) {
  const segments = relativeToRepo(filePath).split(/[\\/]/);
  return segments[0] === 'dist'
    && segments[1] === 'standards'
    && /-errata\d+$/.test(segments[2] || '');
}

const latestSpecs = findLatestSpecs().filter(f => !isStandardsErrataSpec(f));

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
        util.isDeepStrictEqual(normalizeForFormatting(current), normalizeForFormatting(mainDoc)),
        `${rel} differs from ${BRANCH} (beyond prose re-wrapping) but info.version is still "${currentVersion}". That version is already on ${BRANCH} (i.e. published); bump info.version to register this change.`
      );
    });
  }
});
