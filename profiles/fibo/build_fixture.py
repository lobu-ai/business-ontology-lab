import json
from collections import Counter
from pathlib import Path

OUT = Path(__file__).parent
SUITE = "financial-ontology-demo-v2"
FIBO = "https://spec.edmcouncil.org/fibo/ontology/"
COMMONS_ROLES = "https://www.omg.org/spec/Commons/RolesAndCompositions/"
entities = []
relationships = []
documents = []
observations = []


def entity(typ, slug, name, **metadata):
    key = f"{typ}:{slug}"
    entities.append({"key": key, "type": typ, "slug": slug, "name": name,
                     "metadata": {"demo_key": slug, "synthetic": True,
                                  "demo_suite": SUITE, **metadata}})
    return key


def link(typ, source, target, evidence, **metadata):
    relationships.append({
        "key": f"{typ}|{source}|{target}", "type": typ, "from_key": source,
        "to_key": target, "source": "api", "evidence_document_key": evidence,
        "metadata": {"synthetic": True, "demo_suite": SUITE,
                     "evidence_document_key": evidence, **metadata},
    })


def document(slug, scope, record, rev, title, text, *, date="2025-12-31", supersedes=None, partial=False, entity_keys=None):
    key = f"document:{slug}@{rev}"
    documents.append({
        "key": key, "logical_key": f"document:{slug}", "source_scope": scope,
        "source_record_key": record, "source_revision": rev, "title": title,
        "source_url": f"https://{scope}.example.invalid/{record}",
        "as_of": date, "occurred_at": f"{date}T12:00:00Z", "supersedes_key": supersedes,
        "partial_update": partial, "entity_keys": entity_keys or [],
        "content": "SYNTHETIC DEMONSTRATION DOCUMENT. All organizations, people, registrations, instruments and facts in this document are fictional. No identifier is a real LEI, ISIN or government registration.\n\n" + text,
        "metadata": {"synthetic": True, "demo_suite": SUITE, "source_scope": scope,
                     "source_record_key": record, "source_revision": rev,
                     "as_of": date, "partial_update": partial},
    })
    return key


def obs(kind, logical_key, document_key, slot, text, *, entity_keys, scenario_keys,
        date="2025-12-31", status="reported", review="unreviewed", **metadata):
    doc = next(x for x in documents if x["key"] == document_key)
    version_key = f"{logical_key}@{doc['source_revision']}"
    observations.append({
        "key": version_key, "logical_key": logical_key, "semantic_type": kind,
        "source_document_key": document_key, "entity_keys": entity_keys,
        "content": text,
        "metadata": {
            "source_scope": doc["source_scope"], "source_record_key": doc["source_record_key"],
            "source_revision": doc["source_revision"], "statement_slot": slot,
            "as_of": date, "status": status, "review_status": review,
            "mapping_version": SUITE, "synthetic": True, "demo_suite": SUITE,
            "scenario_keys": scenario_keys, "logical_observation_key": logical_key,
            **metadata,
        },
    })
    return version_key


J = {}
for slug, name in [("demo-northland", "Demo Northland"), ("demo-eastmere", "Demo Eastmere"), ("demo-southport", "Demo Southport")]:
    J[slug] = entity("jurisdiction", slug, name, jurisdiction_kind="fictional_country",
                     description="Fictional jurisdiction for the ontology demo; no ISO country code is claimed.")

C = {}
company_specs = [
    ("demo-atlas", "Demo Atlas Holdings", "demo-northland", "holding_company", "Diversified synthetic group parent."),
    ("demo-beacon", "Demo Beacon Robotics", "demo-northland", "corporation", "Robotics manufacturer with ordinary and non-voting preferred equity."),
    ("demo-cedar-energy", "Demo Cedar Energy", "demo-eastmere", "corporation", "Energy operator and issuer of a fixed-rate bond."),
    ("demo-delta-logistics", "Demo Delta Logistics", "demo-southport", "corporation", "Logistics operator with a working-capital loan."),
    ("demo-ember-labs", "Demo Ember Labs", "demo-southport", "corporation", "Technology company held through several ownership paths."),
    ("demo-fjord-finance", "Demo Fjord Finance", "demo-eastmere", "financial_institution", "Fictional lender, bond issuer and treasury-portfolio manager."),
    ("demo-grove-asset-management", "Demo Grove Asset Management", "demo-northland", "investment_manager", "Manages portfolios for clients; management is not ownership."),
    ("demo-harbor-registrar", "Demo Harbor Registrar", "demo-northland", "registrar", "Fictional administrator of the demo's explicit identifier schemes."),
]
for slug, name, jurisdiction, form, description in company_specs:
    C[slug] = entity("company", slug, name, legal_name=name, jurisdiction_key=J[jurisdiction],
                     jurisdiction=jurisdiction, legal_form=form, description=description)

P = {}
for slug, name, title in [
    ("demo-morgan-vale", "Demo Morgan Vale", "Atlas chief executive and private investor"),
    ("demo-taylor-stone", "Demo Taylor Stone", "Atlas finance director and private investor"),
    ("demo-alex-reed", "Demo Alex Reed", "Ember chief executive"),
    ("demo-jamie-park", "Demo Jamie Park", "Grove portfolio manager and simulated demo analyst"),
]:
    P[slug] = entity("person", slug, name, display_name=name, description=title,
                     person_kind="fictional_natural_person")

S = {}
for slug, name, scheme_kind in [
    ("demo-company-register", "Demo Company Register", "synthetic_company_registration"),
    ("demo-security-register", "Demo Security Register", "synthetic_security_registration"),
    ("demo-party-register", "Demo Party Register", "synthetic_person_reference"),
    ("demo-workspace-key", "Demo Workspace Key Scheme", "synthetic_application_identifier"),
]:
    S[slug] = entity("identifier-scheme", slug, name, scheme_kind=scheme_kind,
                     namespace=slug, description="Explicitly synthetic scheme. Not LEI, ISIN, CUSIP, or an official registration system.")

I = {}
instrument_specs = [
    ("demo-beacon-ordinary", "Demo Beacon Ordinary Shares", "equity", "demo-beacon", "ordinary", 1, 2_000_000),
    ("demo-beacon-preferred", "Demo Beacon Preferred Shares", "equity", "demo-beacon", "preferred", 0, 200_000),
    ("demo-cedar-ordinary", "Demo Cedar Ordinary Shares", "equity", "demo-cedar-energy", "ordinary", 1, 500_000),
    ("demo-atlas-ordinary", "Demo Atlas Ordinary Shares", "equity", "demo-atlas", "ordinary", 1, 1_000_000),
    ("demo-delta-ordinary", "Demo Delta Ordinary Shares", "equity", "demo-delta-logistics", "ordinary", 1, 400_000),
    ("demo-ember-ordinary", "Demo Ember Ordinary Shares", "equity", "demo-ember-labs", "ordinary", 1, 750_000),
    ("demo-grove-ordinary", "Demo Grove Ordinary Shares", "equity", "demo-grove-asset-management", "ordinary", 1, 100_000),
    ("demo-cedar-green-bond", "Demo Cedar 4% Bond 2031", "bond", "demo-cedar-energy", None, None, 1_000),
    ("demo-fjord-senior-bond", "Demo Fjord 5.5% Bond 2030", "bond", "demo-fjord-finance", None, None, 2_000),
]
for slug, name, kind, issuer, share_class, votes, units in instrument_specs:
    meta = {"instrument_kind": kind, "issuer_key": C[issuer], "currency": "USD", "issued_units": units,
            "terms_as_of": "2026-01-02" if slug == "demo-beacon-ordinary" else "2025-12-31"}
    if kind == "equity":
        meta.update(share_class=share_class, voting_rights_per_share=votes)
    else:
        meta.update(face_value_per_unit=1_000, coupon_frequency="semiannual", coupon_type="fixed",
                    annual_coupon_percent=4 if slug == "demo-cedar-green-bond" else 5.5,
                    issue_date="2025-01-15" if slug == "demo-cedar-green-bond" else "2025-06-30",
                    maturity_date="2031-01-15" if slug == "demo-cedar-green-bond" else "2030-06-30")
    I[slug] = entity("financial-instrument", slug, name, **meta)

