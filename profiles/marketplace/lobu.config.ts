import {
  defineConfig,
  defineAgent,
  defineEntityType,
  defineRelationshipType,
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
// Runtime Automations require workspace-local IDs. bootstrap installs them through
// setup-workflows.mjs after entities, agent and policies are ready. This file
// declares the model and view; applying it alone does not install the workflows.
export default defineConfig({
  org: process.env.LOBU_ORG || 'enterprise-ontology',
  orgName: 'Enterprise Ontology Evaluation',
  prune: false,
  agents: [agent],
  entities: [...entities, member],
  relationships,
  views: [viewFromFile('./views/overview.tsx')],
});
