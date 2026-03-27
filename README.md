# UAE Open Finance API Specifications

This repository contains the official OpenAPI specifications used by Third Party Providers (TPPs) and Licensed Financial Institutions (LFIs) participating in the UAE Open Finance ecosystem.

All specifications are in OpenAPI YAML format. The `main` branch always reflects the current live specifications.

## Viewing the Specifications

We recommend [Redocly](https://redocly.github.io/redoc/) for a clean, navigable rendering of any spec file. Paste the raw GitHub URL of a YAML file directly into the Redocly viewer.

## Repository Structure

```
dist/
├── api-hub/          # APIs provided by the API Hub for LFIs to consume
├── standards/        # APIs provided by the API Hub for TPPs to consume
└── ozone-connect/    # APIs provided by LFIs for the API Hub to consume
```

Each category is versioned independently. The most up-to-date version across all categories is **v2.1**.

### API Hub (`dist/api-hub/`)

These specifications describe the APIs that the API Hub exposes **to LFIs**. LFIs integrate against these APIs to participate in the Open Finance ecosystem.


### Standards (`dist/standards/`)

These specifications describe the APIs that the API Hub exposes **to TPPs**. TPPs use these APIs to access financial data and initiate services on behalf of their customers.

### Ozone Connect (`dist/ozone-connect/`)

These specifications describe the APIs that **LFIs must implement** for the API Hub to call. When a TPP makes a valid API request to the API Hub, the API Hub often proxies that request to the relevant LFI using these Ozone Connect APIs.


## API Flow Overview

The API Hub acts as a gateway between TPPs and LFIs. Therefore there is a natural mapping between the **Standards** APIs and the **Ozone Connect** APIs:

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

## Versioning

Specifications follow a `vMAJOR.MINOR` scheme. Errata releases (e.g. `v2.0-errata1`) contain targeted corrections to a published version without incrementing the version number. 

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidance on reporting issues, proposing new endpoints, or submitting corrections.
