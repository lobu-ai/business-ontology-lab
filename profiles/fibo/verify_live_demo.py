#!/usr/bin/env python3
"""Read-only verification of a persisted local Lobu financial demo.

Place adjacent to apply_demo.py. Uses only query_sdk, knowledge.read and
entities.listLinks; no save, update, link, replay, direct database or history
aggregate operations. The shared Lobu client authenticates via local-init.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import pathlib
import sys
from collections import Counter, defaultdict

from apply_demo import Lobu, js


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def as_object(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return {}
    return value if isinstance(value, dict) else {}


def as_list(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return []
    return value if isinstance(value, list) else []


def number(value):
    try:
        return float(value) if value is not None else None
    except (ValueError, TypeError):
        return None


def id_number(value):
    try:
        return int(value) if value is not None else None
    except (ValueError, TypeError):
        return None


def event_id(row):
    return id_number(row.get("id", row.get("event_id", row.get("content_id"))))


def chunks(values, size):
    values = list(values)
    for start in range(0, len(values), size):
        yield values[start:start + size]


def metadata_differences(expected, actual):
    return {key: {"expected": value, "actual": actual.get(key), "present": key in actual}
            for key, value in expected.items() if key not in actual or actual[key] != value}


def identity(metadata):
    return tuple(metadata.get(k) for k in ("source_scope", "source_record_key", "statement_slot"))


class Report:
    def __init__(self, args):
        self.data = {
            "verification": "live-financial-ontology-demo", "mode": "read_only",
            "started_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "base_url": args.base_url, "organization": args.org,
            "checks": [], "limitations": [], "api_usage": {},
        }

    def check(self, name, passed, **detail):
        self.data["checks"].append({"name": name, "status": "passed" if passed else "failed", **detail})

    def group(self, name, errors, **detail):
        self.check(name, not errors, **detail, **({"failures": errors} if errors else {}))

    def note(self, message):
        if message not in self.data["limitations"]:
            self.data["limitations"].append(message)

    def finish(self, output):
        failed = [x["name"] for x in self.data["checks"] if x["status"] == "failed"]
        self.data.update(status="failed" if failed else "passed", failed_checks=failed,
                         completed_at=dt.datetime.now(dt.timezone.utc).isoformat())
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(self.data, ensure_ascii=False, indent=2) + "\n")
        print(js({"status": self.data["status"], "checks": len(self.data["checks"]),
                  "failed_checks": failed, "output": str(output)}), flush=True)
        return 1 if failed else 0


class Reader:
    def __init__(self, client, report):
        self.client, self.report = client, report
        self.queries = 0
        self.exact_ids = set()
        self.read_batches = 0
        self.link_pages = 0

    def query(self, sql):
        self.queries += 1
        rows = self.client.query(sql)
        if not isinstance(rows, list):
            raise RuntimeError("client.query did not return a row list")
        return rows

    def exact(self, ids):
        result = {}
        batches = list(chunks(sorted({id_number(x) for x in ids if id_number(x) is not None}), 10))
        fields = ["id", "content_id", "semantic_type", "metadata", "supersedes_event_id",
                  "superseded_by", "is_superseded", "origin_id", "origin_parent_id",
                  "parent_event_id", "identity_key", "idempotency_key", "source_url", "title"]
        for wave in chunks(batches, 4):
            requests = [{"content_ids": batch, "limit": 100} for batch in wave]
            code = ("const fields=" + js(fields) + "; const requests=" + js(requests) + ";"
                    "return await Promise.all(requests.map(async args=>{"
                    "const result=await client.knowledge.read(args);"
                    "return {requested:args.content_ids,total:result.total,chain_total:result.chain_total,"
                    "content:(result.content||[]).map(row=>Object.fromEntries(fields.filter(k=>k in row).map(k=>[k,row[k]])))};"
                    "}));")
            responses = self.client.sdk(code)
            self.read_batches += len(requests)
            for response in responses:
                wanted = {id_number(x) for x in response["requested"]}
                self.exact_ids.update(wanted)
                rows = response.get("content", [])
                returned = {event_id(row) for row in rows}
                self.report.check("exact_read_ids_" + "_".join(str(x) for x in sorted(wanted)),
                                  wanted <= returned, requested=sorted(wanted),
                                  **({"missing_ids": sorted(wanted - returned)} if not wanted <= returned else {}))
                for row in rows:
                    row["metadata"] = as_object(row.get("metadata"))
                    if event_id(row) is not None:
                        result[event_id(row)] = row
        return result

    def links(self, source_ids):
        pending = [{"entity_id": i, "limit": 100, "offset": 0} for i in sorted(set(source_ids))]
        found = {}
        while pending:
            wave, pending = pending[:10], pending[10:]
            code = ("const requests=" + js(wave) + "; return await Promise.all(requests.map(async args=>{"
                    "const r=await client.entities.listLinks(args);return {request:args,metadata:r.metadata,"
                    "relationships:(r.relationships||[]).map(x=>({id:x.id,from_entity_id:x.from_entity_id,"
                    "to_entity_id:x.to_entity_id,relationship_type_slug:x.relationship_type_slug,"
                    "from_entity_type:x.from_entity_type,to_entity_type:x.to_entity_type,metadata:x.metadata}))};}));")
            for response in self.client.sdk(code):
                self.link_pages += 1
                for row in response.get("relationships", []):
                    row["metadata"] = as_object(row.get("metadata"))
                    found[id_number(row["id"])] = row
                meta = as_object(response.get("metadata"))
                if meta.get("has_more"):
                    request = response["request"]
                    if request["offset"] >= 1000:
                        raise RuntimeError("Unexpectedly large relationship page count for fixture entity " + str(request["entity_id"]))
                    pending.append({**request, "offset": request["offset"] + request["limit"]})
        return found

    def usage(self):
        return {"current_queries": self.queries, "exact_knowledge_read_batches": self.read_batches,
                "distinct_exact_event_ids_requested": len(self.exact_ids), "entity_link_pages": self.link_pages,
                "event_history_aggregate_queries": 0, "mutation_calls": 0}


def verify(args, report):
    fixture_bytes = pathlib.Path(args.fixture).read_bytes()
    state_bytes = pathlib.Path(args.state).read_bytes()
    fixture, state = json.loads(fixture_bytes), json.loads(state_bytes)
    suite = fixture["suite"]
    report.data.update(suite=suite, fixture_sha256=hashlib.sha256(fixture_bytes).hexdigest(),
                       state_sha256=hashlib.sha256(state_bytes).hexdigest(), expected_counts=fixture["counts"])
    client = Lobu(args.base_url, args.org)
    reader = Reader(client, report)
    entity_ids = {k: id_number(v) for k, v in state.get("entities", {}).items()}
    event_ids = {k: id_number(v) for k, v in state.get("events", {}).items()}
    rel_ids = {k: id_number(v) for k, v in state.get("relationships", {}).items()}
    fixture_entities = {e["key"]: e for e in fixture["entities"]}
    fixture_docs = {d["key"]: d for d in fixture["documents"]}
    fixture_obs = {o["key"]: o for o in fixture["observations"]}
    required_event_keys = set(fixture_docs) | set(fixture_obs)
    manifest_errors = []
    for name, expected, supplied in [("entities", set(fixture_entities), entity_ids),
                                     ("events", required_event_keys, event_ids),
                                     ("relationships", {r["key"] for r in fixture["relationships"]}, rel_ids)]:
        missing = sorted(expected - supplied.keys())
        invalid = [k for k in expected & supplied.keys() if not isinstance(supplied[k], int) or supplied[k] < 1]
        ids = [supplied[k] for k in expected & supplied.keys()]
        if missing or invalid or len(ids) != len(set(ids)):
            manifest_errors.append({"section": name, "missing": missing, "invalid": invalid,
                                    "duplicate_id_count": len(ids) - len(set(ids))})
    report.group("state_manifest_complete_unique_ids", manifest_errors,
                 expected={"entities": len(fixture_entities), "source_and_observation_versions": len(required_event_keys), "relationships": len(fixture["relationships"])})
    if manifest_errors:
        report.data["api_usage"] = reader.usage()
        return

    entity_rows = reader.query("SELECT id,slug,name,entity_type,metadata FROM entities WHERE metadata->>'demo_suite'=" + sql_literal(suite) + " ORDER BY id LIMIT 1001")
    entities = {id_number(e["id"]): {**e, "metadata": as_object(e.get("metadata"))} for e in entity_rows}
    entity_errors = []
    for key, expected in fixture_entities.items():
        actual = entities.get(entity_ids[key])
        if not actual:
            entity_errors.append({"key": key, "error": "state ID missing from current demo entities"})
            continue
        wrong = {field: {"expected": expected[field], "actual": actual.get(field if field != "type" else "entity_type")}
                 for field in ("slug", "name", "type")
                 if actual.get(field if field != "type" else "entity_type") != expected[field]}
        diffs = metadata_differences(expected["metadata"], actual["metadata"])
        if wrong or diffs:
            entity_errors.append({"key": key, "record_fields": wrong, "metadata": diffs})
    key_counts = Counter((e["entity_type"], e["slug"]) for e in entity_rows)
    report.group("live_entities_match_fixture", entity_errors, count=len(entity_rows))
    report.check("live_entity_count_and_unique_keys", len(entity_rows) == len(fixture_entities) and all(v == 1 for v in key_counts.values()),
                 expected=len(fixture_entities), actual=len(entity_rows))

    kinds = sorted({o["semantic_type"] for o in fixture["observations"]})
    current = reader.query("SELECT id,semantic_type,identity_key,metadata FROM events WHERE semantic_type IN (" + ",".join(map(sql_literal, kinds)) + ") AND metadata->>'mapping_version' IN (" + sql_literal(suite) + ",'ownership-demo-v1') ORDER BY id LIMIT 1001")
    for row in current:
        row["metadata"] = as_object(row.get("metadata"))
    v2 = [r for r in current if r["metadata"].get("mapping_version") == suite]
    v1 = [r for r in current if r["metadata"].get("mapping_version") == "ownership-demo-v1"]
    expected_heads = {o["logical_key"]: o for o in fixture["observations"]}
    current_by_logical = defaultdict(list)
    for row in v2:
        current_by_logical[row["metadata"].get("logical_observation_key")].append(row)
    head_errors = []
    for logical, expected in expected_heads.items():
        actual = current_by_logical.get(logical, [])
        if len(actual) != 1 or event_id(actual[0]) != event_ids[expected["key"]]:
            head_errors.append({"logical_key": logical, "expected_event_id": event_ids[expected["key"]],
                                "actual_ids": [event_id(x) for x in actual]})
        elif id_number(state.get("logical_events", {}).get(logical)) != event_id(actual[0]):
            head_errors.append({"logical_key": logical, "error": "state logical head differs from live head"})
    report.group("current_observation_heads_are_source_scoped_and_unique", head_errors,
                 expected=len(expected_heads), actual=len(v2), source_tuple_count=len({identity(r["metadata"]) for r in v2}))
    report.check("current_observation_count", len(v2) == len(expected_heads) and len(current_by_logical) == len(expected_heads),
                 expected=len(expected_heads), actual=len(v2))
    baseline = {}
    baseline_errors = []
    for expected in fixture["existing_baseline"]["observations"]:
        key = identity(expected)
        matches = [r for r in v1 if identity(r["metadata"]) == key]
        if len(matches) != 1:
            baseline_errors.append({"source_tuple": key, "expected": 1, "actual": len(matches)})
            continue
        baseline[expected["source_scope"]] = matches[0]
        diffs = metadata_differences(expected["expected_current"], matches[0]["metadata"])
        if diffs:
            baseline_errors.append({"source_tuple": key, "differences": diffs})
    report.group("existing_v1_baseline_reused_current_values", baseline_errors, current_rows=len(v1))

    current_sources = reader.query("SELECT id,identity_key,metadata FROM events WHERE semantic_type='content' AND metadata->>'demo_suite'=" + sql_literal(suite) + " ORDER BY id LIMIT 201")
    source_heads = {d["logical_key"]: d for d in fixture["documents"]}
    source_by_logical = defaultdict(list)
    for row in current_sources:
        row["metadata"] = as_object(row.get("metadata"))
        source_by_logical[row["metadata"].get("logical_source_key")].append(row)
    source_head_errors = []
    for logical, expected in source_heads.items():
        actual = source_by_logical.get(logical, [])
        if len(actual) != 1 or event_id(actual[0]) != event_ids[expected["key"]]:
            source_head_errors.append({"logical_key": logical, "expected_event_id": event_ids[expected["key"]], "actual_ids": [event_id(r) for r in actual]})
    report.group("current_source_heads_and_partial_revisions", source_head_errors,
                 expected=len(source_heads), actual=len(current_sources))
    report.check("current_source_count", len(current_sources) == len(source_heads), expected=len(source_heads), actual=len(current_sources))

    read_rows = reader.exact([event_ids[k] for k in required_event_keys] + [event_id(r) for r in baseline.values()])
    # Follow only observed exact predecessor/evidence IDs; never scan all history.
    for _ in range(6):
        wanted = set()
        for row in read_rows.values():
            wanted.update(x for x in [id_number(row.get("supersedes_event_id")), id_number(row["metadata"].get("source_event_id"))] if x is not None and x not in read_rows)
        if not wanted:
            break
        if len(read_rows) + len(wanted) > 250:
            raise RuntimeError("Exact lineage traversal exceeded the bounded demo budget")
        read_rows.update(reader.exact(wanted))

    version_errors, source_link_errors, parent_errors, lineage_errors, resolved_ref_errors = [], [], [], [], []
    parent_proofs = Counter()
    for key, expected in fixture_docs.items():
        actual = read_rows.get(event_ids[key], {})
        m = as_object(actual.get("metadata"))
        diffs = metadata_differences({**expected["metadata"], "demo_document_key": key, "logical_source_key": expected["logical_key"]}, m)
        if diffs:
            version_errors.append({"key": key, "differences": diffs})
        if expected.get("supersedes_key"):
            prior = event_ids[expected["supersedes_key"]]
            if id_number(actual.get("supersedes_event_id")) != prior:
                lineage_errors.append({"key": key, "expected_prior_id": prior, "actual_prior_id": actual.get("supersedes_event_id")})
    previous = {}
    for key, expected in fixture_obs.items():
        actual = read_rows.get(event_ids[key], {})
        m = as_object(actual.get("metadata"))
        diffs = metadata_differences(expected["metadata"], m)
        if diffs:
            version_errors.append({"key": key, "differences": diffs})
        source_id = event_ids[expected["source_document_key"]]
        source = read_rows.get(source_id, {})
        if id_number(m.get("source_event_id")) != source_id or as_object(source.get("metadata")).get("demo_document_key") != expected["source_document_key"]:
            source_link_errors.append({"key": key, "expected_source_event_id": source_id, "actual_source_event_id": m.get("source_event_id")})
        if actual.get("parent_event_id") is not None:
            parent_proofs["parent_event_id"] += 1
            if id_number(actual["parent_event_id"]) != source_id:
                parent_errors.append({"key": key, "error": "parent_event_id differs from exact source"})
        elif actual.get("origin_parent_id") is not None and source.get("origin_id") is not None:
            parent_proofs["origin_parent_id_to_source_origin_id"] += 1
            if actual["origin_parent_id"] != source["origin_id"]:
                parent_errors.append({"key": key, "error": "origin_parent_id differs from exact source origin_id"})
        else:
            parent_proofs["unexposed"] += 1
        if expected["logical_key"] in previous:
            prior_key = previous[expected["logical_key"]]
            prior_id = event_ids[prior_key]
            prior_meta = as_object(read_rows.get(prior_id, {}).get("metadata"))
            if id_number(actual.get("supersedes_event_id")) != prior_id or identity(m) != identity(prior_meta) or m.get("logical_observation_key") != prior_meta.get("logical_observation_key"):
                lineage_errors.append({"key": key, "expected_prior_id": prior_id, "actual_prior_id": actual.get("supersedes_event_id"), "stable_source_tuple": identity(m) == identity(prior_meta), "stable_logical_key": m.get("logical_observation_key") == prior_meta.get("logical_observation_key")})
        previous[expected["logical_key"]] = key
        for field, value in expected["metadata"].items():
            if field.endswith("_key") and isinstance(value, str) and value in entity_ids:
                stem = field[:-4]
                target_field = stem + ("_id" if stem.endswith("role") else "_entity_id")
                if id_number(m.get(target_field)) != entity_ids[value]:
                    resolved_ref_errors.append({"key": key, "field": target_field, "expected": entity_ids[value], "actual": m.get(target_field)})
        if expected["semantic_type"] == "review_decision":
            target = event_ids[expected["metadata"]["subject_observation_version_key"]]
            if id_number(m.get("observation_event_id")) != target:
                source_link_errors.append({"key": key, "error": "review target is not exact observation version", "expected": target, "actual": m.get("observation_event_id")})
    report.group("all_imported_version_metadata_preserved", version_errors, versions=len(required_event_keys))
    report.group("exact_revision_source_links_and_review_targets", source_link_errors, observations=len(fixture_obs))
    report.group("derivation_parent_links", parent_errors, proof_fields=dict(parent_proofs))
    if parent_proofs["unexposed"]:
        report.note(f"Derivation parent fields were not exposed for {parent_proofs['unexposed']} observations; exact metadata.source_event_id was checked, but native parent linkage could not be independently proved for those records.")
    report.group("supersedes_chains_and_logical_continuity", lineage_errors, source_revisions=3, observation_revisions=3)
    report.group("resolved_event_entity_and_role_references", resolved_ref_errors)
    native_identity_count = sum(bool(r.get("identity_key")) for r in v2)
    report.data["continuity_evidence"] = {"v2_native_identity_keys_exposed_nonempty": native_identity_count,
        "v2_logical_metadata_keys": len(current_by_logical), "proof": "Exact supersedes_event_id links plus unchanged source tuple and logical_observation_key; native identity_key is not required."}
    if native_identity_count < len(v2):
        report.note("Manually saved v2 records do not all expose a native identity_key. This verifier proves application-level logical continuity from metadata and exact supersedes links; it does not claim a native automation identity was assigned.")

    baseline_history_errors = []
    for expected in fixture["existing_baseline"]["observations"]:
        versions = [r for r in read_rows.values() if r.get("semantic_type") == "ownership_observation" and identity(as_object(r.get("metadata"))) == identity(expected)]
        percentages = {number(r["metadata"].get("percentage")) for r in versions}
        statuses = {r["metadata"].get("status") for r in versions}
        if not set(expected.get("expected_history_percentages", [])) <= percentages or not set(expected.get("expected_history_statuses", [])) <= statuses:
            baseline_history_errors.append({"source_scope": expected["source_scope"], "percentages": sorted(x for x in percentages if x is not None), "statuses": sorted(x for x in statuses if x is not None)})
    report.group("existing_v1_correction_and_withdrawal_history", baseline_history_errors)

    native_links = reader.links([entity_ids[r["from_key"]] for r in fixture["relationships"]])
    endpoint_pairs = {r["slug"]: {(x["source_type"], x["target_type"]) for x in r["allowed_pairs"]} for r in fixture["relationship_types"]}
    link_errors, role_errors = [], []
    actual_tuples = defaultdict(set)
    for link in native_links.values():
        actual_tuples[(id_number(link.get("from_entity_id")), id_number(link.get("to_entity_id")), link.get("relationship_type_slug"))].add(id_number(link["id"]))
    for expected in fixture["relationships"]:
        actual = native_links.get(rel_ids[expected["key"]])
        if not actual:
            link_errors.append({"key": expected["key"], "error": "state relationship ID not returned by native listLinks"})
            continue
        source_id, target_id = entity_ids[expected["from_key"]], entity_ids[expected["to_key"]]
        expected_tuple = (source_id, target_id, expected["type"])
        actual_tuple = (id_number(actual.get("from_entity_id")), id_number(actual.get("to_entity_id")), actual.get("relationship_type_slug"))
        pair = (entities.get(source_id, {}).get("entity_type"), entities.get(target_id, {}).get("entity_type"))
        if actual_tuple != expected_tuple or pair not in endpoint_pairs[expected["type"]] or len(actual_tuples[expected_tuple]) != 1:
            link_errors.append({"key": expected["key"], "expected": expected_tuple, "actual": actual_tuple, "endpoint_types": pair, "matching_native_ids": sorted(actual_tuples[expected_tuple])})
        if id_number(actual["metadata"].get("source_event_id")) != event_ids[expected["evidence_document_key"]]:
            link_errors.append({"key": expected["key"], "error": "relationship evidence is not the exact fixture source revision"})
    for key, expected in fixture_entities.items():
        if expected["type"] != "party-role":
            continue
        role_id = entity_ids[key]
        m = entities.get(role_id, {}).get("metadata", {})
        player_id, context_id = entity_ids[expected["metadata"]["role_player_key"]], entity_ids[expected["metadata"]["context_key"]]
        if len(actual_tuples[(role_id, player_id, "role-played-by")]) != 1 or len(actual_tuples[(role_id, context_id, "role-in-context")]) != 1:
            role_errors.append({"key": key, "error": "role player or role context native link missing/duplicated"})
        if entities.get(player_id, {}).get("entity_type") not in ("company", "person") or m.get("role_kind") != expected["metadata"]["role_kind"]:
            role_errors.append({"key": key, "error": "role player type or role kind incorrect"})
    report.group("native_relationships_exact_ids_endpoints_evidence_and_uniqueness", link_errors, expected_fixture_links=len(fixture["relationships"]), observed_fixture_ids=len({rel_ids[r['key']] for r in fixture['relationships']} & native_links.keys()))
    report.group("contextual_roles_have_native_player_and_context_links", role_errors, expected_roles=sum(e["type"] == "party-role" for e in fixture_entities.values()))

    verify_scenarios(fixture, current_by_logical, baseline, read_rows, event_ids, entities, entity_ids, report)
    verify_presentation_manifest(args, fixture, reader, entity_ids, report)
    report.data["observed_counts"] = {"entities": len(entity_rows), "current_v2_observations": len(v2), "current_v1_observations": len(v1),
        "current_source_documents": len(current_sources), "imported_source_versions_read": sum(event_ids[k] in read_rows for k in fixture_docs),
        "imported_observation_versions_read": sum(event_ids[k] in read_rows for k in fixture_obs),
        "native_fixture_relationships": len({rel_ids[r['key']] for r in fixture['relationships']} & native_links.keys())}
    report.data["idempotency_evidence"] = {"state_event_ids_unique": True,
        "current_logical_heads_unique": not head_errors and len(v2) == len(expected_heads),
        "native_fixture_edge_tuples_unique": not link_errors,
        "replay_performed": False, "meaning": "Read-only duplicate and manifest consistency checks. This does not independently execute or prove a second write replay."}
    report.note("The verifier performs no write replay. Idempotency evidence consists of unique persisted current records, exact manifest IDs and unique native fixture edge tuples.")
    report.note("No OWL entailment, financial valuation, reconciled ownership percentage or actual human approval is inferred by these checks.")
    report.data["api_usage"] = reader.usage()


def verify_scenarios(fixture, current_by_logical, baseline, read_rows, event_ids, entities, entity_ids, report):
    def meta(logical):
        rows = current_by_logical.get(logical, [])
        return rows[0]["metadata"] if len(rows) == 1 else {}

    registry = as_object(baseline.get("demo-registry", {}).get("metadata"))
    vendor = as_object(baseline.get("demo-vendor", {}).get("metadata"))
    analyst = meta("ownership:analyst:atlas-beacon:ordinary")
    preferred = meta("ownership:registry:demo-atlas:demo-beacon:preferred")
    conflict = {"registry": registry.get("percentage"), "analyst": analyst.get("percentage"),
                "vendor_status": vendor.get("status"), "preferred": preferred.get("percentage")}
    report.check("scenario_conflicting_sources", number(registry.get("percentage")) == 45 and registry.get("status") == "reported" and number(analyst.get("percentage")) == 47 and analyst.get("status") == "reported" and vendor.get("status") == "retracted" and number(preferred.get("percentage")) == 20 and preferred.get("share_class") == "preferred", observed=conflict)

    voting = meta("voting:atlas:demo-beacon")
    control = meta("control:demo-atlas:demo-beacon")
    report.check("scenario_equity_voting_control", number(registry.get("percentage")) == 45 and number(voting.get("percentage")) == 72 and voting.get("basis") == "voting_rights" and control.get("control_basis") == "board_appointment_agreement" and number(control.get("appointable_board_seats")) == 5 and number(control.get("total_board_seats")) == 7 and control.get("review_status") == "pending_review" and control.get("inference_status") == "source_asserted", observed={"equity": registry.get("percentage"), "voting": voting.get("percentage"), "control_basis": control.get("control_basis"), "seats": control.get("appointable_board_seats"), "review_status": control.get("review_status")})

    direct = number(meta("ownership:registry:demo-atlas:demo-ember-labs:ordinary").get("percentage"))
    downstream = number(meta("ownership:registry:demo-beacon:demo-ember-labs:ordinary").get("percentage"))
    paths = {}
    for name, start in [("registry", number(registry.get("percentage"))), ("analyst", number(analyst.get("percentage")))]:
        if start is not None and downstream is not None and direct is not None:
            paths[name] = {"indirect": round(start / 100 * downstream, 4), "conditional_total": round(direct + start / 100 * downstream, 4)}
    report.check("scenario_indirect_paths", direct == 10 and downstream == 60 and paths == {"registry": {"indirect": 27, "conditional_total": 37}, "analyst": {"indirect": 28.2, "conditional_total": 38.2}}, observed=paths, interpretation="Conditional arithmetic only; no ownership reconciliation, control or UBO conclusion.")

    growth = meta("holding:demo-growth-portfolio:demo-beacon-ordinary")
    treasury = meta("holding:demo-atlas-treasury-portfolio:demo-beacon-ordinary")
    prefgrowth = meta("holding:demo-growth-portfolio:demo-beacon-preferred")
    oldgrowth = as_object(read_rows.get(event_ids["holding:demo-growth-portfolio:demo-beacon-ordinary@r1"], {}).get("metadata"))
    oldtreasury = as_object(read_rows.get(event_ids["holding:demo-atlas-treasury-portfolio:demo-beacon-ordinary@r1"], {}).get("metadata"))
    split = meta("action:beacon-split")
    holding_count = sum(rows[0].get("semantic_type") == "holding_observation" for rows in current_by_logical.values() if len(rows) == 1)
    report.check("scenario_split_and_holdings", number(oldgrowth.get("quantity")) == 1000 and number(growth.get("quantity")) == 2000 and number(oldtreasury.get("quantity")) == 25000 and number(treasury.get("quantity")) == 50000 and number(prefgrowth.get("quantity")) == 500 and holding_count == 7 and growth.get("change_reason") == treasury.get("change_reason") == "corporate_action_adjustment" and split.get("effective_date") == "2026-01-02" and number(split.get("ratio_numerator")) == 2 and number(split.get("ratio_denominator")) == 1, observed={"growth_before": oldgrowth.get("quantity"), "growth_after": growth.get("quantity"), "treasury_before": oldtreasury.get("quantity"), "treasury_after": treasury.get("quantity"), "preferred_unchanged": prefgrowth.get("quantity"), "current_positions": holding_count})

    loan = meta("loan-terms:demo-cedar-expansion-loan")
    coupon = meta("action:cedar-coupon")
    bond = entities.get(entity_ids["financial-instrument:demo-cedar-green-bond"], {}).get("metadata", {})
    portfolio = entities.get(entity_ids["portfolio:demo-income-portfolio"], {}).get("metadata", {})
    entitlement = next((x for x in coupon.get("entitlements", []) if x.get("portfolio_key") == "portfolio:demo-income-portfolio"), {})
    report.check("scenario_instruments_and_loans", loan.get("lender_key") == "company:demo-fjord-finance" and loan.get("borrower_key") == "company:demo-cedar-energy" and number(loan.get("principal_amount")) == 2000000 and number(loan.get("annual_interest_percent")) == 4.5 and loan.get("maturity_date") == "2030-06-30" and number(bond.get("annual_coupon_percent")) == 4 and number(bond.get("face_value_per_unit")) == 1000 and number(coupon.get("coupon_per_unit")) == 20 and number(entitlement.get("units")) == 10 and number(entitlement.get("amount")) == 200 and portfolio.get("owner_key") == "person:demo-taylor-stone" and portfolio.get("manager_key") == "company:demo-grove-asset-management", observed={"loan_principal": loan.get("principal_amount"), "loan_rate": loan.get("annual_interest_percent"), "bond_rate": bond.get("annual_coupon_percent"), "coupon_per_unit": coupon.get("coupon_per_unit"), "income_entitlement": entitlement})

    correction = meta("ownership:vendor:atlas-cedar:ordinary")
    old = as_object(read_rows.get(event_ids["ownership:vendor:atlas-cedar:ordinary@r1"], {}).get("metadata"))
    independent = meta("ownership:registry:demo-atlas:demo-cedar-energy:ordinary")
    review = meta("review:cedar-correction-accepted")
    report.check("scenario_correction_and_review", number(old.get("percentage")) == 78 and number(correction.get("percentage")) == 80 and number(independent.get("percentage")) == 80 and correction.get("change_reason") == "source_correction" and correction.get("review_status") == "accepted_simulated" and review.get("simulated") is True and review.get("approval_effect") == "none" and review.get("reviewer_key") == "person:demo-jamie-park" and id_number(review.get("observation_event_id")) == event_ids["ownership:vendor:atlas-cedar:ordinary@r2"] and analyst.get("review_status") == "pending_review", observed={"before": old.get("percentage"), "after": correction.get("percentage"), "review_status": correction.get("review_status"), "approval_effect": review.get("approval_effect"), "beacon_review_status": analyst.get("review_status")})


def verify_presentation_manifest(args, fixture, reader, entity_ids, report):
    rows = reader.query("SELECT id,metadata FROM events WHERE semantic_type='ontology_demo_manifest' ORDER BY id DESC LIMIT 21")
    if not rows:
        if args.require_manifest:
            report.check("presentation_manifest_present", False, expected="at least one current ontology_demo_manifest")
        else:
            report.note("No presentation manifest was present. Use --require-manifest for the final installation verification.")
        return
    report.check("presentation_manifest_present", True, event_id=event_id(rows[0]), current_manifests=len(rows))
    m = as_object(rows[0].get("metadata"))
    counts = as_object(m.get("demo_counts"))
    canonical = dict(fixture["counts"])
    by_type = fixture["counts"]["entities_by_type"]
    canonical.update(companies=by_type["company"], people=by_type["person"], jurisdictions=by_type["jurisdiction"],
                     identifiers=by_type["identifier"], identifier_schemes=by_type["identifier-scheme"],
                     instruments=by_type["financial-instrument"], loans=by_type["loan"], portfolios=by_type["portfolio"],
                     corporate_actions=by_type["corporate-action"], party_roles=by_type["party-role"],
                     entities=fixture["counts"]["entity_count"], relationships=fixture["counts"]["relationship_count"],
                     source_versions=fixture["counts"]["document_version_count"], observation_versions=fixture["counts"]["observation_version_count"])
    count_errors = {key: {"expected": canonical[key], "actual": value} for key, value in counts.items() if key in canonical and value != canonical[key]}
    report.group("presentation_manifest_declared_counts", count_errors, compared_fields=sorted(counts.keys() & canonical.keys()))
    scenarios = as_list(m.get("scenarios"))
    expected_scenarios = {s["key"] for s in fixture["scenarios"]}
    actual_scenarios = {s.get("key") for s in scenarios if isinstance(s, dict)}
    report.check("presentation_manifest_six_scenarios", expected_scenarios <= actual_scenarios, expected=sorted(expected_scenarios), actual=sorted(x for x in actual_scenarios if x is not None))
    index = as_list(m.get("entity_index"))
    supplied_ids = {id_number(x.get("id", x.get("entity_id"))) for x in index if isinstance(x, dict)}
    missing = sorted(set(entity_ids[k] for k in (e["key"] for e in fixture["entities"])) - supplied_ids)
    report.check("presentation_manifest_entity_index", not missing, expected=len(fixture["entities"]), actual_index_entries=len(index), **({"missing_entity_ids": missing} if missing else {}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--org", required=True)
    parser.add_argument("--fixture", required=True)
    parser.add_argument("--state", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--require-manifest", action="store_true")
    args = parser.parse_args()
    report = Report(args)
    try:
        verify(args, report)
    except Exception as error:
        report.check("verification_runtime", False, error_type=type(error).__name__, error=str(error)[:3000])
    return report.finish(pathlib.Path(args.output))


if __name__ == "__main__":
    sys.exit(main())
