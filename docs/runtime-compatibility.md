# Runtime compatibility

The CLI is pinned to Lobu 24.4.0. The app uses a smoke-tested main-branch image with native Linux amd64 and arm64 variants; `runtime.lock.json` records its immutable index digest and source commit. Its package version remains 24.4.0; this pin is not a new stable release. Compose runs the published app with a separate Postgres 18/pgvector database; the app entrypoint applies migrations before starting. The app image serves the native web UI, so no development Vite service is needed.

## Registry freshness and extraction

The pinned image includes the authoritative event-kind registry fixes and Automation dispatch deadlock repair. The installer retains a bounded compatibility retry for older servers: only a newly declared kind, only after verifying its committed declaration, and only within 75 seconds. It never accepts an undeclared kind or suppresses other errors.

The pinned image includes the merged fix for Lobu issue #4651: external Automation extraction schemas expose the declared event metadata contract, including enum guidance and local schema references. Writes still enforce the authoritative kind contract. The supplier prompt also explicitly names `reported` and `retracted`, and the handoff validates the exact source and status before completing a window. Marketplace runtime acceptance runs on native amd64 and ARM runners. A separate financial job rebuilds and verifies the reference catalog, installs all six scenarios, reinstalls without local identity state, and checks persistence after restart.

## Fresh installs and existing volumes

This Compose definition is for a fresh disposable installation. Its database volume is `ontology_pgdata`; it does not migrate an earlier embedded-Postgres `ontology_data` volume. Preserve the old volume and export/restore through Postgres before evaluating an upgrade. Never use `docker compose down -v` on data you want to retain. Runtime CI removes only its own disposable volumes.

## Source ordering

Ordinary shared keys are last-completion-wins across producers. This profile uses revision-qualified identities plus current-source joins. The ordering test completes the newer run first and the older one last.

## Input windows

External Automations read signed, settled arrival windows. The handoff waits until the source is genuinely included, and completes quiet windows. It never fabricates out-of-window citations.

## Resource boundaries

The synthetic workflows are small; the full RDF catalog is larger and imports serially through native event writes. These tests are not a load or resilience certification. Preserve the persistent volume and test restore/upgrades separately.
