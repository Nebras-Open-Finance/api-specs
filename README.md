# UAE Open Finance API Specifications

This repository contains the official API specifications used by Third Party Providers (TPPs) and Licensed Financial Institutions (LFIs) participating in the UAE Open Finance ecosystem.

The OpenAPI YAML files in this repository are the **source of truth**.

## Branches

- **`main`** — the live source of truth. Everything on `main` is considered **published, authoritative, and externally consumable** by the wider ecosystem.
- **Other branches** — used for drafts of future content (for example a forthcoming `v2.2`). The Nebras Open Finance team will announce when draft content on a non-`main` branch is ready for ecosystem review.

New implementers should work from the latest version on `main`.

## Viewing the Specifications

We recommend [Redocly](https://redocly.github.io/redoc/) for a clean, navigable rendering of any spec file. Paste the raw GitHub URL of a YAML file directly into the Redocly viewer.

## Repository Structure


```
dist/
├── api-hub/          # APIs the API Hub exposes to LFIs
├── standards/        # APIs the API Hub exposes to TPPs
└── ozone-connect/    # APIs that LFIs implement for the API Hub to consume
```


Each category contains one folder per version, and each version folder contains the OpenAPI 3.x YAML files directly:

```
dist/standards/vX.Y/
├── uae-account-information-openapi.yaml
├── uae-atm-openapi.yaml
└── ...
```

### API Hub (`dist/api-hub/`)

Specifications for the APIs that the API Hub exposes **to LFIs**. LFIs integrate against these APIs to participate in the Open Finance ecosystem (for example, to consume consent and event services from the Hub).

### Standards (`dist/standards/`)

Specifications for the APIs that the API Hub exposes **to TPPs**. TPPs use these APIs to access account, payment, and other Open Finance services on behalf of their customers.

### Ozone Connect (`dist/ozone-connect/`)

Specifications for the APIs that **LFIs must implement** for the API Hub to call. When a TPP makes a valid request to the API Hub, the API Hub proxies the relevant call to the appropriate LFI's Ozone Connect endpoint.

## API Flow Overview

The API Hub sits between TPPs and LFIs as the single point of mediation. There is a natural mapping between the **Standards** APIs (TPP-facing) and the **Ozone Connect** APIs (LFI-facing): the Hub validates and translates between them on every request.



```
+======================================================================+
|                  AlTareq Trust Framework (Directory)                 |
|----------------------------------------------------------------------|
|                                                                      |
|                      +-------------------------+                     |
|                      |           TPP           |                     |
|                      +------------+------------+                     |
|                                   |                                  |
|                 +-----------------+-----------------+                |
|                 |                 |                 |                |
|             +---v---+         +---v---+         +---v---+            |
|             |API Hub|         |API Hub|   ...   |API Hub|            |
|             +-------+         +-------+         +-------+            |
|                 |                 |                 |                |
|                 |                 |                 |                |
|             +---v---+         +---v---+         +---v---+            |
|             | LFI 1 |         | LFI 2 |   ...   | LFI N |            |
|             +-------+         +-------+         +-------+            |
|                                                                      |
+======================================================================+
```

TPPs never call LFIs directly — all traffic flows through the API Hub.

## Versioning

Specifications follow a `vMAJOR.MINOR` scheme. When you see `v2.1` in this repository it refers to the same logical release across all three categories:

- `dist/api-hub/v2.1.x/` and `dist/ozone-connect/v2.1.x/` hold the v2.1 line for the Hub-to-LFI and LFI-to-Hub interfaces.
- `dist/standards/v2.1/` holds the v2.1 line for the TPP-facing interface.

Errata releases (for example `dist/standards/v2.1-errata1/`) contain targeted corrections to a published version without incrementing the version number. **Where an errata folder exists, the files inside it supersede the corresponding base version.**

## Governance folders

`supporting/` holds everything that sits alongside the specs without being part of the published surface — tests, accepted breaking changes, and a forward-looking design backlog.

### `supporting/breaking-changes/`

Records breaking changes that have been **knowingly accepted** within an errata release. Each entry names the oasdiff rule, the affected endpoints, a sign-off, and a rationale. Enforced by [supporting/tests/standards/no-breaking-changes.test.js](supporting/tests/standards/no-breaking-changes.test.js): any breaking change flagged by oasdiff must have a matching entry here, or the test fails. This keeps the bar high without blocking corrections when the team genuinely decides a change is worth making.

Structure mirrors `dist/`:

```text
supporting/breaking-changes/
└── standards/
    └── vX.Y-errataN/
        └── <spec-basename>/
            └── breaking-changes.yaml
```

### `supporting/future-updates/`

Records **recommended changes to defer to the next major version**. Entries are non-urgent design improvements that would be breaking inside a pre-vN.0 errata context but are sensible to apply when the major is cut. Each entry describes the proposed change, affected schemas/endpoints, a proposer, and a rationale. Not enforced by tests — purely a forward-looking design backlog.

Structure mirrors `supporting/breaking-changes/`, scoped to the target major version:

```text
supporting/future-updates/
├── standards/
│   └── v3.0/
│       └── <spec-basename>/
│           └── future-updates.yaml
└── ozone-connect/
    └── v3.0.x/
        └── <spec-basename>/
            └── future-updates.yaml
```

## License

This repository is published under the [MIT License](LICENSE) and is freely available for the UAE Open Finance ecosystem and the wider community to read, reference, and build against.

## Contributing

Issues and pull requests are welcome from LFIs, TPPs, vendors, and the wider community. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidance on reporting issues, proposing new endpoints, and submitting corrections.
