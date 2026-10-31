import React, { useState } from 'react';
import { defineView, useQuery, useAction } from '@lobu/views';
import {
  Card,
  DataTable,
  Link,
  LoadingState,
  ErrorState,
  EmptyState,
  TruncatedNotice,
} from '@lobu/views/components';
export const view = defineView({
  key: 'marketplace-evaluation',
  name: 'Marketplace risk & operations',
  description:
    'A working native-primitive evaluation, with evidence and human approval boundaries.',
  attach: [{ workspace: true }],
  actions: { recompute: { emits: 'market_recompute_requested' } },
});
export default function Overview() {
  const q = useQuery(
    "export default async(ctx,client)=>{const result=await client.entities.list({entity_type:'market-decision',limit:100,sort_by:'name',sort_order:'asc'});return {rows:result.entities.map(row=>row.metadata),has_more:result.metadata?.has_more===true};}",
  );
  const recompute = useAction('recompute');
  const [actionError, setActionError] = useState('');
  const rows = q.data?.rows || [];
  return (
    <>
      <Card title="Marketplace risk & operations">
        <p>
          Synthetic data. Decisions are advisory: no payments, shipments or stock reservations are
          executed.
        </p>
        <p>
          <Link href="market-order">Orders</Link> · <Link href="market-seller">Sellers</Link> ·{' '}
          <Link href="market-refund">Refund proposals</Link> ·{' '}
          <Link href="data">Schemas and relationships</Link> ·{' '}
          <Link href="automations">Automations</Link>
        </p>
      </Card>
      <Card
        title="Evidence-backed decisions"
        actions={
          <button
            type="button"
            onClick={async () => {
              setActionError('');
              try {
                await recompute({ reason: 'User requested a fresh advisory decision' });
              } catch (e) {
                setActionError(String(e));
              }
            }}
          >
            Recompute using native Automation
          </button>
        }
      >
        <p>
          Independent reports remain separate. Superseded source evidence is excluded until
          re-extracted. Follow the decision event number in the native event browser for provenance.
        </p>
        {actionError && <ErrorState message={actionError} />}{' '}
        {q.loading && <LoadingState text="Reading current decisions…" />}
        {q.error && <ErrorState message={q.error} errorCode={q.errorCode} />}{' '}
        {!q.loading && !q.error && rows.length === 0 && (
          <EmptyState title="Run the marketplace workflow to create decisions." />
        )}
        {!q.loading && !q.error && rows.length > 0 && (
          <DataTable
            columns={[
              { key: 'order_key', header: 'Order' },
              { key: 'disposition', header: 'Decision' },
              { key: 'available_quantity', header: 'Reported stock' },
              { key: 'risk_score', header: 'Candidate risk' },
              { key: 'conflicting', header: 'Conflict' },
              { key: 'event_id', header: 'Evidence event' },
            ]}
            rows={rows}
            keyOf={(r) => r.order_key}
          />
        )}
        {(q.truncated || q.data?.has_more) && <TruncatedNotice shown={rows.length} />}
      </Card>
      <Card title="Inspect and challenge the model">
        <p>
          <Link href="market-decision">Open the native decision collection</Link>. Correct an
          inventory source, withdraw one supplier claim, or propose a refund authorization. The same
          schemas, Automation runs, source history and approvals are available to an external scoped
          agent.
        </p>
        <p>
          Fraud suspicion is not a conclusion. A model cannot approve a refund or turn a candidate
          signal into an external sanction.
        </p>
      </Card>
    </>
  );
}
