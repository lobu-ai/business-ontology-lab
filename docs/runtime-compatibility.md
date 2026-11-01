# Runtime compatibility

The app and CLI are pinned to Lobu 24.4.0. `runtime.lock.json` records the app image digest and release source commit. Compose runs the published app with a separate Postgres 18/pgvector database; the app entrypoint applies migrations before starting. The app image serves the native web UI, so no development Vite service is needed.

## Registry freshness and extraction

The pinned release includes the authoritative event-kind registry fixes and Automation dispatch deadlock repair. The installer retains a bounded compatibility retry for older servers: only a newly declared kind, only after verifying its committed declaration, and only within 75 seconds. It never accepts an undeclared kind or suppresses other errors.

Lobu issue #4651 tracks event-kind metadata missing from external Automation extraction schemas. The pinned 24.4.0 release still exposes generic event metadata in that schema; writes enforce the declared kind contract. The supplier prompt therefore explicitly names `reported` and `retracted`, and the handoff validates the exact source and status before completing a window. A later core fix must be released and pinned before claiming the extraction schema itself includes the enum.

## Fresh installs and existing volumes

This Compose definition is for a fresh disposable installation. Its database volume is `ontology_pgdata`; it does not migrate an earlier embedded-Postgres `ontology_data` volume. Preserve the old volume and export/restore through Postgres before evaluating an upgrade. Never use `docker compose down -v` on data you want to retain. Runtime CI removes only its own disposable volumes.

## Source ordering

Ordinary shared keys are last-completion-wins across producers. This profile uses revision-qualified identities plus current-source joins. The ordering test completes the newer run first and the older one last.

## Input windows

External Automations read signed, settled arrival windows. The handoff waits until the source is genuinely included, and completes quiet windows. It never fabricates out-of-window citations.

## Resource boundaries

The synthetic workflows are small; the full RDF catalog is larger and imports serially through native event writes. These tests are not a load or resilience certification. Preserve the persistent volume and test restore/upgrades separately.
