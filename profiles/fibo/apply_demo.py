#!/usr/bin/env python3
"""Install the FIBO demonstration through Lobu's public local SDK endpoints.

No database access. Credentials remain in memory. All fixture events carry
stable producer keys; rerunning an import does not duplicate those events.
"""
from __future__ import annotations
import argparse
import os
import http.client
import concurrent.futures
import hashlib
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

VERSION = "financial-ontology-demo-v2"
REFERENCE = "fibo-2026q3"
PIN = "2d73435a4419b66b7c9f44cb9763e35fe8ac7890"


class Lobu:
    def __init__(self, base, org):
        self.base, self.org = base.rstrip("/"), org
        from urllib.parse import urlparse
        address = urlparse(self.base)
        if address.scheme not in ("http", "https") or address.username or address.password:
            raise ValueError("Invalid Lobu base URL")
        if address.scheme != "https" and address.hostname not in ("localhost", "127.0.0.1", "::1"):
            raise ValueError("Remote runtimes require HTTPS")
        self.token = os.environ.get("LOBU_TOKEN")
        self.cookie = None
        if not self.token:
            from urllib.parse import urlparse
            if urlparse(self.base).hostname not in ("localhost", "127.0.0.1", "::1") or os.environ.get("LOBU_LOCAL_INIT") != "1":
                raise ValueError("Set LOBU_TOKEN, or explicitly enable LOBU_LOCAL_INIT=1 for a loopback runtime")
            self.token = self.request("/api/local-init", {}).get("session_token")
        if not self.token:
            raise RuntimeError("No authenticated session")

    def request(self, path, payload):
        headers = {"Content-Type": "application/json", "Origin": self.base,
                   "X-Lobu-Client": "fibo-demo-example"}
        if self.cookie:
            headers["Cookie"] = self.cookie
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        request = urllib.request.Request(self.base + path,
                    data=json.dumps(payload, ensure_ascii=False).encode(), headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=175) as response:
                cookies = response.headers.get_all("Set-Cookie") or []
                if cookies:
                    self.cookie = "; ".join(x.split(";", 1)[0] for x in cookies)
                result = json.load(response)
        except urllib.error.HTTPError as error:
            message = error.read().decode()
            if self.token:
                message = message.replace(self.token, "[redacted]")
            raise RuntimeError(f"HTTP {error.code}: {message[:2000]}") from None
        return result

    def sdk(self, code, write=False, timeout=120000):
        result = self.request(f"/api/{self.org}/{'run_sdk' if write else 'query_sdk'}",
            {"script": "export default async (ctx,client)=>{" + code + "}", "timeout_ms": timeout})
        if not result.get("success"):
            raise RuntimeError(json.dumps(result, ensure_ascii=False)[:4000])
        if result.get("return_truncated"):
            raise RuntimeError("SDK result truncated; narrow this query")
        return result.get("return_value")

    def call(self, method, args, write=False):
        return self.sdk(f"return await client.{method}({js(args)});", write=write)

    def query(self, sql):
        return self.call("query", sql)

    def save(self, event):
        # The native REST tool uses the same save handler and authorization as
        # knowledge.save, without compiling a script containing every large chunk.
        for attempt in range(4):
            try:
                result = self.request(f"/api/{self.org}/save_memory", event)
                break
            except (urllib.error.URLError, http.client.RemoteDisconnected, TimeoutError):
                if not event.get("idempotency_key") or attempt == 3:
                    raise
                time.sleep(2 ** attempt)
        if result.get("approval_queued") or result.get("blocked_fields"):
            raise RuntimeError("Requested event requires approval: " + js(result))
        return result