L = {}
loan_specs = [
    ("demo-cedar-expansion-loan", "Demo Cedar Expansion Loan", "demo-cedar-energy", 2_000_000, 4.5, "2025-07-01", "2030-06-30", None),
    ("demo-delta-working-capital-loan", "Demo Delta Working Capital Loan", "demo-delta-logistics", 500_000, 6.0, "2025-09-01", "2027-09-01", "demo-atlas"),
]
for slug, name, borrower, amount, rate, start, maturity, guarantor in loan_specs:
    L[slug] = entity("loan", slug, name, lender_key=C["demo-fjord-finance"], borrower_key=C[borrower],
                     principal_amount=amount, currency="USD", annual_interest_percent=rate,
                     rate_basis="fixed", start_date=start, maturity_date=maturity,
                     guarantor_key=C[guarantor] if guarantor else None)

F = {}
portfolio_specs = [
    ("demo-growth-portfolio", "Demo Growth Portfolio", P["demo-morgan-vale"], C["demo-grove-asset-management"], "growth"),
    ("demo-income-portfolio", "Demo Income Portfolio", P["demo-taylor-stone"], C["demo-grove-asset-management"], "income"),
    ("demo-atlas-treasury-portfolio", "Demo Atlas Treasury Portfolio", C["demo-atlas"], C["demo-fjord-finance"], "treasury"),
]
for slug, name, owner, manager, strategy in portfolio_specs:
    F[slug] = entity("portfolio", slug, name, owner_key=owner, manager_key=manager, strategy=strategy,
                     reporting_currency="USD", description="Fictional portfolio. Quantities are reported holdings, not a recommendation or valuation.")

A = {}
A["demo-beacon-split-2026"] = entity("corporate-action", "demo-beacon-split-2026", "Demo Beacon 2-for-1 Ordinary Share Split",
    action_type="stock_split", instrument_key=I["demo-beacon-ordinary"], issuer_key=C["demo-beacon"],
    announcement_date="2025-12-01", effective_date="2026-01-02", action_status="effective",
    ratio_numerator=2, ratio_denominator=1,
    description="Every ordinary share becomes two ordinary shares. Preferred shares are outside this action. This quantity adjustment does not establish a market value.")
A["demo-cedar-coupon-2026-01"] = entity("corporate-action", "demo-cedar-coupon-2026-01", "Demo Cedar January 2026 Coupon Payment",
    action_type="coupon_payment", instrument_key=I["demo-cedar-green-bond"], issuer_key=C["demo-cedar-energy"],
    announcement_date="2026-01-05", record_date="2026-01-12", effective_date="2026-01-15", action_status="paid",
    coupon_per_unit=20, currency="USD", description="Synthetic semiannual payment: USD 1,000 face × 4% annual coupon ÷ 2 = USD 20 per bond unit.")

# Thirty-eight identifiers, all under conspicuously synthetic schemes.
identifier_targets = []
for slug, key in C.items():
    identifier_targets.append(("company", slug, key, S["demo-company-register"], "DEMO-C-" + slug.removeprefix("demo-").upper(), "registration"))
    identifier_targets.append(("company", slug, key, S["demo-workspace-key"], key, "workspace"))
for slug, key in I.items():
    identifier_targets.append(("instrument", slug, key, S["demo-security-register"], "DEMO-S-" + slug.removeprefix("demo-").upper(), "registration"))
    identifier_targets.append(("instrument", slug, key, S["demo-workspace-key"], key, "workspace"))
for slug, key in P.items():
    identifier_targets.append(("person", slug, key, S["demo-party-register"], "DEMO-P-" + slug.removeprefix("demo-").upper(), "registration"))
for kind, slug, target, scheme, value, suffix in identifier_targets:
    entity("identifier", f"{slug}-{suffix}", f"Demo identifier · {value}", identifier_value=value,
           scheme_key=scheme, identifies_key=target, identifier_kind="synthetic", validity="demo_only")

# Source records. Sources are content events, never extra document entities.
master_lines = [f"{name}; legal form {form}; jurisdiction {jurisdiction}." for _, name, jurisdiction, form, _ in company_specs]
master_lines += ["All identifiers in this export use the listed DEMO schemes and have no official registration status."]
master_lines += ["Board records: Morgan Vale is a director of Atlas and Cedar; Taylor Stone is a director of Atlas and Delta; Alex Reed is a director of Ember; Jamie Park is a director of Grove. These appointments commenced on 2025-01-01 and are reported current as of 2025-12-31. All four are fictional demo people."]
master_lines += ["Employment records: Demo Morgan Vale is chief executive of Demo Atlas Holdings; Demo Taylor Stone is finance director of Demo Atlas Holdings; Demo Alex Reed is chief executive of Demo Ember Labs; Demo Jamie Park is portfolio manager at Demo Grove Asset Management."]
master_lines += ["Demo Harbor Registrar administers the four schemes Demo Company Register, Demo Security Register, Demo Party Register and Demo Workspace Key Scheme. The following explicit identifier records form part of this export:"]
master_lines += [f"{x['metadata']['identifier_value']}; scheme {x['metadata']['scheme_key']}; identifies {x['metadata']['identifies_key']}." for x in entities if x["type"] == "identifier"]
master = document("company-master", "demo-registry", "company-master-2025", "r1", "Demo company and identifier register", "\n".join(master_lines), entity_keys=list(C.values()) + list(P.values()) + list(J.values()))
instrument_text = "\n".join(f"{x['name']}: {json.dumps(x['metadata'], ensure_ascii=False)}" for x in entities if x["type"] == "financial-instrument")
instrument_text += "\nAll listed instruments are maintained by Demo Harbor Registrar. Their explicitly dated terms are part of this instrument master. Identifier records:\n" + "\n".join(f"{x['metadata']['identifier_value']}; scheme {x['metadata']['scheme_key']}; identifies {x['metadata']['identifies_key']}." for x in entities if x["type"] == "identifier" and x["metadata"]["identifies_key"].startswith("financial-instrument:"))
instrument_doc = document("instrument-master", "demo-security-register", "instrument-master-2025", "r1", "Demo instrument master — 2 January 2026", instrument_text, date="2026-01-02", entity_keys=list(I.values()) + list(C.values()))
mandates = document("portfolio-mandates", "demo-custodian", "portfolio-mandates-2025", "r1", "Demo portfolio mandates", "\n".join(f"{name}: owned by {owner}; managed by {manager}; strategy {strategy}. Management does not transfer beneficial ownership to the manager." for _, name, owner, manager, strategy in portfolio_specs), entity_keys=list(F.values()) + list(P.values()) + list(C.values()))
loan_doc = document("loan-register", "demo-contract-office", "loan-register-2025", "r1", "Demo loan agreements", "\n".join(f"{name}: lender Demo Fjord Finance; borrower {borrower}; principal USD {amount}; fixed annual interest {rate}%; start {start}; maturity {maturity}; guarantor {guarantor or 'none'}." for slug, name, borrower, amount, rate, start, maturity, guarantor in loan_specs), entity_keys=list(L.values()) + list(C.values()))

