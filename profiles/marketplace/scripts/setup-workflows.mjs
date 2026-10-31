import fs from 'node:fs/promises';
import { Lobu, state, saveState, ROOT, writeReport, applied, sleep } from '../client.mjs';
import { bundleScript } from './compile.mjs';
const c = await Lobu.connect();
const s = await state();
async function authoritativeCreate(input) {
  // Compatibility with an older runtime's 60-second registry cache. Never retry
  // a genuine undefined kind: verify its committed declaration before waiting.
  const deadline = Date.now() + 75000;
  for (;;) {
    try {
      return applied(await c.call('automations.create', input, true));
    } catch (e) {
      const match = /Invalid event type '([^']+)'/.exec(e.message);
      if (e.code !== 'VALIDATION' || !match || Date.now() >= deadline) throw e;
      const member = (await c.call('entitySchema.getType', '$member')).entity_type;
      if (!member?.event_kinds?.[match[1]]) throw e;
      await sleep(1250);
    }
  }
}
async function ensure(key, input) {
  const list = (await c.call('automations.list', {})).automations || [];
  const found = list.find((x) => x.slug === input.slug);
  if (found) {
    s.automations[key] = String(found.id || found.automation_id);
    applied(
      await c.call(
        'automations.update',
        {
          automation_id: s.automations[key],
          execution_config: input.execution_config,
          min_cooldown_seconds: input.min_cooldown_seconds,
          triggers: input.triggers,
        },
        true,
      ),
    );
  } else {
    const result = await authoritativeCreate(input);
    if (!result.automation_id) throw new Error('Missing Automation create receipt');
    s.automations[key] = String(result.automation_id);
  }
  await saveState(s);
}
const common = { managed_agent_id: s.agent, min_cooldown_seconds: 0 };
await ensure('reconcile', {
  ...common,
  slug: 'market-reconcile',
  name: 'Deterministic marketplace reconciliation',
  sources: [
    {
      name: 'claims',
      query:
        "SELECT id,payload_text,metadata FROM events WHERE semantic_type IN ('market_inventory_observation','market_risk_signal')",
    },
  ],
  triggers: [
    {
      kind: 'event',
      source: 'workspace',
      event_types: ['market_risk_signal', 'market_recompute_requested'],
      execution: 'window',
      active_run: 'coalesce',
    },
  ],
  execution_config: {
    executor: { kind: 'script', source: await bundleScript(ROOT + 'workflows/reconcile.ts') },
  },
});
await ensure('normalize', {
  ...common,
  slug: 'market-normalize-inventory',
  name: 'Normalize independent stock evidence',
  sources: [
    {
      name: 'inventory',
      query:
        "SELECT id,payload_text,metadata FROM events WHERE semantic_type='market_source_document' AND metadata->>'document_type'='inventory'",
    },
  ],
  triggers: [],
  execution_config: {
    executor: {
      kind: 'script',
      source: await bundleScript(ROOT + 'workflows/normalize.ts'),
      params: { reconcile_automation_id: s.automations.reconcile },
    },
  },
});
await ensure('extract', {
  ...common,
  slug: 'market-extract-supplier-risk',
  name: 'LLM supplier-evidence extraction',
  triggers: [],
  execution_config: { executor: { kind: 'external' } },
  prompt: await fs.readFile(ROOT + 'prompts/extract-supplier.md', 'utf8'),
  sources: [
    {
      name: 'supplier_notices',
      query:
        "SELECT id,payload_text,metadata FROM events WHERE semantic_type='market_source_document' AND metadata->>'document_type'='supplier_notice'",
    },
  ],
  outputs: {
    signals: {
      event: 'market_risk_signal',
      key: ['source_scope', 'source_record_key', 'statement_slot', 'source_revision'],
    },
  },
});
const properties = {
  order_key: { type: 'string', title: 'Order' },
  name: { type: 'string', title: 'Decision' },
  disposition: {
    type: 'string',
    enum: ['eligible', 'review', 'hold', 'cancelled'],
    'x-table-column': true,
    'x-facet': true,
  },
  available_quantity: { type: 'number', title: 'Reported availability', 'x-table-column': true },
  risk_score: { type: 'number', title: 'Candidate risk', 'x-table-column': true },
  conflicting: { type: 'boolean', title: 'Conflicting sources' },
  event_id: { type: 'integer', title: 'Decision event' },
};
const sql =
  "SELECT metadata->>'order_key' AS order_key,title AS name,metadata->>'disposition' AS disposition,(metadata->>'available_quantity')::integer AS available_quantity,(metadata->>'risk_score')::numeric AS risk_score,(metadata->>'conflicting')::boolean AS conflicting,id AS event_id FROM events WHERE semantic_type='market_decision' AND metadata->>'demo_suite'='enterprise-marketplace-v1'";
const types = (await c.call('entitySchema.listTypes', { list_scope: 'organization' })).entity_types;
if (!types.some((t) => t.slug === 'market-decision'))
  applied(
    await c.call(
      'entitySchema.createType',
      {
        slug: 'market-decision',
        name: 'Current advisory decisions',
        description:
          'Source-backed advisory decisions; no payment, reservation or shipment side effects.',
        metadata_schema: {
          type: 'object',
          'x-lobu-record-key': 'order_key',
          properties: Object.fromEntries(
            Object.entries(properties).map(([key, value]) => [key, { ...value, readOnly: true }]),
          ),
        },
        backing: { sql },
      },
      true,
    ),
  );
await writeReport('automation-setup', {
  at: new Date().toISOString(),
  automations: s.automations,
  agent: s.agent,
});
console.log(JSON.stringify({ automations: s.automations, agent: s.agent }));