def js(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def log(step, **fields):
    print(js({"step": step, **fields}), flush=True)


def field(kind="string", title=None, **kwargs):
    return {"type": kind, **({"title": title} if title else {}), **kwargs}


def readonly_schema(props, key):
    return {"type": "object", "x-lobu-record-key": key,
            "properties": {k: {**v, "readOnly": True} for k, v in props.items()}}


def upsert_type(client, spec):
    old = client.call("entitySchema.getType", spec["slug"]).get("entity_type")
    result = client.call("entitySchema.updateType" if old else "entitySchema.createType", spec, True)
    log("type", slug=spec["slug"], updated=bool(old))
    return result


def ensure_rules(client, slug, pairs):
    rules = client.call("entitySchema.listRules", {"slug": slug})["rules"]
    known = {(r["source_entity_type_slug"], r["target_entity_type_slug"]) for r in rules}
    for source_type, target_type in pairs:
        if (source_type, target_type) not in known:
            client.call("entitySchema.addRule", {"slug": slug, "source_entity_type_slug": source_type, "target_entity_type_slug": target_type}, True)


def schema(client):
    text = field()
    identifier = field("integer", minimum=1)
    common = {
        "source_scope": field(minLength=1), "source_record_key": field(minLength=1),
        "statement_slot": field(minLength=1), "source_revision": field(minLength=1),
        "as_of": field(format="date"), "status": field(enum=["reported", "retracted"]),
        "mapping_version": field(enum=["ownership-demo-v1", VERSION]),
        "synthetic": field("boolean", const=True), "source_event_id": identifier,
        "owner_entity_id": identifier, "subject_entity_id": identifier,
        "owned_entity_id": identifier, "owner_role_id": identifier,
        "percentage": field("number", minimum=0, maximum=100),
        "basis": text, "share_class": text,
        "review_status": field(enum=["unreviewed", "accepted", "rejected", "needs_review", "pending", "not_reviewed", "pending_review", "accepted_simulated", "rejected_simulated"]),
        "quantity": field("number", minimum=0), "currency": text,
    }
    required = ["source_scope", "source_record_key", "statement_slot", "source_revision",
                "as_of", "status", "mapping_version", "synthetic", "source_event_id"]
    kinds = {}
    for kind, label in [
        ("ownership_observation", "Source-specific equity ownership statement"),
        ("voting_observation", "Source-specific voting-rights statement"),
        ("control_observation", "Explicit evidence of control; never inferred from percentage alone"),
        ("holding_observation", "Dated portfolio holding with quantities and valuation basis"),
        ("loan_observation", "Dated loan terms, party roles and outstanding balance"),
        ("corporate_action_observation", "Corporate action announcement and effective dates"),
    ]:
        extra = ["owner_entity_id", "owned_entity_id", "basis", "share_class", "percentage"] if kind == "ownership_observation" else []
        kinds[kind] = {"description": label + ". Synthetic demonstration data.",
                       "metadataSchema": {"type": "object", "required": required + extra, "properties": common}}
    kinds["review_decision"] = {"description": "Simulated fixture evidence review. Not a real user approval.",
        "metadataSchema": {"type": "object", "required": ["synthetic"], "properties": {
            "synthetic": field("boolean", const=True), "simulated": field("boolean", const=True),
            "decision": field(enum=["accepted", "rejected", "needs_review", "accepted_simulated", "rejected_simulated", "pending_review"]),
            "observation_event_id": identifier, "source_event_id": identifier}}}
    kinds["ontology_catalog_chunk"] = {"description": "Pinned FIBO asserted reference statements in bounded immutable chunks.",
        "metadataSchema": {"type": "object", "required": ["reference_id", "chunk_kind", "chunk_index", "items"],
          "properties": {"reference_id": text, "release_tag": text, "commit_sha": text,
            "chunk_kind": field(enum=["classes", "properties", "individuals", "modules", "axioms"]),
            "chunk_index": field("integer", minimum=0), "items": {"type": "array", "items": {"type": "object"}}}}}
    kinds["ontology_catalog_manifest"] = {"description": "Audited reference catalog release, counts, source checksums and import coverage."}
    kinds["ontology_demo_manifest"] = {"description": "Financial demo presentation index, mappings and bounded scenario expectations."}
    current = client.call("entitySchema.getType", "$member")["entity_type"]
    current_kinds = current.get("event_kinds") or {}
    client.call("entitySchema.updateType", {"slug": "$member", "event_kinds": {**current_kinds, **kinds}}, True)
    log("event-kinds", count=len(kinds))

    for slug, plural, chunk in [("ontology-class", "Ontology classes", "classes"),
        ("ontology-property", "Ontology properties", "properties"),
        ("ontology-individual", "Ontology individuals", "individuals"),
        ("ontology-module", "Ontology modules", "modules")]:
        props = {"iri": field(title="IRI"), "name": field(title="Name", **{"x-table-column": True}),
            "definition": field(title="Definition"), "domain_code": field(title="Domain", **{"x-table-column": True, "x-facet": True}),
            "module_iri": field(title="Source ontology"), "maturity": field(title="Maturity", **{"x-table-column": True}),
            "source_file": field(title="Source file")}
        sql = ("SELECT item->>'iri' AS iri, item->>'label' AS name, item->>'definition' AS definition, "
            "item->>'domain_code' AS domain_code, item->>'module_iri' AS module_iri, "
            "item->>'maturity' AS maturity, item->>'source_file' AS source_file "
            "FROM events e CROSS JOIN LATERAL jsonb_array_elements(e.metadata->'items') item "
            f"WHERE e.semantic_type='ontology_catalog_chunk' AND e.metadata->>'reference_id'='{REFERENCE}' "
            f"AND e.metadata->>'chunk_kind'='{chunk}'")
        upsert_type(client, {"slug": slug, "name": plural, "description": "Reference catalog from pinned FIBO source; asserted definitions, not inferred instance data.",
            "metadata_schema": readonly_schema(props, "iri"), "backing": {"sql": sql}})
    props = {k: field(title=k.replace("_", " ").title(), **({"x-table-column": True} if k in ["subject", "predicate", "object"] else {}))
             for k in ["key", "name", "subject", "predicate", "object", "object_kind", "datatype", "language", "module_iri", "source_file"]}
    sql = ("SELECT item->>'key' AS key, concat(item->>'subject',' ',item->>'predicate') AS name, "
        + ",".join(f"item->>'{k}' AS {k}" for k in props if k not in ["key", "name"])
        + " FROM events e CROSS JOIN LATERAL jsonb_array_elements(e.metadata->'items') item "
        + f"WHERE e.semantic_type='ontology_catalog_chunk' AND e.metadata->>'reference_id'='{REFERENCE}' AND e.metadata->>'chunk_kind'='axioms'")
    upsert_type(client, {"slug": "ontology-axiom", "name": "Ontology statements", "description": "Every asserted RDF statement, including canonical blank nodes and list structures.",
        "metadata_schema": readonly_schema(props, "key"), "backing": {"sql": sql}})


def catalog(client, folder):
    path = pathlib.Path(folder)
    events = [json.loads(line) for line in (path / "events.jsonl").read_text().splitlines() if line.strip()]
    # Read bounded current pages and skip exact immutable producer keys already
    # committed by this pinned import. A partial previous import is resumable.
    existing = set()
    cursor = 0
    while True:
        rows = client.query("SELECT id,metadata->>'_lobu_idempotency_key' AS producer_key FROM events "
            + f"WHERE semantic_type='ontology_catalog_chunk' AND metadata->>'reference_id'='{REFERENCE}' AND id>{cursor} ORDER BY id LIMIT 200")
        for row in rows:
            if row.get("producer_key"):
                existing.add(row["producer_key"])
        if len(rows) < 200:
            break
        cursor = max(int(row["id"]) for row in rows)
    completed = 0
    def one(event):
        event = dict(event)
        event["semantic_type"] = event.pop("kind", event.get("semantic_type", "ontology_catalog_chunk"))
        event.setdefault("payload_type", "empty")
        event.setdefault("idempotency_key", f"{REFERENCE}:{event['metadata']['chunk_kind']}:{event['metadata']['chunk_index']}:{PIN}")
        if event["idempotency_key"] in existing:
            return {"already_committed": True}
        return client.save(event)
    log("catalog-resume", committed_chunks=len(existing))
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        futures = {pool.submit(one, event): event for event in events}
        for future in concurrent.futures.as_completed(futures):
            future.result()
            completed += 1
            if completed % 20 == 0 or completed == len(events):
                log("catalog-chunks", completed=completed, total=len(events))
    event = json.loads((path / "manifest-event.json").read_text())
    event["semantic_type"] = event.pop("kind", "ontology_catalog_manifest")
    event.setdefault("payload_type", "empty")
    event.setdefault("idempotency_key", f"{REFERENCE}:manifest:{PIN}")
    result = client.save(event)
    log("catalog-complete", chunks=completed, manifest=result)


def event_id(result):
    for key in ("event_id", "content_id", "id"):
        if isinstance(result.get(key), (int, float)):
            return int(result[key])
    for key in ("event", "content"):
        if isinstance(result.get(key), dict):
            return event_id(result[key])
    raise RuntimeError("Cannot find saved event ID: " + js(result)[:1000])


def write_state(path, state):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n")
    temp.replace(path)


CLASS_IRIS = {
    "company": "https://www.omg.org/spec/Commons/Organizations/LegalEntity",
    "person": "https://spec.edmcouncil.org/fibo/ontology/FND/AgentsAndPeople/People/Person",
    "jurisdiction": "https://www.omg.org/spec/Commons/RegulatoryAgencies/Jurisdiction",
    "loan": "https://spec.edmcouncil.org/fibo/ontology/LOAN/LoansGeneral/Loans/Loan",
    "portfolio": "https://spec.edmcouncil.org/fibo/ontology/FND/OwnershipAndControl/Ownership/Portfolio",
    "corporate-action": "https://spec.edmcouncil.org/fibo/ontology/CAE/CorporateEvents/CorporateActions/CorporateAction",
}


def inferred_field(name, values):
    values = [v for v in values if v is not None]
    example = values[0] if values else ""
    kind = "boolean" if isinstance(example, bool) else "number" if isinstance(example, (int, float)) else "array" if isinstance(example, list) else "object" if isinstance(example, dict) else "string"
    result = field(kind, name.replace("_", " ").title())
    if kind == "array":
        result["items"] = {}
    if any(v is None for v in values):
        result["type"] = [kind, "null"]
    if name in ["legal_name", "display_name", "jurisdiction", "legal_form", "instrument_kind", "currency", "role_kind", "identifier_value", "scheme_kind", "principal_amount", "maturity_date", "action_type", "effective_date", "strategy"]:
        result["x-table-column"] = True
    if name in ["role_kind", "instrument_kind", "action_type"]:
        result["x-facet"] = True
    return result


def model(client, fixture):
    type_map_path = pathlib.Path(__file__).parent / "operational-type-map.json"
    type_map = json.loads(type_map_path.read_text()) if type_map_path.exists() else {"type_defaults": CLASS_IRIS}
    grouped = {}
    for entity in fixture["entities"]:
        grouped.setdefault(entity["type"], []).append(entity)
    for typ, entities in grouped.items():
        keys = sorted({k for entity in entities for k in entity["metadata"]})
        props = {key: inferred_field(key, [entity["metadata"].get(key) for entity in entities]) for key in keys}
        # Nullable reference keys are absent facts, not empty references.
        for key in keys:
            if any(key in e["metadata"] and e["metadata"][key] is None for e in entities):
                props[key]["type"] = [props[key]["type"], "null"]
        props["synthetic"] = field("boolean", const=True)
        props["ontology_class_iri"] = field(format="uri", title="Mapped ontology class")
        props["demo_key"] = field(**{"x-identity-namespace": {"namespace": "fibo_demo_" + typ.replace("-", "_"), "normalize": "exact"}})
        metadata_schema = {"type": "object", "required": ["demo_key", "synthetic"], "properties": props,
                           "x-ontology-release": "master_2026Q3", "x-ontology-mapping-status": "selected_application_mapping"}
        if typ in type_map["type_defaults"]:
            metadata_schema["x-ontology-iri"] = type_map["type_defaults"][typ]
        upsert_type(client, {"slug": typ, "name": typ.replace("-", " ").title() + ("" if typ.endswith("s") else "s"),
            "description": "Synthetic financial demo: " + typ.replace("-", " ") + ". FIBO role and context distinctions are explicit; application validation is not OWL reasoning.",
            "metadata_schema": metadata_schema})

    current = client.call("entitySchema.getType", "$member")["entity_type"]
    kinds = current["event_kinds"]
    for kind in {x["semantic_type"] for x in fixture["observations"]}:
        sample_rows = [x["metadata"] for x in fixture["observations"] if x["semantic_type"] == kind]
        props = kinds[kind].setdefault("metadataSchema", {"type": "object"}).setdefault("properties", {})
        for key in sorted({key for row in sample_rows for key in row}):
            if key in ("review_status", "decision"):
                values = sorted({row[key] for row in sample_rows if key in row} | set(props.get(key, {}).get("enum", [])))
                props[key] = field(enum=values)
            elif key not in props:
                props[key] = inferred_field(key, [row.get(key) for row in sample_rows])
                if any(key in row and row[key] is None for row in sample_rows):
                    props[key]["type"] = [props[key]["type"], "null"]
        for key in ["owner_entity_id", "subject_entity_id", "owner_role_id", "borrower_role_id", "lender_role_id", "source_event_id"]:
            props[key] = field("integer", minimum=1)
    client.call("entitySchema.updateType", {"slug": "$member", "event_kinds": kinds}, True)

    common_props = {
        "observation_key": field(), "event_id": field("integer"), "name": field(),
        "owner": field(**{"x-table-column": True}), "subject": field(**{"x-table-column": True}),
        "source": field(**{"x-table-column": True}), "source_revision": field(),
        "percentage": field("number", **{"x-table-column": True}), "quantity": field("number", **{"x-table-column": True}),
        "basis": field(), "share_class": field(), "as_of": field(format="date", **{"x-table-column": True}),
        "status": field(**{"x-table-column": True, "x-facet": True}), "review_status": field(**{"x-table-column": True}),
        "evidence_event_id": field("integer"), "owned_company": field(),
    }
    for kind in sorted({x["semantic_type"] for x in fixture["observations"]}):
        typ = kind.replace("_", "-")
        sql = ("SELECT coalesce(e.identity_key,e.metadata->>'logical_observation_key',concat('v1::',md5(concat_ws('|',e.metadata->>'source_scope',e.metadata->>'source_record_key',e.metadata->>'statement_slot')))) AS observation_key, e.id AS event_id, "
            "coalesce(e.title,concat(e.semantic_type,': ',owner.name,' → ',subject.name)) AS name, "
            "owner.name AS owner,subject.name AS subject,subject.name AS owned_company, "
            "e.metadata->>'source_scope' AS source,e.metadata->>'source_revision' AS source_revision, "
            "(e.metadata->>'percentage')::numeric AS percentage,(e.metadata->>'quantity')::numeric AS quantity, "
            "e.metadata->>'basis' AS basis,e.metadata->>'share_class' AS share_class,e.metadata->>'as_of' AS as_of, "
            "e.metadata->>'status' AS status,e.metadata->>'review_status' AS review_status, "
            "(e.metadata->>'source_event_id')::bigint AS evidence_event_id "
            "FROM events e LEFT JOIN entities owner ON owner.id=(e.metadata->>'owner_entity_id')::bigint "
            "LEFT JOIN entities subject ON subject.id=coalesce(e.metadata->>'subject_entity_id',e.metadata->>'owned_entity_id')::bigint "
            f"WHERE e.semantic_type='{kind}' AND e.metadata->>'mapping_version' IN ('{VERSION}','ownership-demo-v1')")
        upsert_type(client, {"slug": typ, "name": kind.replace("_", " ").title() + "s",
            "description": "Current version of each independent source statement. Evidence and revision history remain available.",
            "metadata_schema": readonly_schema(common_props, "observation_key"), "backing": {"sql": sql}})
    source_props = {"source_key": field(), "event_id": field("integer"), "name": field(), "source": field(**{"x-table-column": True}),
                    "revision": field(**{"x-table-column": True}), "as_of": field(), "source_url": field()}
    source_sql = ("SELECT coalesce(e.identity_key,e.metadata->>'logical_source_key',concat(e.metadata->>'source_scope','|',e.metadata->>'source_record_key')) AS source_key,e.id AS event_id,coalesce(e.title,e.metadata->>'source_record_key') AS name,"
        "e.metadata->>'source_scope' AS source,e.metadata->>'source_revision' AS revision,e.metadata->>'as_of' AS as_of,e.source_url "
        f"FROM events e WHERE e.semantic_type='content' AND e.metadata->>'demo_suite' IN ('{VERSION}','ownership-demo-v1')")
    upsert_type(client, {"slug": "source-document", "name": "Evidence documents", "description": "Synthetic source documents with exact revision history.",
        "metadata_schema": readonly_schema(source_props, "source_key"), "backing": {"sql": source_sql}})
    known = client.call("entitySchema.listRelTypes", {"list_scope": "organization"})
    known_slugs = {row["slug"] for row in known.get("relationship_types", known.get("rel_types", []))}
    for rel in fixture["relationship_types"]:
        rel_schema = {"type": "object", "properties": {"synthetic": field("boolean", const=True), "source_event_id": field("integer", minimum=1)},
                      "x-ontology-mapping-status": rel.get("ontology_mapping_status", "application_navigation")}
        if rel.get("ontology_property_iri"):
            rel_schema["x-ontology-iri"] = rel["ontology_property_iri"]
        spec = {"slug": rel["slug"], "name": rel["name"], "description": rel["description"], "metadata_schema": rel_schema}
        client.call("entitySchema.updateRelType" if rel["slug"] in known_slugs else "entitySchema.createRelType", spec, True)
        ensure_rules(client, rel["slug"], [(pair["source_type"], pair["target_type"]) for pair in rel["allowed_pairs"]])
    log("financial-model", types=len(grouped), relationship_types=len(fixture["relationship_types"]))


def resolve_metadata(metadata, ids):
    result = dict(metadata)
    for key, value in metadata.items():
        if key.endswith("_key") and isinstance(value, str) and value in ids:
            stem = key[:-4]
            result[stem + ("_id" if stem.endswith("role") else "_entity_id")] = ids[value]
    return result


def data(client, fixture, state_path):
    state = json.loads(state_path.read_text()) if state_path.exists() else {"entities": {}, "events": {}, "logical_events": {}, "relationships": {}}
    existing = client.query("SELECT id,slug,entity_type FROM entities LIMIT 1000")
    ids = {row["entity_type"] + ":" + row["slug"]: row["id"] for row in existing}
    for entity in fixture["entities"]:
        key = entity["key"]
        args = {"name": entity["name"], "slug": entity["slug"], "metadata": entity["metadata"]}
        if key in ids:
            result = client.call("entities.update", {"entity_id": ids[key], **args}, True)
        else:
            result = client.call("entities.create", {"entity_type": entity["type"], **args}, True)
            if result.get("entity"):
                ids[key] = result["entity"]["id"]
        if result.get("approval_queued") or result.get("blocked_fields"):
            raise RuntimeError("Entity change requires review: " + js(result))
        state["entities"][key] = ids[key]
        write_state(state_path, state)
    log("entities", count=len(fixture["entities"]))
    for entity in fixture["entities"]:
        resolved = resolve_metadata(entity["metadata"], ids)
        if resolved != entity["metadata"]:
            result = client.call("entities.update", {"entity_id": ids[entity["key"]], "metadata": resolved}, True)
            if result.get("approval_queued") or result.get("blocked_fields"):
                raise RuntimeError("Resolved entity fields require review: " + js(result))

    events = state["events"]
    for doc in fixture["documents"]:
        event = {"semantic_type": "content", "title": doc["title"], "content": doc["content"], "source_url": doc["source_url"],
            "metadata": {**doc["metadata"], "demo_document_key": doc["key"], "logical_source_key": doc["logical_key"]},
            "entity_ids": [ids[key] for key in doc["entity_keys"]], "occurred_at": doc["occurred_at"],
            "idempotency_key": VERSION + ":" + doc["key"]}
        if doc.get("supersedes_key"):
            event["supersedes_event_id"] = events[doc["supersedes_key"]]
        result = client.save(event)
        events[doc["key"]] = event_id(result)
        write_state(state_path, state)
    log("documents", versions=len(fixture["documents"]))

    previous_in_fixture = {}
    for row in fixture["observations"]:
        meta = resolve_metadata(row["metadata"], ids)
        meta["source_event_id"] = events[row["source_document_key"]]
        for key in ["owner_key", "holder_key", "controller_key", "portfolio_key", "lender_key", "issuer_key", "reviewer_key"]:
            if meta.get(key) in ids:
                meta["owner_entity_id"] = ids[meta[key]]
                break
        for key in ["subject_key", "instrument_key", "loan_key", "action_key"]:
            if meta.get(key) in ids:
                meta["subject_entity_id"] = ids[meta[key]]
                break
        if row["semantic_type"] == "ownership_observation":
            meta["owned_entity_id"] = meta["subject_entity_id"]
        if meta.get("subject_observation_version_key"):
            meta["observation_event_id"] = events[meta["subject_observation_version_key"]]
        event = {"semantic_type": row["semantic_type"], "title": row["logical_key"], "content": row["content"],
            "metadata": meta, "parent_event_id": meta["source_event_id"], "entity_ids": [ids[key] for key in row["entity_keys"]],
            "occurred_at": row["metadata"]["as_of"] + "T12:00:00Z", "idempotency_key": VERSION + ":" + row["key"]}
        previous = previous_in_fixture.get(row["logical_key"])
        if previous:
            event["supersedes_event_id"] = previous
        result = client.save(event)
        events[row["key"]] = event_id(result)
        # Replaying an old revision must not move the local logical head backwards.
        state["logical_events"][row["logical_key"]] = events[row["key"]]
        previous_in_fixture[row["logical_key"]] = events[row["key"]]
        write_state(state_path, state)
    log("observations", versions=len(fixture["observations"]), logical=len({x["logical_key"] for x in fixture["observations"]}))
    for rel in fixture["relationships"]:
        meta = {**resolve_metadata(rel["metadata"], ids), "source_event_id": events[rel["evidence_document_key"]]}
        if rel["key"] in state["relationships"]:
            result = client.call("entities.updateLink", {"relationship_id": state["relationships"][rel["key"]], "metadata": meta}, True)
        else:
            result = client.call("entities.link", {"from_entity_id": ids[rel["from_key"]], "to_entity_id": ids[rel["to_key"]],
                "relationship_type_slug": rel["type"], "source": "api", "metadata": meta}, True)
        if not result.get("relationship"):
            raise RuntimeError("Relationship not applied: " + js(result))
        state["relationships"][rel["key"]] = result["relationship"]["id"]
    write_state(state_path, state)
    log("relationships", count=len(fixture["relationships"]))
    return state


SCENARIO_TEXT = {
    "conflicting-sources": "45% registry and 47% analyst reports remain separate. The 60% vendor report is withdrawn. Preferred equity is a separate 20% claim.",
    "equity-voting-control": "45% ordinary equity, 72% voting rights, and a reported right to appoint 5 of 7 directors are separate facts. The control agreement awaits review.",
    "indirect-paths": "Atlas → Beacon → Ember gives conditional 27% or 28.2% interests, depending on the source. Adding the direct 10% illustrates 37% or 38.2%; it does not establish legal ownership or control.",
    "split-and-holdings": "A 2-for-1 split changes Growth's ordinary shares from 1,000 to 2,000 and Treasury's from 25,000 to 50,000. Growth's 500 preferred shares are unaffected.",
    "instruments-and-loans": "Cedar's USD 2m loan has a 4.5% fixed rate. Its separate bond pays a 4% annual coupon; 10 units produce a reported USD 200 semiannual entitlement. Manager, owner, lender and issuer roles remain distinct.",
    "correction-and-review": "The vendor corrects Cedar from 78% to 80% under the same logical claim. The original stays in history. The analyst acceptance is explicitly a simulated fixture decision.",
}


def finish(client, fixture, state_path, catalog_path):
    state = json.loads(state_path.read_text())
    ids = state["entities"]
    root = pathlib.Path(__file__).parent
    type_map = json.loads((root / "operational-type-map.json").read_text())
    mappings = json.loads((root / "operational-mappings.json").read_text())
    catalog_manifest = json.loads((pathlib.Path(catalog_path) / "manifest.json").read_text())
    classes = {r["iri"]: r for r in mappings["classes"]}
    terms = {row["key"]: row for row in type_map["entities"]}
    entity_types = sorted({row["type"] for row in fixture["entities"]})
    observation_types = sorted({row["semantic_type"].replace("_", "-") for row in fixture["observations"]})
    known = {r["slug"] for r in client.call("entitySchema.listRelTypes", {"list_scope": "organization"})["relationship_types"]}
    additions = [
        ("modeled-as", "Mapped ontology class", "Application mapping to a pinned reference class; not an OWL entailment claim.", [(a, "ontology-class") for a in entity_types]),
        ("claim-about-subject", "Claim about subject", "Subject of an evidence-backed source claim; it does not make the claim a canonical fact.", [(a,b) for a in observation_types for b in entity_types]),
        ("claim-party", "Party named by claim", "The party or portfolio named by a claim, distinct from the contextual role.", [(a,b) for a in observation_types for b in entity_types]),
        ("claim-role", "Role named by claim", "Explicit financial role named by the source claim.", [(a, "party-role") for a in observation_types]),
        ("claim-evidence-chain", "Evidence document chain", "Navigates to a document chain. The exact immutable source revision is source_event_id on the edge and claim.", [(a, "source-document") for a in observation_types]),
    ]
    for slug, name, description, pairs in additions:
        spec = {"slug": slug, "name": name, "description": description,
                "metadata_schema": {"type": "object", "x-ontology-mapping-status": "application_navigation", "properties": {"synthetic": field("boolean", const=True)}}}
        client.call("entitySchema.updateRelType" if slug in known else "entitySchema.createRelType", spec, True)
        ensure_rules(client, slug, pairs)
    native_links = state.setdefault("navigation_relationships", {})
    def link(label, source_id, source_type, target_id, target_type, metadata):
        key = f"{label}|{source_type}:{source_id}|{target_type}:{target_id}"
        metadata = {"synthetic": True, "demo_suite": VERSION, **metadata}
        if key in native_links:
            result = client.call("entities.updateLink", {"relationship_id": native_links[key], "metadata": metadata}, True)
        else:
            result = client.call("entities.link", {"from_entity_id": source_id, "from_entity_type": source_type,
                "to_entity_id": target_id, "to_entity_type": target_type, "relationship_type_slug": label,
                "source": "api", "metadata": metadata}, True)
        if not result.get("relationship"):
            raise RuntimeError("Navigation relationship not applied: " + js(result))
        native_links[key] = result["relationship"]["id"]
        write_state(state_path, state)

    for entity in fixture["entities"]:
        mapping = terms[entity["key"]]
        result = client.call("entities.update", {"entity_id": ids[entity["key"]], "metadata": {"ontology_class_iri": mapping["class_iri"]}}, True)
        if result.get("approval_queued") or result.get("blocked_fields"):
            raise RuntimeError("Mapping annotation requires review: " + js(result))
        link("modeled-as", ids[entity["key"]], entity["type"], mapping["class_iri"], "ontology-class", {"reference_id": REFERENCE, "mapping_status": "selected_application_mapping", "maturity": mapping["maturity"]})
    log("class-mappings", count=len(terms))
    rows = client.query("SELECT id,coalesce(identity_key,metadata->>'logical_observation_key',concat('v1::',md5(concat_ws('|',metadata->>'source_scope',metadata->>'source_record_key',metadata->>'statement_slot')))) AS observation_key,semantic_type,metadata FROM events "
        + f"WHERE metadata->>'mapping_version' IN ('{VERSION}','ownership-demo-v1') LIMIT 100")
    source_rows = client.query("SELECT id,coalesce(identity_key,metadata->>'logical_source_key',concat(metadata->>'source_scope','|',metadata->>'source_record_key')) AS source_key,metadata FROM events "
        + f"WHERE semantic_type='content' AND metadata->>'demo_suite' IN ('{VERSION}','ownership-demo-v1') LIMIT 100")
    doc_keys = {doc["key"]: doc["logical_key"] for doc in fixture["documents"]}
    event_source_key = {state["events"][key]: value for key, value in doc_keys.items()}
    for row in source_rows:
        event_source_key[row["id"]] = row["source_key"]
    entity_by_id = {ids[entity["key"]]: entity for entity in fixture["entities"]}
    for row in rows:
        meta, key, typ = row["metadata"], row["observation_key"], row["semantic_type"].replace("_", "-")
        if not key:
            raise RuntimeError("Claim missing stable logical record key")
        edge_meta = {"observation_event_id": row["id"], "source_event_id": meta["source_event_id"], "source_status": meta["status"]}
        for label, target_id in [("claim-about-subject", meta.get("subject_entity_id", meta.get("owned_entity_id"))), ("claim-party", meta.get("owner_entity_id")), ("claim-role", meta.get("owner_role_id"))]:
            if target_id in entity_by_id:
                link(label, key, typ, target_id, entity_by_id[target_id]["type"], edge_meta)
        source_key = event_source_key.get(meta["source_event_id"])
        if source_key:
            link("claim-evidence-chain", key, typ, source_key, "source-document", edge_meta)
    log("navigation-links", count=len(native_links))

    entity_index = [{"key": e["key"], "id": ids[e["key"]], "type": e["type"], "slug": e["slug"], "name": e["name"],
        "ontology_iri": terms[e["key"]]["class_iri"]} for e in fixture["entities"]]
    mapping_index = []
    for typ in entity_types:
        for iri in sorted({terms[e["key"]]["class_iri"] for e in fixture["entities"] if e["type"] == typ}):
            mapping_index.append({"iri": iri, "entity_type": typ, "status": "implemented", "description": "Selected application mapping; explicit contextual role where applicable."})
    for r in type_map["verified_relationship_mappings"]:
        mapping_index.append({"iri": r["property_iri"], "relationship_type": r["slug"], "status": "implemented", "description": "Native typed relationship with verified property direction and role endpoints."})
    concept_by_kind = {"ownership_observation": "ownership_context", "control_observation": "control_context", "holding_observation": "holding", "loan_observation": "loan", "corporate_action_observation": "corporate_action"}
    for kind, concept in concept_by_kind.items():
        iri = next(r["iri"] for r in mappings["classes"] if r["demo_concept"] == concept)
        mapping_index.append({"iri": iri, "event_kind": kind, "status": "about_concept", "description": "A source observation about this concept, not an assertion that the event is an instance of the class."})
    counts = fixture["counts"]["entities_by_type"]
    demo_counts = {"entities": len(entity_index), "companies": counts["company"], "people": counts["person"],
        "instruments": counts["financial-instrument"], "loans": counts["loan"], "portfolios": counts["portfolio"],
        "roles": counts["party-role"], "identifiers": counts["identifier"], "observations": len(rows),
        "observation_versions": len(fixture["observations"]), "total_observation_versions": len(fixture["observations"]) + 4,
        "relationships": len(fixture["relationships"]), "native_relationships": len(fixture["relationships"]) + len(native_links), "structural_relationships": len(fixture["relationships"]),
        "navigation_relationships": len(native_links), "source_versions": len(fixture["documents"]), "total_source_versions": len(fixture["documents"]) + 4,
        "entities_by_type": counts}
    coverage = [
        {"area": "Pinned reference catalog", "status": "imported", "description": "All 294 FIBO source documents plus 107 dependency documents are preserved. One legacy upstream aggregator import is unresolved."},
        {"area": "Parties, roles and contracts", "status": "implemented", "description": "98 records distinguish companies and people from 25 contextual issuer, shareholder, borrower, lender and guarantor roles."},
        {"area": "Evidence and revisions", "status": "implemented", "description": "Independent reports, corrections, withdrawals, dated holdings and simulated review decisions retain exact source revisions."},
        {"area": "Financial scenarios", "status": "implemented", "description": "Six connected examples cover equity, votes, control agreements, indirect paths, a share split, loans and coupon entitlements."},
        {"area": "Formal OWL reasoning", "status": "reference_only", "description": "Axioms and restrictions are inspectable. OWL entailment, consistency reasoning and complete executable financial product coverage are not enabled."},
    ]
    scenarios = [{"key": s["key"], "title": s["title"], "question": s["question"], "expected": SCENARIO_TEXT[s["key"]],
        "entity_keys": [s["focus_key"]], "checks": s["expected"]} for s in fixture["scenarios"]]
    payload = {"catalog_version": REFERENCE, "demo_suite": VERSION, "source_commit": PIN,
        "source_url": "https://github.com/edmcouncil/fibo/releases/tag/master_2026Q3",
        "catalog_counts": catalog_manifest["counts"], "demo_counts": demo_counts, "scenarios": scenarios,
        "coverage": coverage, "entity_index": entity_index, "mappings": mapping_index,
        "data_generation": "Deterministic synthetic fixture loaded through public SDK; reviews are simulated; no live financial feed or OWL reasoner."}
    encoded = js(payload).encode()
    key = VERSION + ":manifest:" + hashlib.sha256(encoded).hexdigest()[:20]
    event = {"semantic_type": "ontology_demo_manifest", "title": "Financial ontology lab coverage and scenarios", "payload_type": "empty", "metadata": payload, "idempotency_key": key}
    if state.get("manifest_id") and state.get("manifest_key") != key:
        event["supersedes_event_id"] = state["manifest_id"]
    if state.get("manifest_key") == key:
        log("manifest", id=state["manifest_id"], unchanged=True)
    else:
        result = client.save(event)
        state["manifest_id"], state["manifest_key"] = event_id(result), key
        write_state(state_path, state)
        log("manifest", id=state["manifest_id"], counts=demo_counts, bytes=len(encoded))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--org", required=True)
    parser.add_argument("command", choices=["schema", "catalog", "model", "data", "finish"])
    parser.add_argument("--catalog", default=".cache/catalog")
    parser.add_argument("--fixture", default=str(pathlib.Path(__file__).parent / "financial_demo_fixture.json"))
    parser.add_argument("--state", required=True)
    args = parser.parse_args()
    client = Lobu(args.base_url, args.org)
    if args.command == "schema":
        schema(client)
    elif args.command == "catalog":
        catalog(client, args.catalog)
    elif args.command == "model":
        model(client, json.loads(pathlib.Path(args.fixture).read_text()))
    elif args.command == "data":
        data(client, json.loads(pathlib.Path(args.fixture).read_text()), pathlib.Path(args.state))
    elif args.command == "finish":
        finish(client, json.loads(pathlib.Path(args.fixture).read_text()), pathlib.Path(args.state), args.catalog)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log("failed", error=str(error))
        sys.exit(1)