ownership_rows = [
    (C["demo-atlas"], C["demo-cedar-energy"], 80, "ordinary"),
    (C["demo-atlas"], C["demo-delta-logistics"], 30, "ordinary"),
    (C["demo-cedar-energy"], C["demo-delta-logistics"], 25, "ordinary"),
    (C["demo-beacon"], C["demo-ember-labs"], 60, "ordinary"),
    (C["demo-atlas"], C["demo-ember-labs"], 10, "ordinary"),
    (P["demo-morgan-vale"], C["demo-atlas"], 55, "ordinary"),
    (P["demo-taylor-stone"], C["demo-atlas"], 15, "ordinary"),
    (P["demo-alex-reed"], C["demo-ember-labs"], 5, "ordinary"),
    (C["demo-fjord-finance"], C["demo-grove-asset-management"], 25, "ordinary"),
    (C["demo-atlas"], C["demo-beacon"], 20, "preferred"),
]
ownership_doc = document("ownership-register", "demo-registry", "ownership-register-2025", "r1", "Demo ownership register", "As of 2025-12-31, the following equity interests are reported. Percentages are specific to the stated share class. The register is partial; unlisted interests are unknown, not zero.\n" + "\n".join(f"{a} owns {pct}% of {b}'s {cl} equity." for a, b, pct, cl in ownership_rows), entity_keys=list(C.values()) + list(P.values()))
analyst_doc = document("beacon-analyst", "demo-analyst-research", "beacon-ownership-2025", "r1", "Demo analyst report on Beacon", "As of 2025-12-31, this analyst source reports that Demo Atlas Holdings owns 47% of Demo Beacon Robotics ordinary equity. This differs from the independent Demo Registry's corrected 45% report. This analyst claim has not been reviewed. Preferred equity is outside the scope of this statement.", entity_keys=[C["demo-atlas"], C["demo-beacon"]])
vendor1 = document("cedar-vendor", "demo-vendor", "cedar-ownership-2025", "r1", "Demo vendor Cedar ownership report — initial", "As of 2025-12-31, Demo Atlas Holdings owns 78% of Demo Cedar Energy ordinary equity, according to this initial vendor report.", entity_keys=[C["demo-atlas"], C["demo-cedar-energy"]])
vendor2 = document("cedar-vendor", "demo-vendor", "cedar-ownership-2025", "r2", "Demo vendor Cedar ownership report — corrected", "Correction to the same statement: as of 2025-12-31, Demo Atlas Holdings owns 80%, not 78%, of Demo Cedar Energy ordinary equity. The change corrects the source's earlier figure; it is not a purchase of another 2% stake.", supersedes=vendor1, entity_keys=[C["demo-atlas"], C["demo-cedar-energy"]])
voting_doc = document("voting-register", "demo-voting-office", "voting-rights-2025", "r1", "Demo voting-rights register", "As of 2025-12-31, Demo Atlas Holdings is reported to exercise 72% of Demo Beacon Robotics voting rights under a voting agreement, 80% of Demo Cedar Energy voting rights, and 30% of Demo Delta Logistics voting rights. These percentages describe voting rights across voting shares and must not be substituted for equity percentages. Beacon preferred shares are non-voting.", entity_keys=[C[x] for x in ["demo-atlas", "demo-beacon", "demo-cedar-energy", "demo-delta-logistics"]])
control_doc = document("control-agreements", "demo-contract-office", "board-appointment-agreements", "r1", "Demo board appointment agreements", "Three source claims are explicitly recorded: Atlas may appoint 5 of Beacon's 7 board seats under an agreement effective 2025-06-01 through 2027-06-01; Atlas may appoint 5 of Cedar's 7 seats under an agreement effective 2025-01-01 through 2027-12-31; Cedar may appoint 4 of Delta's 7 seats under an agreement effective 2025-03-01 through 2027-03-01. These are evidence claims about appointment rights, not inferences from equity percentages. The Beacon agreement is pending analyst review.", entity_keys=[C[x] for x in ["demo-atlas", "demo-beacon", "demo-cedar-energy", "demo-delta-logistics"]])

holding_rows = [
    ("demo-growth-portfolio", "demo-beacon-ordinary", 1_000, "shares"),
    ("demo-growth-portfolio", "demo-beacon-preferred", 500, "shares"),
    ("demo-growth-portfolio", "demo-cedar-ordinary", 800, "shares"),
    ("demo-income-portfolio", "demo-cedar-green-bond", 10, "bond_units"),
    ("demo-income-portfolio", "demo-fjord-senior-bond", 20, "bond_units"),
    ("demo-atlas-treasury-portfolio", "demo-beacon-ordinary", 25_000, "shares"),
    ("demo-atlas-treasury-portfolio", "demo-cedar-green-bond", 50, "bond_units"),
]
holding_docs = {}
for portfolio in F:
    rows = [x for x in holding_rows if x[0] == portfolio]
    holding_docs[(portfolio, "r1")] = document(portfolio + "-positions", "demo-custodian", portfolio + "-positions", "r1", "Demo positions — " + portfolio, "Positions as of 2025-12-31:\n" + "\n".join(f"{F[p]} holds {q} {unit} of {I[i]}." for p, i, q, unit in rows), entity_keys=[F[portfolio]] + [I[i] for _, i, _, _ in rows])
for portfolio, quantity in [("demo-growth-portfolio", 2_000), ("demo-atlas-treasury-portfolio", 50_000)]:
    holding_docs[(portfolio, "r2")] = document(portfolio + "-positions", "demo-custodian", portfolio + "-positions", "r2", "Demo split adjustment — " + portfolio, f"Partial position amendment effective 2026-01-02: {F[portfolio]} now holds {quantity} Demo Beacon ordinary shares following the 2-for-1 split. This is a corporate-action quantity adjustment, not a source error correction. Other positions are not restated by this amendment and must not be retracted merely because they are absent.", date="2026-01-02", supersedes=holding_docs[(portfolio, "r1")], partial=True, entity_keys=[F[portfolio], I["demo-beacon-ordinary"]])

