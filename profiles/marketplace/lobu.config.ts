import {
  defineConfig,
  defineAgent,
  defineEntityType,
  defineRelationshipType,
  defineAutomation,
  scriptFromFile,
  rulesFromFile,
  viewFromFile,
} from '@lobu/cli/config';
import { TYPES, RELATIONSHIPS, KINDS } from './domain.mjs';
const agent = defineAgent({
  id: 'marketplace-evaluator',
  name: 'Marketplace evaluation agent',
  description: 'Synthetic marketplace evaluation',
  dir: '.',
});
const entities = TYPES.map((t) =>
  defineEntityType({
    key: t.slug,
    name: t.name,
    description: t.description,
    properties: t.metadata_schema.properties,
    required: t.metadata_schema.required,
    ...(t.rules_source ? { rules: rulesFromFile('./rules/refund.ts') } : {}),
  }),
);
const member = defineEntityType({ key: '$member', eventKinds: KINDS });
const relationships = RELATIONSHIPS.map((r) =>
  defineRelationshipType({ key: r.slug, name: r.name, rules: [{ source: r.from, target: r.to }] }),
);
const reconcile = defineAutomation({
  slug: 'market-reconcile',
  agent,
  name: 'Deterministic marketplace reconciliation',
  minCooldownSeconds: 0,
  executor: scriptFromFile('./workflows/reconcile.ts'),
  triggers: [
    {
      kind: 'event',
      source: 'workspace',
      event_types: ['market_risk_signal', 'market_recompute_requested'],
      execution: 'window',
      active_run: 'coalesce',
    },
  ],
  sources: {
    claims:
      "SELECT id,payload_text,metadata FROM events WHERE semantic_type IN ('market_inventory_observation','market_risk_signal')",
  },
});
const normalize = defineAutomation({
  slug: 'market-normalize-inventory',
  agent,
  name: 'Normalize independent stock evidence',
  minCooldownSeconds: 0,
  executor: scriptFromFile('./workflows/normalize.ts'),
  triggers: [],
  sources: {
    inventory:
      "SELECT id,payload_text,metadata FROM events WHERE semantic_type='market_source_document' AND metadata->>'document_type'='inventory'",
  },
});
// setup-workflows.mjs uses the existing API for the external executor and derived collection.
export default defineConfig({
  org: process.env.LOBU_ORG || 'enterprise-ontology',
  orgName: 'Enterprise Ontology Evaluation',
  prune: false,
  agents: [agent],
  entities: [...entities, member],
  relationships,
  automations: [reconcile, normalize],
  views: [viewFromFile('./views/overview.tsx')],
});
