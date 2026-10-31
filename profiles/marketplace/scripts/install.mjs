import fs from 'node:fs/promises';
import { Lobu, state, saveState, ROOT, ORG, writeReport } from '../client.mjs';
import { TYPES, RELATIONSHIPS, KINDS, RECORDS, LINKS, VERSION } from '../domain.mjs';
const c = await Lobu.connect();
const s = await state();
let changes = [];
function applied(x) {
  if (x.status === 'pending_approval' || x.approval_queued || x.blocked_fields)
    throw Error('Installation gated: ' + JSON.stringify(x));
  return x;
}
const { entity_types: types } = await c.call('entitySchema.listTypes', {
  list_scope: 'organization',
});
const existing = new Set(types.map((x) => x.slug));
for (const t of TYPES) {
  applied(
    await c.call(
      existing.has(t.slug) ? 'entitySchema.updateType' : 'entitySchema.createType',
      t,
      true,
    ),
  );
  changes.push({ type: t.slug, existed: existing.has(t.slug) });
}
const member = (await c.call('entitySchema.getType', '$member')).entity_type;
applied(
  await c.call(
    'entitySchema.updateType',
    { slug: '$member', event_kinds: { ...(member.event_kinds || {}), ...KINDS } },
    true,
  ),
);
const { relationship_types: rels } = await c.call('entitySchema.listRelTypes', {
  list_scope: 'organization',
});
const relSet = new Set(rels.map((x) => x.slug));
for (const rel of RELATIONSHIPS) {
  if (!relSet.has(rel.slug))
    applied(
      await c.call(
        'entitySchema.createRelType',
        {
          slug: rel.slug,
          name: rel.name,
          description: 'Synthetic marketplace native relationship',
        },
        true,
      ),
    );
  const rules = (await c.call('entitySchema.listRules', { slug: rel.slug })).rules || [];
  if (
    !rules.some(
      (r) => r.source_entity_type_slug === rel.from && r.target_entity_type_slug === rel.to,
    )
  )
    applied(
      await c.call(
        'entitySchema.addRule',
        { slug: rel.slug, source_entity_type_slug: rel.from, target_entity_type_slug: rel.to },
        true,
      ),
    );
}
const rows = await c.query(
  "SELECT id,slug,entity_type FROM entities WHERE entity_type LIKE 'market-%' LIMIT 100",
);
const bySlug = new Map(rows.map((x) => [x.slug, x]));
for (const record of RECORDS) {
  let r = bySlug.get(record.slug);
  if (!r) {
    const result = applied(
      await c.call(
        'entities.create',
        {
          entity_type: record.type,
          slug: record.slug,
          name: record.name,
          metadata: record.metadata,
        },
        true,
      ),
    );
    r = result.entity;
    if (!r) throw Error('Missing entity receipt ' + record.slug);
  }
  s.entities[record.slug] = Number(r.id);
}
await saveState(s);
// The server is authoritative. Local state is a convenience, not the only record
// of which fixture edges already exist (for example, after cloning on another host).
async function existingLink(type, from, to) {
  const page = await c.call('entities.listLinks', {
    entity_id: s.entities[from],
    direction: 'outbound',
    limit: 100,
  });
  if (page.metadata?.has_more || page.relationship_failures?.length) {
    throw new Error('Cannot safely reconstruct an incomplete fixture relationship page');
  }
  return (page.relationships || []).find(
    (edge) =>
      edge.relationship_type_slug === type &&
      Number(edge.from_entity_id) === s.entities[from] &&
      Number(edge.to_entity_id) === s.entities[to],
  );
}
for (const [type, from, to] of LINKS) {
  const key = [type, from, to].join('|');
  let edge = await existingLink(type, from, to);
  if (!edge) {
    try {
      const result = applied(
        await c.call(
          'entities.link',
          {
            from_entity_id: s.entities[from],
            to_entity_id: s.entities[to],
            relationship_type_slug: type,
            source: 'api',
            metadata: { synthetic: true, demo_suite: VERSION },
          },
          true,
        ),
      );
      edge = result.relationship;
    } catch (error) {
      // A concurrent installer may win the same edge. Re-read and verify the
      // exact endpoints; never suppress an unrelated authorization/schema error.
      if (
        error.code !== 'VALIDATION' ||
        !/active relationship.*already exists/i.test(error.message)
      )
        throw error;
      edge = await existingLink(type, from, to);
      if (!edge) throw error;
    }
  }
  if (!edge?.id) throw new Error('Missing relationship receipt');
  s.links[key] = Number(edge.id);
  await saveState(s);
}

if (!s.agent) {
  const agents = (await c.call('agents.list', {})).agents || [];
  const found = agents.find((a) => a.id === 'marketplace-evaluator');
  if (found) s.agent = found.id;
}
if (!s.agent) {
  const a = applied(
    await c.call(
      'agents.create',
      {
        agent_id: 'marketplace-evaluator',
        name: 'Marketplace evaluation agent',
        identity_md:
          'Synthetic marketplace only. Require human review before business sanctions or payment. Use exact evidence revisions and native components.',
      },
      true,
    ),
  );
  s.agent = a.agent_id;
  await saveState(s);
}
await saveState(s);
const summary = {
  at: new Date().toISOString(),
  org: ORG,
  version: VERSION,
  types: TYPES.length,
  relationships: RELATIONSHIPS.length,
  records: RECORDS.length,
  links: LINKS.length,
  changes,
};
await writeReport('installation', summary);
console.log(JSON.stringify(summary));