split_doc = document("beacon-split", "demo-issuer-notice", "beacon-split-2026", "r1", "Demo Beacon split notice", "Effective 2026-01-02, each Demo Beacon ordinary share became two ordinary shares. Total ordinary shares changed from 1,000,000 to 2,000,000. Preferred shares did not participate. The split alone does not alter a holder's percentage of ordinary equity, and this notice makes no claim about market price or investment value.", date="2026-01-02", entity_keys=[A["demo-beacon-split-2026"], I["demo-beacon-ordinary"], C["demo-beacon"]])
coupon_doc = document("cedar-coupon", "demo-paying-agent", "cedar-coupon-2026-01", "r1", "Demo Cedar coupon notice", "The Demo Cedar 4% Bond 2031 pays a fixed annual coupon of 4% on USD 1,000 face value per bond unit in two equal installments. On 2026-01-15 a synthetic payment of USD 20 per bond unit was made. The notice records Demo Income Portfolio's entitlement as 10 units and USD 200, and Demo Atlas Treasury Portfolio's entitlement as 50 units and USD 1,000. These are fictitious payment facts, not a forecast or market valuation.", date="2026-01-15", entity_keys=[A["demo-cedar-coupon-2026-01"], I["demo-cedar-green-bond"], F["demo-income-portfolio"], F["demo-atlas-treasury-portfolio"]])
review_doc = document("simulated-review-log", "demo-review-fixture", "review-batch-2026-01", "r1", "Simulated analyst review log", "This is a simulated review fixture, not actual user approval and not an executed Lobu approval action. Fictional analyst Demo Jamie Park accepts the corrected vendor Cedar figure of 80% as a demonstration review decision. The analyst's Beacon 47% equity claim and Beacon board-appointment control claim remain pending review. No decision in this document resolves the registry/analyst Beacon disagreement.", date="2026-01-16", entity_keys=[P["demo-jamie-park"], C["demo-beacon"], C["demo-cedar-energy"]])

# Parties and contextual roles are distinct resources. A company is never typed as
# a Shareholder, Borrower, Lender or Issuer merely because it plays that role.
role_specs = []
issuer_roles = {}
shareholder_roles = {}
loan_roles = {}
instrument_for_equity = {(C[issuer], cl): I[slug] for slug, _, kind, issuer, cl, _, _ in instrument_specs if kind == "equity"}


def party_role(slug, name, role_kind, player, context, source_doc, ontology_class_iri, **metadata):
    role_key = entity("party-role", slug, name, role_kind=role_kind, role_player_key=player,
                      context_key=context, ontology_class_iri=ontology_class_iri,
                      source_document_key=source_doc, **metadata)
    role_specs.append((role_key, player, context, source_doc))
    return role_key


for slug, name, kind, issuer, _, _, _ in instrument_specs:
    issuer_roles[I[slug]] = party_role("demo-issuer-" + slug.removeprefix("demo-"),
        "Demo issuer role · " + name.removeprefix("Demo "), "issuer", C[issuer], I[slug], instrument_doc,
        FIBO + ("SEC/Equities/EquityInstruments/ShareIssuer" if kind == "equity" else "FBC/FinancialInstruments/FinancialInstruments/Issuer"), instrument_key=I[slug])
    next(e for e in entities if e["key"] == I[slug])["metadata"]["issuer_role_key"] = issuer_roles[I[slug]]

for owner, subject, pct, share_class in ownership_rows + [(C["demo-atlas"], C["demo-beacon"], 47, "ordinary")]:
    instrument = instrument_for_equity[(subject, share_class)]
    role_source = analyst_doc if subject == C["demo-beacon"] and share_class == "ordinary" else ownership_doc
    shareholder_roles[(owner, subject, share_class)] = party_role(
        "demo-shareholder-" + owner.split(":", 1)[1].removeprefix("demo-") + "-" + subject.split(":", 1)[1].removeprefix("demo-") + "-" + share_class,
        "Demo shareholder role · " + owner.split(":", 1)[1].removeprefix("demo-") + " in " + subject.split(":", 1)[1].removeprefix("demo-") + " " + share_class,
        "shareholder", owner, instrument, role_source,
        FIBO + "BE/OwnershipAndControl/CorporateOwnership/Shareholder", subject_key=subject,
        instrument_key=instrument, share_class=share_class,
        assertion_policy="Role participation is source asserted; percentage and review status remain on individual observations.")

for slug, _, borrower, _, _, _, _, guarantor in loan_specs:
    for kind, player in [("borrower", C[borrower]), ("lender", C["demo-fjord-finance"])] + ([("guarantor", C[guarantor])] if guarantor else []):
        role_class = FIBO + ("FBC/DebtAndEquities/Debt/" + kind.title() if kind in {"borrower", "lender"} else "FBC/DebtAndEquities/Guaranty/Guarantor")
        loan_roles[(slug, kind)] = party_role("demo-" + kind + "-" + slug.removeprefix("demo-"),
            "Demo " + kind + " role · " + slug.removeprefix("demo-"), kind, player, L[slug], loan_doc,
            role_class, loan_key=L[slug], ontology_inference_policy="Use the explicit source assertion; no unimplemented OWL entailment or control inference is claimed.")
    loan_entity = next(e for e in entities if e["key"] == L[slug])
    loan_entity["metadata"].update(borrower_role_key=loan_roles[(slug, "borrower")], lender_role_key=loan_roles[(slug, "lender")],
                                   guarantor_role_key=loan_roles.get((slug, "guarantor")))

# Structural graph. No company-company ownership edge silently collapses conflicting evidence.
for slug, _, jurisdiction, _, _ in company_specs:
    link("registered_in", C[slug], J[jurisdiction], master)
for e in entities:
    if e["type"] == "identifier":
        link("identifies", e["key"], e["metadata"]["identifies_key"], master if not e["metadata"]["identifies_key"].startswith("financial-instrument:") else instrument_doc)
        link("uses_identifier_scheme", e["key"], e["metadata"]["scheme_key"], master)
for slug, _, _, issuer, _, _, _ in instrument_specs:
    link("issued_by", I[slug], issuer_roles[I[slug]], instrument_doc)
    link("registered_by", I[slug], C["demo-harbor-registrar"], instrument_doc)
for person, company in [("demo-morgan-vale", "demo-atlas"), ("demo-morgan-vale", "demo-cedar-energy"), ("demo-taylor-stone", "demo-atlas"), ("demo-taylor-stone", "demo-delta-logistics"), ("demo-alex-reed", "demo-ember-labs"), ("demo-jamie-park", "demo-grove-asset-management")]:
    link("director_of", P[person], C[company], master, valid_from="2025-01-01", as_of="2025-12-31")
for person, company, role in [("demo-morgan-vale", "demo-atlas", "chief_executive"), ("demo-taylor-stone", "demo-atlas", "finance_director"), ("demo-alex-reed", "demo-ember-labs", "chief_executive"), ("demo-jamie-park", "demo-grove-asset-management", "portfolio_manager")]:
    link("employed_by", P[person], C[company], master, role=role, as_of="2025-12-31")
for slug, _, owner, manager, _ in portfolio_specs:
    link("managed_by", F[slug], manager, mandates)
    link("owned_by", F[slug], owner, mandates)
