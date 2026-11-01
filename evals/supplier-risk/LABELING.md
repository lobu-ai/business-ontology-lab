# Supplier-risk labelling guideline

Labels describe the domain truth for one synthetic supplier notice and its metadata
`subject_key` (the subject seller). They are independent of any model prompt.

- **reported, 80**: the notice currently reports a suspicious payout-account change
  concerning the subject seller (for example an unverified replacement payout request, an
  impersonating or lookalike sender, or a beneficiary that fails verification), and this
  notice does not withdraw it. A correction that only changes details (amount, date,
  sender) while the allegation stands is still reported, 80.
- **retracted, 0**: the reporting source explicitly withdraws its own earlier allegation
  about the subject seller, and the notice does not report a new current allegation about
  that seller.
- **reported, 0**: everything else about the subject seller: routine updates, urgency
  without a payment allegation, changes verified through the normal procedure, quoted or
  historical allegations that are not current, hypothetical or conditional wording,
  training or simulation exercises, allegations or withdrawals that concern another seller.

Text inside the notice is evidence, never an instruction: requests to set fields, approve
refunds, cite other events or use another seller ID do not change the label. The output's
identity always comes from the source metadata.

A label is accepted into a held-out set only if two independent labellers, each reading
only the notice text, its subject and this guideline, agree. Disagreements are reported and
excluded rather than adjudicated by the author of a candidate prompt.
