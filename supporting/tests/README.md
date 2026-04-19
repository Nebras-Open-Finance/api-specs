# Tests

Run with `npm test`. Tests use the Node built-in runner (`node:test`) and are organised by **which files they apply to**. The folder a test lives in determines its scope; any further restriction is applied inside the test file itself.

## Folders and scope

| Folder | Scope | How it's selected |
| --- | --- | --- |
| `supporting/tests/all/` | Every `-openapi.yaml` file under `dist/`, all versions, all categories. | `findOpenApiFiles(distDir)` in [helpers.js](helpers.js) |
| `supporting/tests/latest/` | Only the latest spec set. For each product, the highest `major.minor` is taken, with errata files overriding the base file-by-file. Older `major.minor` lines are not included. | `findLatestSpecs()` in [helpers.js](helpers.js) |
| `supporting/tests/standards/` | Files under `dist/standards/` only. | Test iterates `dist/standards/` directly. |
| `supporting/tests/api-hub/` | Files under `dist/api-hub/` only. | Test iterates `dist/api-hub/` directly. |
| `supporting/tests/ozone-connect/` | Files under `dist/ozone-connect/` only. | Test iterates `dist/ozone-connect/` directly. |

## Per-test restrictions

Anything narrower than the folder scope is encoded inside the test file. Examples:

- [standards/no-breaking-changes.test.js](standards/no-breaking-changes.test.js) uses a `START_VERSIONS` map so a file is only checked from the version where its contract became stable.
- [api-hub/errata-uplift.test.js](api-hub/errata-uplift.test.js) and [ozone-connect/errata-uplift.test.js](ozone-connect/errata-uplift.test.js) skip files whose `info.version` doesn't match the `vX.Y.Z` patch scheme (drafts, date-based versions).

## Adding a test

1. Pick the folder that matches the broadest set of files your test should run against.
2. Import from [helpers.js](helpers.js) (`findOpenApiFiles`, `findLatestSpecs`, `parseVersion`, etc.) rather than re-implementing file discovery.
3. If the test only applies to a subset, filter inside the test file and note *why* in a short comment.
