/** This rule narrows writes regardless of caller. It never performs a payment. */
export default (row) => {
  if (row.op === 'create' && row.next.status !== 'draft') row.deny('Refunds must start as draft');
  if (row.op !== 'update') return;
  if (
    ['approved', 'paid'].includes(row.committed.status) &&
    ['amount', 'currency', 'order_key'].some((key) => row.changed(key))
  )
    row.deny('Authorized refund terms are immutable');
  if (!row.changed('status')) return;
  const allowed = {
    draft: ['proposed', 'rejected'],
    proposed: ['approved', 'rejected'],
    approved: ['paid', 'rejected'],
    paid: [],
    rejected: [],
  };
  if (!(allowed[row.committed.status] || []).includes(row.next.status))
    row.deny('Invalid refund transition ' + row.committed.status + ' → ' + row.next.status);
  if (row.next.status === 'approved')
    row.escalate(['status'], 'Refund authorization requires a human reviewer');
};
