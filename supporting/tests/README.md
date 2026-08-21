# Tests

Run with `npm test`. Tests use the Node built-in runner (`node:test`) and are organised by **which files they apply to**. The folder a test lives in determines its scope; any further restriction is applied inside the test file itself.

## Folders and scope

| Folder | Scope | How it's selected |
| --- | --- | --- |
| `supporting/tests/all/` | Every `-openapi.yaml` file under `dist/`, all versions, all categories. | `findOpenApiFiles(distDir)` in [helpers.js](helpers.js) |
| `supporting/tests/latest/` | Only the latest spec set — for each filename, the newest copy of it that is still current. See [Version ordering](#version-ordering) below. | `findLatestSpecs()` in [helpers.js](helpers.js) |
| `supporting/tests/standards/` | Files under `dist/standards/` only. | Test iterates `dist/standards/` directly. |
| `supporting/tests/api-hub/` | Files under `dist/api-hub/` only. | Test iterates `dist/api-hub/` directly. |
| `supporting/tests/ozone-connect/` | Files under `dist/ozone-connect/` only. | Test iterates `dist/ozone-connect/` directly. |

## Version ordering

A `major.minor` line is revised in stages, and folder names sort in publication order:

```text
v2.2-draft1  <  v2.2-draft2  <  v2.2-rc1  <  v2.2  <  v2.2-errata1  <  v2.2-errata2
      pre-release (drafts, release candidates)   base   erratas (post-publication)
```

Drafts, release candidates and erratas are all mutable working areas whose `info.version` is the folder name verbatim; the base folder is frozen once published. A draft and an rc differ only in ordering — an rc is a draft expected to be final — so every test that asks "is this line published yet?" treats them alike. `parseVersion` / `compareVersions` in [helpers.js](helpers.js) encode this, and every test orders versions through them rather than by comparing errata numbers.

`vX.Y.x` — the api-hub and ozone-connect folder convention — parses as a base folder. Those categories have no pre-release folders of their own, so `isPreReleaseLine()` answers for them from the Standards line of the same `major.minor`.

### The latest set

A minor version is published incrementally: `v2.2-rc1` holds only the specs that version has actually changed, and the rest stay current at `v2.1`. `findLatestSpecs()` therefore assembles the latest set from the newest **two** `major.minor` lines of the current major, newest copy of each filename winning:

- within a line, the highest stage wins — errata over base over rc over draft;
- across lines, a newer line's copy shadows the older one's;
- older lines are excluded, so specs deliberately dropped between minors (e.g. `uae-tpp-reports-openapi.yaml`, which moved from standards to api-hub at v2.1) do not come back.

Once a minor is published complete the older line contributes nothing, so the overlay costs nothing outside the pre-release window. The one case it cannot see is a spec *retired* at a minor boundary — that file lingers in the latest set until the older line drops out of the window.

Tests that compare versions rather than read the latest set follow the same rule: the first revision of a new line (`v2.2-rc1`) is compared against the *effective* set of the previous line, per file, so `uae-product-openapi.yaml` is diffed from `v2.1` while `uae-bank-initiation-openapi.yaml` is diffed from `v2.1-errata3`. Checks that only make sense against a finished line — "no spec files removed", and the api-hub missing-file check — are skipped while the line is still pre-release.

## Per-test restrictions

Anything narrower than the folder scope is encoded inside the test file. Examples:

- [standards/no-breaking-changes.test.js](standards/no-breaking-changes.test.js) uses a `START_VERSIONS` map so a file is only checked from the version where its contract became stable.
- [standards/version-matches-folder.test.js](standards/version-matches-folder.test.js) covers only suffixed folders (`-draftN`, `-rcN`, `-errataN`), whose `info.version` is the folder name. Base folders are out of scope.
- [api-hub/errata-uplift.test.js](api-hub/errata-uplift.test.js) and [ozone-connect/errata-uplift.test.js](ozone-connect/errata-uplift.test.js) skip files whose `info.version` doesn't match the `vX.Y.Z` patch scheme (pre-release versions, date-based versions).

## Adding a test

1. Pick the folder that matches the broadest set of files your test should run against.
2. Import from [helpers.js](helpers.js) (`findOpenApiFiles`, `findLatestSpecs`, `parseVersion`, etc.) rather than re-implementing file discovery.
3. If the test only applies to a subset, filter inside the test file and note *why* in a short comment.
