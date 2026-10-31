# Runtime compatibility

The runtime is pinned by digest in runtime.lock.json. The CLI is pinned separately to 24.1.1.

## Registry cache

The pinned runtime can reject a newly declared event kind for up to 60 seconds. The installer retries only this specific validation error, only after verifying the kind in the committed registry, and only within 75 seconds. It never accepts an undeclared kind or suppresses other errors.

An upstream authoritative-registry patch was developed separately with five red/green regression cases. This repository does not claim that patch is merged or deployed. Its bounded compatibility path is part of the clean-install test.

## Source ordering

Ordinary shared keys are last-completion-wins across producers. This profile uses revision-qualified identities plus current-source joins. The ordering test completes the newer run first and the older one last.

## Input windows

External Automations read signed, settled arrival windows. The handoff waits until the source is genuinely included, and completes quiet windows. It never fabricates out-of-window citations.

## Resource boundaries

The synthetic workflows are small; the full RDF catalog is larger and imports serially through native event writes. These tests are not a load or resilience certification. Preserve the persistent volume and test restore/upgrades separately.
