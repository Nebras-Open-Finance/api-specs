const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
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

// Standards pre-release (draft, rc) and errata folders are mutable working
// areas by design: CLAUDE.md requires info.version to equal the folder suffix
// verbatim (so it cannot be bumped) and instructs editing the latest folder in
// place — a draft or release candidate while the version is being assembled, an
// errata once it is published. Modifying such a file after it has reached main
// is therefore the sanctioned workflow, not a silent modification — the
// pre-release/errata mechanism and supporting/breaking-changes/ are the
// governance for it. This test only enforces the patch-bump rule, which applies
// to api-hub and ozone-connect.
function isStandardsWorkingSpec(filePath) {
  const segments = relativeToRepo(filePath).split(/[\\/]/);
  return segments[0] === 'dist'
    && segments[1] === 'standards'
    && /-(draft|rc|errata)\d+$/.test(segments[2] || '');
}

const revertedVersionsRoot = path.join(repoRoot, 'supporting', 'reverted-versions');

// A reversion withdraws content from a version already on main, restoring what that
// version described before the withdrawn change landed. The patch-bump rule is the
// wrong answer for it: bumping would publish the withdrawal as a new version instead
// of undoing it, leaving the version on main standing as one that shipped content the
// ecosystem was never meant to implement. supporting/reverted-versions/ records the
// exemption — one entry per (spec, info.version), signed off and explained, in the
// same shape as supporting/breaking-changes/. It exempts that one version and nothing
// else; the next uplift of the same file is checked normally. A malformed or missing
// entry simply fails to match, so the check fails closed.
function revertedVersions(filePath) {
  const [, category, versionDir, file] = relativeToRepo(filePath).split(/[\\/]/);
  if (!category || !versionDir || !file) return [];
  const specBase = file.replace(/\.yaml$/, '');
  const recordPath = path.join(revertedVersionsRoot, category, versionDir, specBase, 'reverted-versions.yaml');
  if (!fs.existsSync(recordPath)) return [];
  const doc = YAML.parse(fs.readFileSync(recordPath, 'utf8'));
  return Array.isArray(doc) ? doc : [];
}

const latestSpecs = findLatestSpecs().filter(f => !isStandardsWorkingSpec(f));

describe(`No silent modification of a version already on ${BRANCH}`, () => {
  for (const filePath of latestSpecs) {
    const rel = relativeToRepo(filePath);

    it(`${rel} differs from ${BRANCH} only when info.version has been bumped`, async (t) => {
      const current = YAML.parse(fs.readFileSync(filePath, 'utf8'));
      const currentVersion = current?.info?.version;
      if (typeof currentVersion !== 'string') return;

      if (revertedVersions(filePath).some(entry => entry && entry.version === currentVersion)) {
        return t.skip(
          `${currentVersion} has a recorded reversion in supporting/reverted-versions/ — content withdrawn in place, no bump expected`
        );
      }

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
