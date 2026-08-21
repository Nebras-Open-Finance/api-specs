const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');
const distDir = path.join(repoRoot, 'dist');

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

// Stages within a single `major.minor` line, in publication order. Drafts and
// release candidates are both pre-publication working copies of the upcoming
// version — an rc is a draft that is expected to be final — and erratas are
// post-publication revisions of it, so a line reads:
//
//   v2.2-draft1 < v2.2-draft2 < v2.2-rc1 < v2.2 < v2.2-errata1 < v2.2-errata2
//
// Every test that asks "is this line published yet?" treats draft and rc
// alike; only the ordering distinguishes them.
//
// `v2.2.x` (the api-hub / ozone-connect folder convention) is a base folder:
// its patch versions live in `info.version`, not in the folder name.
const STAGE = { draft: 0, rc: 1, base: 2, errata: 3 };

// Folder-name suffix for each pre-base/post-base stage, used by `versionLabel`.
const STAGE_SUFFIX = { [STAGE.draft]: 'draft', [STAGE.rc]: 'rc', [STAGE.errata]: 'errata' };

function parseVersion(versionDir) {
  const match = versionDir.match(/^v(\d+)\.(\d+)(?:\.x)?(?:-(draft|rc|errata)(\d+))?$/);
  if (!match) return null;
  const [, major, minor, kind, number] = match;
  return {
    major: parseInt(major, 10),
    minor: parseInt(minor, 10),
    stage: kind ? STAGE[kind] : STAGE.base,
    // Position within the stage: draft1 -> 1, rc1 -> 1, errata2 -> 2, base -> 0.
    revision: kind ? parseInt(number, 10) : 0,
  };
}

function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.stage !== b.stage) return a.stage - b.stage;
  return a.revision - b.revision;
}

function versionLabel(parsed) {
  const line = `v${parsed.major}.${parsed.minor}`;
  const suffix = STAGE_SUFFIX[parsed.stage];
  return suffix ? `${line}-${suffix}${parsed.revision}` : line;
}

// Every parseable version folder under dist/<category>/, ascending.
function listVersionDirs(category) {
  const categoryDir = path.join(distDir, category);
  if (!fs.existsSync(categoryDir)) return [];
  return fs.readdirSync(categoryDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, parsed: parseVersion(e.name) }))
    .filter(e => e.parsed)
    .sort((a, b) => compareVersions(a.parsed, b.parsed));
}

// True when `major.minor` has only pre-publication folders (drafts, release
// candidates) and no published base yet — i.e. the line is still being
// assembled. Standards is the source of truth: api-hub and ozone-connect track
// the Standards version but their `vX.Y.x` folder names cannot express
// pre-publication-ness, so they inherit the answer from Standards.
function isPreReleaseLine(major, minor) {
  const line = listVersionDirs('standards')
    .filter(v => v.parsed.major === major && v.parsed.minor === minor);
  return line.length > 0 && line.every(v => v.parsed.stage < STAGE.base);
}

// How many `major.minor` lines the latest set is assembled from. A minor is
// published incrementally: `v2.2-rc1` carries only the specs that version
// actually changed, and the rest stay current at `v2.1`. Reaching back one line
// keeps those files in scope; reaching back further would resurrect specs
// deliberately dropped between minors (e.g. `uae-tpp-reports-openapi.yaml`,
// which moved from standards to api-hub at v2.1).
//
// Once a minor is published complete the older line contributes nothing, so the
// overlay costs nothing outside the pre-release window. The one thing it cannot see is
// a spec *retired* at a minor boundary — that file lingers in the latest set
// until the older line drops out of the window.
const LINE_WINDOW = 2;

// The current spec set: for each filename, the newest copy of it that is still
// current. Within a line the highest stage wins (errata over base over rc over draft);
// across lines a newer line's copy shadows the older one's.
function findLatestSpecs(dir = distDir) {
  const products = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  const latestFiles = [];

  for (const product of products) {
    const productDir = path.join(dir, product);
    const versionDirs = fs.readdirSync(productDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name, parsed: parseVersion(e.name) }))
      .filter(e => e.parsed);

    if (versionDirs.length === 0) continue;

    // Only the current major: a major bump is free to drop or rename specs.
    const highestMajor = Math.max(...versionDirs.map(v => v.parsed.major));
    const inMajor = versionDirs.filter(v => v.parsed.major === highestMajor);
    const minorsInWindow = [...new Set(inMajor.map(v => v.parsed.minor))]
      .sort((a, b) => b - a)
      .slice(0, LINE_WINDOW);

    const newestFirst = inMajor
      .filter(v => minorsInWindow.includes(v.parsed.minor))
      .sort((a, b) => compareVersions(b.parsed, a.parsed));

    const specsByName = {};
    for (const { name: versionDir } of newestFirst) {
      const specDir = path.join(productDir, versionDir);
      if (!fs.existsSync(specDir)) continue;

      for (const file of fs.readdirSync(specDir)) {
        if (!file.endsWith('-openapi.yaml')) continue;
        if (!specsByName[file]) {
          specsByName[file] = path.join(specDir, file);
        }
      }
    }

    latestFiles.push(...Object.values(specsByName));
  }

  return latestFiles;
}

// The copy of `file` that is current as at `atParsed` — the newest copy at or
// below that version, within the same major. Lets a config keyed by base version
// (e.g. the permission-code families) name a spec that line did not itself
// change, and pick it up again automatically once it does.
function findEffectiveSpec(category, file, atParsed) {
  const candidate = listVersionDirs(category)
    .filter(v => v.parsed.major === atParsed.major && compareVersions(v.parsed, atParsed) <= 0)
    .reverse()
    .map(v => path.join(distDir, category, v.name, file))
    .find(p => fs.existsSync(p));
  return candidate || null;
}

function relativeToRepo(filePath) {
  return path.relative(repoRoot, filePath);
}

module.exports = {
  distDir,
  repoRoot,
  STAGE,
  findOpenApiFiles,
  findLatestSpecs,
  findEffectiveSpec,
  listVersionDirs,
  isPreReleaseLine,
  parseVersion,
  compareVersions,
  versionLabel,
  relativeToRepo,
};