for portfolio, instrument, _, _ in holding_rows:
    link("has_holding_in", F[portfolio], I[instrument], holding_docs[(portfolio, "r2" if (portfolio, "r2") in holding_docs and instrument == "demo-beacon-ordinary" else "r1")], meaning="Reported position exists; quantities and dates live on holding observations.")
for slug, _, borrower, _, _, _, _, guarantor in loan_specs:
    link("loan-has-lender", L[slug], loan_roles[(slug, "lender")], loan_doc)
    link("loan-has-borrower", L[slug], loan_roles[(slug, "borrower")], loan_doc)
    if guarantor:
        link("guaranteed_by", L[slug], loan_roles[(slug, "guarantor")], loan_doc)
for action, instrument, issuer, doc in [("demo-beacon-split-2026", "demo-beacon-ordinary", "demo-beacon", split_doc), ("demo-cedar-coupon-2026-01", "demo-cedar-green-bond", "demo-cedar-energy", coupon_doc)]:
    link("affects_instrument", A[action], I[instrument], doc)
    link("announced_by", A[action], C[issuer], doc)
for scheme in S.values():
    link("administered_by", scheme, C["demo-harbor-registrar"], master)
for role, player, context, source_doc in role_specs:
    link("role-played-by", role, player, source_doc)
    link("role-in-context", role, context, source_doc)
for (owner, subject, share_class), role in shareholder_roles.items():
    instrument = instrument_for_equity[(subject, share_class)]
    role_entity = next(e for e in entities if e["key"] == role)
    link("holds-shares-in", role, issuer_roles[instrument], role_entity["metadata"]["source_document_key"],
         instrument_key=instrument, share_class=share_class,
         assertion_policy="Participation link only; this link does not choose a canonical ownership percentage.")

# Evidence observations. Common key tuple is (source_scope, source_record_key, statement_slot).
for owner, subject, pct, share_class in ownership_rows:
    logical = "ownership:registry:" + owner.split(":", 1)[1] + ":" + subject.split(":", 1)[1] + ":" + share_class
    obs("ownership_observation", logical, ownership_doc, f"{owner}|{subject}|{share_class}",
        f"Synthetic registry reports {owner} holds {pct}% of {subject}'s {share_class} equity as of 2025-12-31.",
        entity_keys=[owner, subject, shareholder_roles[(owner, subject, share_class)], instrument_for_equity[(subject, share_class)]], scenario_keys=["ownership-network", "indirect-paths"],
        owner_key=owner, owner_role_key=shareholder_roles[(owner, subject, share_class)], subject_key=subject,
        instrument_key=instrument_for_equity[(subject, share_class)], percentage=pct, basis="equity", share_class=share_class)
analyst_observation = obs("ownership_observation", "ownership:analyst:atlas-beacon:ordinary", analyst_doc, "atlas-beacon-ordinary",
    "Synthetic analyst reports Atlas owns 47% of Beacon ordinary equity. This conflicts with the independent registry's corrected 45% claim.",
    entity_keys=[C["demo-atlas"], C["demo-beacon"], shareholder_roles[(C["demo-atlas"], C["demo-beacon"], "ordinary")], I["demo-beacon-ordinary"]], scenario_keys=["conflicting-sources", "indirect-paths"],
    review="pending_review", owner_key=C["demo-atlas"], subject_key=C["demo-beacon"], percentage=47,
    basis="equity", share_class="ordinary", owner_role_key=shareholder_roles[(C["demo-atlas"], C["demo-beacon"], "ordinary")], instrument_key=I["demo-beacon-ordinary"])
for pct, doc, review in [(78, vendor1, "unreviewed"), (80, vendor2, "accepted_simulated")]:
    vendor_observation = obs("ownership_observation", "ownership:vendor:atlas-cedar:ordinary", doc, "atlas-cedar-ordinary",
        f"Synthetic vendor reports Atlas owns {pct}% of Cedar ordinary equity as of 2025-12-31.",
        entity_keys=[C["demo-atlas"], C["demo-cedar-energy"], shareholder_roles[(C["demo-atlas"], C["demo-cedar-energy"], "ordinary")], I["demo-cedar-ordinary"]], scenario_keys=["correction-and-review"],
        review=review, owner_key=C["demo-atlas"], subject_key=C["demo-cedar-energy"], percentage=pct,
        basis="equity", share_class="ordinary", owner_role_key=shareholder_roles[(C["demo-atlas"], C["demo-cedar-energy"], "ordinary")], instrument_key=I["demo-cedar-ordinary"], change_reason="source_correction" if pct == 80 else "initial_report")

for subject, pct in [("demo-beacon", 72), ("demo-cedar-energy", 80), ("demo-delta-logistics", 30)]:
    obs("voting_observation", f"voting:atlas:{subject}", voting_doc, f"atlas-{subject}-votes",
        f"Synthetic voting register attributes {pct}% of {subject}'s voting rights to Atlas; this is not an equity percentage.",
        entity_keys=[C["demo-atlas"], C[subject]], scenario_keys=["equity-voting-control"],
        holder_key=C["demo-atlas"], subject_key=C[subject], percentage=pct, basis="voting_rights", share_class="all_voting_shares")
controls = [
    ("demo-atlas", "demo-beacon", 5, "2025-06-01", "2027-06-01", "pending_review"),
    ("demo-atlas", "demo-cedar-energy", 5, "2025-01-01", "2027-12-31", "unreviewed"),
    ("demo-cedar-energy", "demo-delta-logistics", 4, "2025-03-01", "2027-03-01", "unreviewed"),
]
for controller, subject, seats, start, end, review in controls:
    key = obs("control_observation", f"control:{controller}:{subject}", control_doc, f"{controller}-{subject}-board",
        f"Synthetic agreement reports {controller} can appoint {seats} of {subject}'s 7 board seats. This assertion is supported by the agreement, not inferred from an ownership percentage.",
        entity_keys=[C[controller], C[subject]], scenario_keys=["equity-voting-control"], review=review,
        controller_key=C[controller], subject_key=C[subject], control_basis="board_appointment_agreement",
        appointable_board_seats=seats, total_board_seats=7, valid_from=start, valid_to=end,
        inference_status="source_asserted")
    if subject == "demo-beacon":
        beacon_control_observation = key

for portfolio, instrument, quantity, unit in holding_rows:
    obs("holding_observation", f"holding:{portfolio}:{instrument}", holding_docs[(portfolio, "r1")], instrument,
        f"Synthetic custodian reports {F[portfolio]} holds {quantity} {unit} of {I[instrument]} as of 2025-12-31.",
        entity_keys=[F[portfolio], I[instrument]], scenario_keys=["split-and-holdings", "instruments-and-loans"],
        portfolio_key=F[portfolio], instrument_key=I[instrument], quantity=quantity, quantity_unit=unit, change_reason="initial_report")
