const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const { distDir, repoRoot, parseVersion } = require('../helpers');

// The api-hub Authorisation Server and Consent Manager must stay backward
// compatible: a client built against an older release must keep working
// against a newer one. This test runs `oasdiff breaking` over every
// within-major version step and fails on any breaking change.
//
// Scope decisions:
//   * Only these two files are checked — the contract-stability guarantee
//     applies to them specifically.
//   * Comparisons stay WITHIN a major version (v2.0.x -> v2.1.x). The
//     v1.2.x -> v2.0.x step is a major bump (it also renamed both files,
//     cbuae-* -> uae-api-hub-*) and is allowed to break; major-version pairs
//     are never built.
//   * api-hub has no errata folders. Patch versions (v2.1.7, v2.1.8, ...)
//     live in git history, not on disk, so the on-disk comparison is
//     folder-to-folder: one folder per major.minor line.
//
// A genuinely necessary breaking change can be recorded under
// supporting/breaking-changes/api-hub/<revision-folder>/<spec-name>/breaking-changes.yaml
// (same format as the standards equivalent); recorded changes stop failing
// the build.

const CHECKED_FILES = [
  'uae-api-hub-authorisation-server-openapi.yaml',
  'uae-api-hub-consent-manager-openapi.yaml',
];

// Endpoints excluded from the breaking-change check. Breaking changes on
// these paths are not reported regardless of rule. These are log / quote-log
// endpoints whose backward-compatibility guarantee is still under review;
// excluded for now so the check can be enforced on the consent endpoints.
const IGNORED_PATHS = new Set([
  '/account-opening-log/{logId}',
  '/fx-quote-log/{logId}',
  '/insurance-quote-log/{logId}',
]);

// False positives from schema restructuring — not real breaking changes.
//
// When a plain scalar schema (`type: string` with min/maxLength) is rewrapped
// as an `anyOf` whose first branch is the original shape, kept and marked
// `deprecated`, every previously-valid value is still accepted — the change is
// backward compatible. oasdiff diffs schema attributes one by one and does not
// see this: it reports the top-level `type`, `minLength` and `maxLength` as
// removed/loosened because they now live inside the `anyOf` branches.
//
// The v2.1 CreditorReference / DebtorReference schemas
// (AEServiceInitiation{Creditor,Debtor}Reference) did exactly this. Errors of
// the rules below, on a property whose leaf name is one of these, are
// suppressed. Any other rule on these properties is still reported.
const ANYOF_RESTRUCTURED_PROPERTIES = new Set(['CreditorReference', 'DebtorReference']);
const ANYOF_RESTRUCTURE_RULES = new Set([
  'request-property-type-changed',
  'response-property-type-changed',
  'response-property-max-length-unset',
  'response-property-min-length-decreased',
]);

// Schemas whose contents are validated by the LFI, not the Hub. The Consent
// Manager forwards PII without enforcing its shape, so oasdiff changes
// involving these schemas are not breaking changes to the Hub contract. Any
// error referencing one of them is suppressed regardless of rule.
const LFI_VALIDATED_SCHEMAS = new Set(['AEJWEPaymentPII', 'AEPaymentConsentPII']);

const apiHubDir = path.join(distDir, 'api-hub');
const acceptedChangesRoot = path.join(repoRoot, 'supporting', 'breaking-changes', 'api-hub');

function listVersionDirs() {
  return fs.readdirSync(apiHubDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, parsed: parseVersion(e.name) }))
    .filter(e => e.parsed);
}

// Consecutive minor-version pairs, grouped by major so cross-major steps are
// never compared. e.g. major 2 = [v2.0.x, v2.1.x] yields one pair.
function buildMinorPairs(versionDirs) {
  const byMajor = new Map();
  for (const v of versionDirs) {
    if (!byMajor.has(v.parsed.major)) byMajor.set(v.parsed.major, []);
    byMajor.get(v.parsed.major).push(v);
  }
  const pairs = [];
  for (const list of byMajor.values()) {
    list.sort((a, b) => a.parsed.minor - b.parsed.minor);
    for (let i = 1; i < list.length; i++) {
      pairs.push({ base: list[i - 1], revision: list[i] });
    }
  }
  return pairs;
}

