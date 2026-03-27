# Contributing

Thank you for helping improve these UAE Open Finance API specifications.

## Ways to contribute

- **Bug fixes** — An incorrect path, wrong parameter type, missing field, or broken schema reference
- **New API versions** — When a new spec version is published, add a parallel folder following the existing structure
- **New endpoints** — Endpoints from the published spec that are missing from a file
- **Documentation** — Improvements to README or inline descriptions within the YAML files

## Before you start

- Check existing [issues](../../issues) to avoid duplicate work
- For significant changes (new version, structural refactor) open an issue first to discuss the approach

## How to submit a change

1. Fork this repository
2. Create a branch: `git checkout -b fix/standards-v2.1-account-info` (use a descriptive name)
3. Edit the relevant `.yaml` file(s)
4. Update [README.md](README.md) if you have added new versions or files
5. Open a Pull Request with a clear description of what changed and why

## Keeping specs clean

- All files must be valid OpenAPI 3.x YAML — validate before submitting
- Do not hard-code environment-specific values (sandbox URLs, client IDs, credentials)
- Follow the existing file naming convention: `uae-<domain>-openapi.yaml` or `cbuae-<domain>-openapi.yaml` for v1.2 files
- Preserve the existing folder structure: `dist/<category>/<version>/`
- Do not reformat files wholesale — keep diffs focused on the actual change

## Reporting issues

Open a GitHub issue with:
- Which spec file and version the problem is in
- The path or schema element affected
- What is incorrect and what it should be

## Code of conduct

Be respectful and constructive. This is a community resource for the Open Finance ecosystem.