for portfolio, quantity in [("demo-growth-portfolio", 2_000), ("demo-atlas-treasury-portfolio", 50_000)]:
    obs("holding_observation", f"holding:{portfolio}:demo-beacon-ordinary", holding_docs[(portfolio, "r2")], "demo-beacon-ordinary",
        f"Synthetic split amendment reports {F[portfolio]} holds {quantity} Beacon ordinary shares after the 2-for-1 split, effective 2026-01-02. Other positions remain as last reported.",
        entity_keys=[F[portfolio], I["demo-beacon-ordinary"], A["demo-beacon-split-2026"]], scenario_keys=["split-and-holdings"],
        date="2026-01-02", portfolio_key=F[portfolio], instrument_key=I["demo-beacon-ordinary"],
        quantity=quantity, quantity_unit="shares", change_reason="corporate_action_adjustment", corporate_action_key=A["demo-beacon-split-2026"])

for slug, _, borrower, principal, rate, start, maturity, guarantor in loan_specs:
    obs("loan_observation", f"loan-terms:{slug}", loan_doc, slug,
        f"Synthetic contract records a USD {principal} loan from Fjord to {borrower}, fixed annual interest {rate}%, maturity {maturity}.",
        entity_keys=[L[slug], C["demo-fjord-finance"], C[borrower], loan_roles[(slug, "lender")], loan_roles[(slug, "borrower")]] + ([C[guarantor], loan_roles[(slug, "guarantor")]] if guarantor else []),
        scenario_keys=["instruments-and-loans"], loan_key=L[slug], lender_key=C["demo-fjord-finance"],
        borrower_key=C[borrower], principal_amount=principal, currency="USD", annual_interest_percent=rate,
        rate_basis="fixed", start_date=start, maturity_date=maturity, guarantor_key=C[guarantor] if guarantor else None,
        lender_role_key=loan_roles[(slug, "lender")], borrower_role_key=loan_roles[(slug, "borrower")],
        guarantor_role_key=loan_roles.get((slug, "guarantor")))

obs("corporate_action_observation", "action:beacon-split", split_doc, "beacon-ordinary-split",
    "Synthetic issuer confirms a 2-for-1 ordinary-share split: issued ordinary shares increased from 1,000,000 to 2,000,000 effective 2026-01-02. Preferred shares did not participate.",
    entity_keys=[A["demo-beacon-split-2026"], I["demo-beacon-ordinary"], C["demo-beacon"]], scenario_keys=["split-and-holdings"],
    date="2026-01-02", action_key=A["demo-beacon-split-2026"], instrument_key=I["demo-beacon-ordinary"], issuer_key=C["demo-beacon"],
    action_type="stock_split", action_status="effective", effective_date="2026-01-02", ratio_numerator=2,
    ratio_denominator=1, issued_units_before=1_000_000, issued_units_after=2_000_000)
obs("corporate_action_observation", "action:cedar-coupon", coupon_doc, "cedar-2026-01-coupon",
    "Synthetic paying-agent notice records USD 20 paid per Cedar bond unit on 2026-01-15; Income Portfolio's stated entitlement is USD 200 and Atlas Treasury's USD 1,000.",
    entity_keys=[A["demo-cedar-coupon-2026-01"], I["demo-cedar-green-bond"], C["demo-cedar-energy"], F["demo-income-portfolio"], F["demo-atlas-treasury-portfolio"]],
    scenario_keys=["instruments-and-loans"], date="2026-01-15", action_key=A["demo-cedar-coupon-2026-01"],
    instrument_key=I["demo-cedar-green-bond"], issuer_key=C["demo-cedar-energy"], action_type="coupon_payment",
    action_status="paid", effective_date="2026-01-15", coupon_per_unit=20, currency="USD",
    entitlements=[{"portfolio_key": F["demo-income-portfolio"], "units": 10, "amount": 200},
                  {"portfolio_key": F["demo-atlas-treasury-portfolio"], "units": 50, "amount": 1000}])

for slot, target, verdict, reason in [
    ("cedar-correction-accepted", vendor_observation, "accepted_simulated", "The corrected vendor statement matches the independent 80% registry statement. This is a simulated analyst decision."),
    ("beacon-equity-pending", analyst_observation, "pending_review", "The 47% analyst claim still disagrees with the registry's 45%; no winning source has been selected."),
    ("beacon-control-pending", beacon_control_observation, "pending_review", "The board appointment agreement awaits review; voting percentage alone is not substituted for review."),
]:
    obs("review_decision", "review:" + slot, review_doc, slot, reason,
        entity_keys=[P["demo-jamie-park"]], scenario_keys=["correction-and-review"], date="2026-01-16",
        review=verdict, subject_observation_version_key=target, decision=verdict,
        reviewer_key=P["demo-jamie-park"], simulated=True, actor_kind="synthetic_fixture",
        approval_effect="none", rationale=reason)

relationship_types = []
type_names = {
    "registered_in": ("Registered in", "The fictional legal registration jurisdiction."),
    "identifies": ("Identifies", "An identifier identifies a specific retained record."),
    "uses_identifier_scheme": ("Uses identifier scheme", "The scheme defining the identifier's namespace."),
    "issued_by": ("Issued by issuer role", "The contextual issuer role for this instrument; role-played-by identifies the legal entity."),
    "registered_by": ("Registered by", "The demo registrar maintaining the instrument record."),
    "director_of": ("Director of", "A stated board role, with dates where supplied."),
    "employed_by": ("Employed by", "A stated employment role; distinct from ownership."),
    "managed_by": ("Managed by", "A portfolio management mandate; does not imply ownership."),
    "owned_by": ("Portfolio owned by", "The portfolio's named owner, separate from its manager."),
    "has_holding_in": ("Has reported holding in", "Position navigation only. Quantity, date and evidence are on the holding observation."),
    "loan-has-lender": ("Has lender role", "The lender role in a loan agreement, distinct from the legal party playing it."),
    "loan-has-borrower": ("Has borrower role", "The borrower role in a loan agreement, distinct from the legal party playing it."),
    "guaranteed_by": ("Guaranteed by", "The guarantor role stated by the synthetic loan agreement."),
    "affects_instrument": ("Affects instrument", "The instrument to which a corporate action applies."),
    "announced_by": ("Announced by", "The issuer responsible for the corporate-action notice."),
    "administered_by": ("Administered by", "The administrator of a synthetic identifier scheme."),
    "role-played-by": ("Role played by", "A contextual role is played by a legal company or fictional natural person."),
    "role-in-context": ("Role in context", "The instrument or loan in whose context the party plays this role."),
    "holds-shares-in": ("Shareholder holds shares in issuer", "A Shareholder role relates to an Issuer role; percentages and evidence remain on observations."),
}
verified_property_iris = {
    "issued_by": FIBO + "FND/Relations/Relations/isIssuedBy",
    "guaranteed_by": FIBO + "FBC/DebtAndEquities/Guaranty/hasGuarantor",
    "role-played-by": COMMONS_ROLES + "isPlayedBy",
    "role-in-context": COMMONS_ROLES + "isRoleIn",
    "loan-has-borrower": FIBO + "FBC/DebtAndEquities/Debt/hasBorrower",
    "loan-has-lender": FIBO + "FBC/DebtAndEquities/Debt/hasLender",
    "holds-shares-in": FIBO + "FBC/FinancialInstruments/FinancialInstruments/holdsSharesIn",
}
entity_by_key = {e["key"]: e for e in entities}
for typ in sorted(type_names):
    links = [r for r in relationships if r["type"] == typ]
    pairs = sorted({(entity_by_key[r["from_key"]]["type"], entity_by_key[r["to_key"]]["type"]) for r in links})
    relationship_types.append({"slug": typ, "name": type_names[typ][0], "description": type_names[typ][1],
                               "allowed_pairs": [{"source_type": a, "target_type": b} for a, b in pairs],
                               "ontology_mapping_status": "verified_pinned_2026Q3" if typ in verified_property_iris else "application_relation_pending_review",
                               "ontology_property_iri": verified_property_iris.get(typ)})

