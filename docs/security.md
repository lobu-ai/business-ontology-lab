# Evaluation security

Compose publishes only a loopback port. Explicit local-init is a developer convenience for a disposable single-user runtime, not public authentication. Do not change the bind to a public interface.

Hosted evaluations require an authenticated user and narrowly scoped workspace access through the existing platform. Never share an owner session, production credentials, personal browser access or ignored signed-window files.

The access test creates a one-day read-only token in memory and never prints it. It tests token scoping under the owner account, not an independent employee penetration test. Schema permissions are configured before testing an autonomous change; the result must remain pending and the target schema absent.

Financial review fixture records are simulated. Marketplace refund/schema gates are real pending approvals. No test approves them on a person's behalf. No external payment or shipment connector is configured.
