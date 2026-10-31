import React from 'react';
import { defineView, useQuery } from '@lobu/views';
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
  key: 'financial-ontology',
  name: 'Financial ontology',
  description: 'Native records, qualified financial roles, evidence and the pinned FIBO catalog.',
  attach: [{ workspace: true }],
});
export default function FinancialOntology() {
  const data = useQuery(
    "export default async(ctx,client)=>{const rows=await client.entities.list({entity_type:'ownership-observation',limit:100});return {rows:rows.entities.map(x=>x.metadata),has_more:rows.metadata?.has_more===true};}",
  );
  const rows = data.data?.rows || [];
  return (
    <>
      <Card title="Financial ontology">
        <p>
          Synthetic financial scenarios mapped to the pinned FIBO vocabulary. Definitions are
          reference data; observations retain independent sources, dates and revisions.
        </p>
        <p>
          <Link href="company">Companies</Link> · <Link href="party-role">Contextual roles</Link> ·{' '}
          <Link href="financial-instrument">Instruments</Link> · <Link href="loan">Loans</Link> ·{' '}
          <Link href="portfolio">Portfolios</Link> ·{' '}
          <Link href="corporate-action">Corporate actions</Link>
        </p>
      </Card>
      <Card title="Source-specific ownership reports">
        {data.loading && <LoadingState text="Reading reports…" />}
        {data.error && <ErrorState message={data.error} errorCode={data.errorCode} />}{' '}
        {!data.loading && !data.error && rows.length === 0 && (
          <EmptyState title="Install the financial fixture first." />
        )}
        {!data.loading && !data.error && rows.length > 0 && (
          <DataTable
            columns={[
              { key: 'owner', header: 'Owner' },
              { key: 'subject', header: 'Subject' },
              { key: 'percentage', header: 'Percent' },
              { key: 'basis', header: 'Basis' },
              { key: 'source', header: 'Source' },
              { key: 'as_of', header: 'As of' },
              { key: 'status', header: 'Status' },
              { key: 'evidence_event_id', header: 'Exact evidence' },
            ]}
            rows={rows}
            keyOf={(r) => r.observation_key}
          />
        )}{' '}
        {(data.truncated || data.data?.has_more) && <TruncatedNotice shown={rows.length} />}
      </Card>
      <Card title="Inspect the reference model">
        <p>
          <Link href="ontology-class">Classes</Link> ·{' '}
          <Link href="ontology-property">Properties</Link> ·{' '}
          <Link href="ontology-module">Modules</Link> ·{' '}
          <Link href="ontology-axiom">Asserted RDF statements</Link> ·{' '}
          <Link href="source-document">Evidence</Link> ·{' '}
          <Link href="data">Native schema graph</Link>
        </p>
        <p>
          Imported OWL restrictions are inspectable, not automatically enforced as closed-world
          rules. The reference import retains one documented unresolved upstream import. Simulated
          financial reviews are fixtures, not real approvals; the marketplace profile exercises real
          approval gates.
        </p>
      </Card>
    </>
  );
}