scenarios = [
    {
        "key": "conflicting-sources", "title": "Compare conflicting ownership reports", "focus_key": C["demo-beacon"],
        "focus_slug": "demo-beacon", "question": "How much Beacon ordinary equity does Atlas own, and which sources disagree?",
        "expected": {"active_ordinary_reports": [{"source_scope": "demo-registry", "percentage": 45, "baseline": True}, {"source_scope": "demo-analyst-research", "percentage": 47}],
                     "retracted_report": {"source_scope": "demo-vendor", "percentage": 60, "baseline": True},
                     "separate_preferred_report": 20, "as_of": "2025-12-31", "canonical_percentage": None},
        "must_not": ["Average 45 and 47 into a canonical 46%", "Treat withdrawn 60% as active", "Combine preferred 20% with ordinary equity percentages"],
    },
    {
        "key": "equity-voting-control", "title": "Separate equity, voting rights and control", "focus_key": C["demo-beacon"],
        "focus_slug": "demo-beacon", "question": "Why can the data say 45% equity, 72% voting rights and a board-appointment agreement at the same time?",
        "expected": {"registry_equity_percent": 45, "voting_percent": 72, "control_basis": "board_appointment_agreement", "appointable_seats": 5, "total_seats": 7,
                     "control_review_status": "pending_review", "voting_to_control_inference": False},
        "must_not": ["Replace equity percentage with voting percentage", "Infer verified control solely from >50% of a percentage", "Call a pending review an approval"],
    },
    {
        "key": "indirect-paths", "title": "Trace indirect interests without inventing certainty", "focus_key": C["demo-ember-labs"],
        "focus_slug": "demo-ember-labs", "question": "Which reported paths connect Atlas to Ember, and how does Beacon's disagreement affect an illustrative exposure calculation?",
        "expected": {"direct_atlas_ember_percent": 10, "beacon_ember_percent": 60,
                     "registry_branch": {"atlas_beacon_percent": 45, "indirect_percent": 27, "conditional_direct_plus_indirect_percent": 37},
                     "analyst_branch": {"atlas_beacon_percent": 47, "indirect_percent": 28.2, "conditional_direct_plus_indirect_percent": 38.2},
                     "calculation_is": "illustration conditional on comparable ordinary-equity scope, date and non-overlapping paths",
                     "ultimate_beneficial_owner_asserted": False, "control_asserted_by_calculation": False},
        "must_not": ["Publish 37% or 38.2% as reconciled legal ownership", "Automatically infer control or an ultimate beneficial owner", "Treat unlisted holders as zero"],
    },
    {
        "key": "split-and-holdings", "title": "Follow a share split into portfolio holdings", "focus_key": F["demo-growth-portfolio"],
        "focus_slug": "demo-growth-portfolio", "question": "What changed when Beacon split its ordinary shares 2-for-1?",
        "expected": {"effective_date": "2026-01-02", "growth_ordinary_before": 1000, "growth_ordinary_after": 2000,
                     "treasury_ordinary_before": 25000, "treasury_ordinary_after": 50000,
                     "growth_preferred_last_reported": 500, "preferred_affected": False,
                     "percentage_changed_by_split_alone": False, "valuation_claimed": False},
        "must_not": ["Double preferred-share quantities", "Retract unchanged positions omitted from a partial amendment", "Call the position adjustment an earlier source error", "Infer a market price"],
    },
    {
        "key": "instruments-and-loans", "title": "Connect issuers, portfolios, loans and payments", "focus_key": C["demo-cedar-energy"],
        "focus_slug": "demo-cedar-energy", "question": "How is Cedar connected to Fjord, the income portfolio, and its bond coupon?",
        "expected": {"loan_lender": C["demo-fjord-finance"], "loan_borrower": C["demo-cedar-energy"], "loan_principal_usd": 2000000,
                     "loan_fixed_annual_interest_percent": 4.5, "loan_maturity": "2030-06-30",
                     "bond_issuer": C["demo-cedar-energy"], "bond_annual_coupon_percent": 4, "bond_face_per_unit_usd": 1000,
                     "semiannual_coupon_per_unit_usd": 20, "income_units_on_payment_notice": 10, "income_coupon_entitlement_usd": 200,
                     "portfolio_manager": C["demo-grove-asset-management"], "portfolio_owner": P["demo-taylor-stone"]},
        "must_not": ["Treat the portfolio manager as owner of the client's securities", "Treat the bond and the separate loan as the same contract", "Infer equity ownership from being a lender", "Type a legal company directly as a Borrower, Lender, Issuer or Shareholder; the company plays a contextual role"],
    },
    {
        "key": "correction-and-review", "title": "Inspect a correction and its review trail", "focus_key": C["demo-cedar-energy"],
        "focus_slug": "demo-cedar-energy", "question": "Was Cedar's 78% to 80% change a transaction, and who reviewed it?",
        "expected": {"vendor_initial_percent": 78, "vendor_corrected_percent": 80, "change_reason": "source_correction",
                     "stable_observation_identity": True, "independent_registry_percent": 80,
                     "review_status": "accepted_simulated", "reviewer": P["demo-jamie-park"], "actual_user_approval": False,
                     "beacon_analyst_review_status": "pending_review"},
        "must_not": ["Invent a 2% purchase transaction", "Rewrite the independent registry report", "Present simulated review as actual user approval"],
    },
]

existing_baseline = {
    "reuse_entities": [{"key": C["demo-atlas"], "type": "company", "slug": "demo-atlas"}, {"key": C["demo-beacon"], "type": "company", "slug": "demo-beacon"}],
    "observations": [
        {"source_scope": "demo-registry", "source_record_key": "annual-2025", "statement_slot": "equity", "mapping_version": "ownership-demo-v1",
         "expected_current": {"percentage": 45, "status": "reported", "source_revision": "r2", "as_of": "2025-12-31"}, "expected_history_percentages": [40, 45]},
        {"source_scope": "demo-vendor", "source_record_key": "report-2025", "statement_slot": "equity", "mapping_version": "ownership-demo-v1",
         "expected_current": {"percentage": 60, "status": "retracted", "source_revision": "r2", "as_of": "2025-12-31"}, "expected_history_statuses": ["reported", "retracted"]},
    ],
    "instructions": "Locate and reuse the existing baseline by source tuple and mapping_version. Do not duplicate it into v2 or claim that the old synthetic documents are new real evidence.",
    "projection_role_context": {"owner_role_key": shareholder_roles[(C["demo-atlas"], C["demo-beacon"], "ordinary")],
                                "instrument_key": I["demo-beacon-ordinary"],
                                "instructions": "Use this only to enrich the view projection of existing events. Do not rewrite original v1 events or fabricate an original role reference."},
}