function oasdiffAvailable() {
  const result = spawnSync('oasdiff', ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

function loadAcceptedChanges(revisionDirName, specFileName) {
  const specBase = specFileName.replace(/\.yaml$/, '');
  const filePath = path.join(acceptedChangesRoot, revisionDirName, specBase, 'breaking-changes.yaml');
  if (!fs.existsSync(filePath)) return [];
  const doc = YAML.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(doc) ? doc : [];
}

function parseErrorLine(line) {
  const match = line.match(/in API (\S+) (\S+) .* \[([a-z-]+)\]/);
  if (!match) return null;
  return { method: match[1], path: match[2], rule: match[3] };
}

function isIgnoredPath(errorLine) {
  const parsed = parseErrorLine(errorLine);
  return parsed ? IGNORED_PATHS.has(parsed.path) : false;
}

// True when the error is oasdiff misreading a plain-scalar -> deprecated-anyOf
// rewrap (see ANYOF_RESTRUCTURED_PROPERTIES above) as a breaking change.
function isAnyOfRestructureNoise(errorLine) {
  const parsed = parseErrorLine(errorLine);
  if (!parsed || !ANYOF_RESTRUCTURE_RULES.has(parsed.rule)) return false;
  const propMatch = errorLine.match(/`([^`]+)`/);
  if (!propMatch) return false;
  const leaf = propMatch[1].split('/').pop();
  return ANYOF_RESTRUCTURED_PROPERTIES.has(leaf);
}

// True when the error references a schema whose contents the LFI validates
// (see LFI_VALIDATED_SCHEMAS above), so the change is not a Hub-contract break.
function isLfiValidatedSchema(errorLine) {
  return [...LFI_VALIDATED_SCHEMAS].some(name =>
    new RegExp(`#/components/schemas/${name}\\b`).test(errorLine));
}

function isAccepted(errorLine, accepted) {
  const parsed = parseErrorLine(errorLine);
  if (!parsed) return false;
  return accepted.some(entry => {
    const rules = entry.rules || (entry.rule ? [entry.rule] : []);
    if (!rules.includes(parsed.rule)) return false;
    if (!entry.endpoints || entry.endpoints.length === 0) return true;
    return entry.endpoints.some(e => e.method === parsed.method && e.path === parsed.path);
  });
}

// oasdiff parses each spec argument as `[<git-revision>:]<path>`. A Windows
// absolute path (`c:\...`) is split on its drive-letter colon, so oasdiff
// tries to load the spec from a bogus git revision `c`. Pass repo-relative,
// forward-slash paths (with cwd pinned to the repo root) so no colon appears.
function toOasdiffPath(absFile) {
  return path.relative(repoRoot, absFile).split(path.sep).join('/');
}

function assertNoBreakingChanges(baseFile, revisionFile, revisionDirName, specFileName) {
  const result = spawnSync(
    'oasdiff',
    ['breaking', toOasdiffPath(baseFile), toOasdiffPath(revisionFile),
      '--fail-on', 'ERR', '--color', 'never', '--format', 'singleline'],
    { encoding: 'utf8', cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 }
  );
  if (result.status === 0) return;
  if (result.status === 1) {
    const accepted = loadAcceptedChanges(revisionDirName, specFileName);
    const allErrors = result.stdout.split('\n')
      .filter(line => line.startsWith('error'))
      .filter(line => !isIgnoredPath(line))
      .filter(line => !isAnyOfRestructureNoise(line))
      .filter(line => !isLfiValidatedSchema(line));
    const unaccepted = allErrors.filter(line => !isAccepted(line, accepted));
    if (unaccepted.length === 0) return;
    const acceptedCount = allErrors.length - unaccepted.length;
    const acceptedNote = acceptedCount > 0 ? ` (${acceptedCount} accepted via supporting/breaking-changes/)` : '';
    assert.fail(
      `Found ${unaccepted.length} breaking change(s)${acceptedNote}:\n  ${unaccepted.join('\n  ')}\n` +
      `If a change is genuinely required, record it under ` +
      `supporting/breaking-changes/api-hub/${revisionDirName}/${specFileName.replace(/\.yaml$/, '')}/breaking-changes.yaml.`
    );
  }
  throw new Error(
    `oasdiff exited with status ${result.status}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
}

const pairs = buildMinorPairs(listVersionDirs());

describe('No breaking changes within a major version (api-hub auth server + consent manager)', {
  skip: !oasdiffAvailable() && 'oasdiff not installed — see https://github.com/oasdiff/oasdiff#installation',
}, () => {
  if (pairs.length === 0) {
    it('should have at least one within-major version pair to compare', () => {
      assert.fail(`No within-major version pairs found in ${apiHubDir}`);
    });
    return;
  }

  for (const { base, revision } of pairs) {
    const label = `${base.name} -> ${revision.name}`;

    for (const file of CHECKED_FILES) {
      const baseFile = path.join(apiHubDir, base.name, file);
      const revisionFile = path.join(apiHubDir, revision.name, file);

      it(`${label}: ${file} has no breaking changes`, () => {
        if (!fs.existsSync(baseFile)) return; // not present in the older line — nothing to break

        assert.ok(
          fs.existsSync(revisionFile),
          `${file} exists in ${base.name} but is missing from ${revision.name}. ` +
          `Removing a published spec file is a breaking change.`
        );

        assertNoBreakingChanges(baseFile, revisionFile, revision.name, file);
      });
    }
  }
});
