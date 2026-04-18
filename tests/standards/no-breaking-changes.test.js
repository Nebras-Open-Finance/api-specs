const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const { distDir, repoRoot, parseVersion, compareVersions } = require('../helpers');

const acceptedChangesRoot = path.join(repoRoot, 'breaking-changes', 'standards');

// Only consider versions at or above this one. Leave empty/null to include
// every version present on disk.
// Format: "v2.1" or "v2.1-errata1".
const START_VERSION = 'v2.1';

const standardsDir = path.join(distDir, 'standards');

function versionLabel(v) {
  return v.errata > 0 ? `v${v.major}.${v.minor}-errata${v.errata}` : `v${v.major}.${v.minor}`;
}

function listVersionDirs() {
  return fs.readdirSync(standardsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, parsed: parseVersion(e.name) }))
    .filter(e => e.parsed)
    .sort((a, b) => compareVersions(a.parsed, b.parsed));
}

function listSpecFiles(versionDirName) {
  const openapiDir = path.join(standardsDir, versionDirName, 'openapi');
  if (!fs.existsSync(openapiDir)) return [];
  return fs.readdirSync(openapiDir).filter(f => f.endsWith('-openapi.yaml'));
}

function groupByMinor(versions) {
  const groups = new Map();
  for (const v of versions) {
    const key = `${v.parsed.major}.${v.parsed.minor}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.parsed.errata - b.parsed.errata);
  }
  return groups;
}

// Effective spec set for a minor: file-by-file, the highest-errata copy wins.
// Returns Map<filename, sourceVersionDirName>.
function effectiveFiles(versionsInMinor) {
  const effective = new Map();
  for (const v of versionsInMinor) {
    for (const f of listSpecFiles(v.name)) {
      effective.set(f, v.name);
    }
  }
  return effective;
}

function buildPairs(versions, startParsed) {
  const pairs = [];
  const groups = groupByMinor(versions);
  const minorKeys = [...groups.keys()].sort((a, b) => {
    const [am, an] = a.split('.').map(Number);
    const [bm, bn] = b.split('.').map(Number);
    return am !== bm ? am - bm : an - bn;
  });

  // Errata pairs within a minor: base -> errata1, errata1 -> errata2, ...
  for (const key of minorKeys) {
    const list = groups.get(key);
    for (let i = 1; i < list.length; i++) {
      const base = list[i - 1];
      const revision = list[i];
      if (startParsed && compareVersions(base.parsed, startParsed) < 0) continue;
      pairs.push({ kind: 'errata', base, revision });
    }
  }

  // Minor pairs within a major: older effective -> newer base.
  for (let i = 1; i < minorKeys.length; i++) {
    const olderList = groups.get(minorKeys[i - 1]);
    const newerList = groups.get(minorKeys[i]);
    if (olderList[0].parsed.major !== newerList[0].parsed.major) continue;
    const newerBase = newerList.find(v => v.parsed.errata === 0);
    if (!newerBase) continue;
    const olderLatest = olderList[olderList.length - 1];
    if (startParsed && compareVersions(olderLatest.parsed, startParsed) < 0) continue;
    pairs.push({ kind: 'minor', olderList, olderLatest, revision: newerBase });
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

function assertNoBreakingChanges(baseFile, revisionFile, revisionDirName, specFileName) {
  const result = spawnSync(
    'oasdiff',
    ['breaking', baseFile, revisionFile, '--fail-on', 'ERR', '--color', 'never', '--format', 'singleline'],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
  );
  if (result.status === 0) return;
  if (result.status === 1) {
    const accepted = loadAcceptedChanges(revisionDirName, specFileName);
    const allErrors = result.stdout.split('\n').filter(line => line.startsWith('error'));
    const unaccepted = allErrors.filter(line => !isAccepted(line, accepted));
    if (unaccepted.length === 0) return;
    const acceptedCount = allErrors.length - unaccepted.length;
    const acceptedNote = acceptedCount > 0 ? ` (${acceptedCount} accepted via breaking-changes/)` : '';
    assert.fail(
      `Found ${unaccepted.length} breaking change(s)${acceptedNote}:\n  ${unaccepted.join('\n  ')}`
    );
  }
  throw new Error(
    `oasdiff exited with status ${result.status}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
}

const startParsed = START_VERSION ? parseVersion(START_VERSION) : null;
if (START_VERSION && !startParsed) {
  throw new Error(`Invalid START_VERSION: ${START_VERSION}`);
}

const versions = listVersionDirs();
const pairs = buildPairs(versions, startParsed);

describe('No breaking changes within a major version (standards)', { skip: !oasdiffAvailable() && 'oasdiff not installed — see https://github.com/oasdiff/oasdiff#installation' }, () => {
  if (pairs.length === 0) {
    it('should have at least one comparison pair', () => {
      assert.fail(`No version pairs found in ${standardsDir} (START_VERSION=${START_VERSION || '<unset>'})`);
    });
    return;
  }

  for (const pair of pairs) {
    if (pair.kind === 'errata') {
      const { base, revision } = pair;
      const label = `${versionLabel(base.parsed)} -> ${versionLabel(revision.parsed)}`;
      const erratFiles = listSpecFiles(revision.name);

      for (const file of erratFiles) {
        const baseFile = path.join(standardsDir, base.name, 'openapi', file);
        if (!fs.existsSync(baseFile)) continue; // new file in errata, not breaking
        const revisionFile = path.join(standardsDir, revision.name, 'openapi', file);
        it(`${label}: ${file} has no breaking changes`, () => {
          assertNoBreakingChanges(baseFile, revisionFile, revision.name, file);
        });
      }
    } else {
      const { olderList, olderLatest, revision } = pair;
      const label = `${versionLabel(olderLatest.parsed)} (effective) -> ${versionLabel(revision.parsed)}`;
      const effective = effectiveFiles(olderList);
      const newerFiles = new Set(listSpecFiles(revision.name));

      it(`${label}: no spec files removed`, () => {
        const removed = [...effective.keys()].filter(f => !newerFiles.has(f));
        assert.deepStrictEqual(
          removed,
          [],
          `Files present in older effective set but missing from ${revision.name} (removal is breaking):\n  ${removed.join('\n  ')}`
        );
      });

      for (const [file, sourceVersion] of effective) {
        if (!newerFiles.has(file)) continue;
        const baseFile = path.join(standardsDir, sourceVersion, 'openapi', file);
        const revisionFile = path.join(standardsDir, revision.name, 'openapi', file);
        it(`${label}: ${file} has no breaking changes (older from ${sourceVersion})`, () => {
          assertNoBreakingChanges(baseFile, revisionFile, revision.name, file);
        });
      }
    }
  }
});