stages = [
    {"key": "reference-and-entities", "description": "Create missing types and entities; reuse Atlas/Beacon. Create structural relation types with endpoint rules. Save initial document revisions."},
    {"key": "initial-observations", "description": "Process only r1 observations first. The vendor Cedar claim is 78%; growth and treasury ordinary positions are 1,000 and 25,000."},
    {"key": "source-revisions", "description": "Save vendor Cedar r2 and the two partial split amendments with supersedes_event_id mapped from the corresponding r1 source event. Process their r2 observations after the normal arrival settle interval."},
    {"key": "review-fixture", "description": "Persist the explicitly simulated review events after their referenced observation versions are known. Never resolve a real pending approval through these events."},
    {"key": "links-and-views", "description": "Create the structural typed links and observation-to-participant typed links. Author views from current observations, retaining source distinctions and exact evidence/history links."},
]

checks = {
    "entity_count": len(entities), "entities_by_type": dict(Counter(e["type"] for e in entities)),
    "relationship_count": len(relationships), "relationships_by_type": dict(Counter(r["type"] for r in relationships)),
    "document_version_count": len(documents), "document_logical_count": len({d["logical_key"] for d in documents}),
    "observation_version_count": len(observations), "observation_logical_count": len({o["logical_key"] for o in observations}),
    "observations_by_kind": dict(Counter(o["semantic_type"] for o in observations)),
    "existing_baseline_additional_versions": 4,
}

assert len(entities) == 98, checks
assert 100 <= len(relationships) <= 200, checks
assert len(observations) == 35, checks
assert len({e["key"] for e in entities}) == len(entities)
assert len({r["key"] for r in relationships}) == len(relationships)
assert len({o["key"] for o in observations}) == len(observations)
doc_keys = {d["key"] for d in documents}
observation_keys = {o["key"] for o in observations}
for r in relationships:
    assert r["from_key"] in entity_by_key and r["to_key"] in entity_by_key
    assert r["evidence_document_key"] in doc_keys
for d in documents:
    assert not d["supersedes_key"] or d["supersedes_key"] in doc_keys
    assert all(k in entity_by_key for k in d["entity_keys"])
for o in observations:
    assert o["source_document_key"] in doc_keys
    assert all(k in entity_by_key for k in o["entity_keys"])
    if o["semantic_type"] == "review_decision":
        assert o["metadata"]["subject_observation_version_key"] in observation_keys
        assert o["metadata"]["simulated"] and o["metadata"]["approval_effect"] == "none"
    if "percentage" in o["metadata"]:
        assert 0 <= o["metadata"]["percentage"] <= 100
    for field in ["owner_role_key", "lender_role_key", "borrower_role_key", "guarantor_role_key"]:
        if o["metadata"].get(field):
            assert entity_by_key[o["metadata"][field]]["type"] == "party-role"
for e in entities:
    if e["type"] == "party-role":
        assert entity_by_key[e["metadata"]["role_player_key"]]["type"] in {"company", "person"}
        assert e["metadata"]["context_key"] in entity_by_key
        assert len([r for r in relationships if r["type"] == "role-played-by" and r["from_key"] == e["key"]]) == 1
        assert len([r for r in relationships if r["type"] == "role-in-context" and r["from_key"] == e["key"]]) == 1
for r in relationships:
    if r["type"] in {"issued_by", "loan-has-lender", "loan-has-borrower", "guaranteed_by"}:
        assert entity_by_key[r["to_key"]]["type"] == "party-role"
    if r["type"] == "holds-shares-in":
        assert entity_by_key[r["from_key"]]["metadata"]["role_kind"] == "shareholder"
        assert entity_by_key[r["to_key"]]["metadata"]["role_kind"] == "issuer"

relationship_index = [{"source_key": r["from_key"], "target_key": r["to_key"], "type": r["type"],
                       "label": type_names[r["type"]][0], "evidence_document_key": r["evidence_document_key"]}
                      for r in relationships]

fixture = {
    "format_version": 1, "suite": SUITE,
    "scope": "A connected synthetic financial application dataset, not a claim of complete FIBO axiomatic or OWL reasoning coverage.",
    "synthetic_notice": "All people, organizations, jurisdictions, identifiers, instruments and financial facts are fictional. USD is used solely as a real currency denomination for fictional amounts. Reserved .example.invalid URLs are evidence labels, not fetchable real sources.",
    "ontology_mapping_policy": "The reference-model agent supplies verified class/property IRIs. Do not invent IRIs from these display labels; relationship types remain application mappings until verified.",
    "key_policy": "Entity keys are type:slug; use actual destination IDs. Observation identity is (source_scope, source_record_key, statement_slot); percentages, dates and revisions are not part of that key. A new report date for the same position is a new version with an explicit change_reason, not necessarily an error correction.",
    "existing_baseline": existing_baseline, "entities": entities, "relationship_types": relationship_types,
    "relationships": relationships, "relationship_index": relationship_index, "documents": documents, "observations": observations,
    "replay_stages": stages, "scenarios": scenarios, "counts": checks,
}
(OUT / "financial_demo_fixture.json").write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n")
(OUT / "scenario_expectations.json").write_text(json.dumps({"suite": SUITE, "scenarios": scenarios, "counts": checks}, indent=2, ensure_ascii=False) + "\n")
(OUT / "schema_contract.json").write_text(json.dumps({
    "type_slugs": sorted({e["type"] for e in entities}),
    "entity_fields": {t: sorted({k for e in entities if e["type"] == t for k in e["metadata"]}) for t in sorted({e["type"] for e in entities})},
    "event_fields": {t: sorted({k for o in observations if o["semantic_type"] == t for k in o["metadata"]}) for t in sorted({o["semantic_type"] for o in observations})},
    "relationship_types": relationship_types,
    "required_ref_remapping": ["*_key entity references become actual destination entity IDs in schema-declared *_entity_id fields", "source_document_key becomes exact parent_event_id and source_event_id", "subject_observation_version_key becomes exact reviewed observation event ID", "preserve typed source keys in metadata for reproducibility", "supersedes_key becomes exact prior source event ID"],
    "persisted_event_common_required": ["source_scope", "source_record_key", "statement_slot", "source_revision", "as_of", "status", "mapping_version", "synthetic", "source_event_id"],
    "role_model": {"base_class_iri": "https://www.omg.org/spec/Commons/PartiesAndSituations/PartyRole", "player_field": "role_player_key", "context_field": "context_key", "role_kind_values": ["issuer", "shareholder", "borrower", "lender", "guarantor"], "do_not": "Do not type company directly as the contextual role. Direct event party keys are convenience references; the role references preserve the ontology distinction."},
    "review_statuses": ["unreviewed", "pending_review", "accepted_simulated"],
}, indent=2) + "\n")
print(json.dumps(checks, indent=2))
