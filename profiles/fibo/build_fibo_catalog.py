#!/usr/bin/env python3
"""Build an audited, lossless reference catalog of the complete pinned FIBO source.

This is an RDF catalog loader, not an OWL reasoner. RDFLib parses RDF/XML and
Turtle; graph-local canonical blank nodes preserve every asserted RDF statement.
Source files, licenses and a source/checksum manifest accompany JSONL/event chunks.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import pathlib
import re
import shutil
import sys
import urllib.parse
import urllib.request
import zipfile

try:
    import rdflib
except ModuleNotFoundError:
    local_deps = pathlib.Path(__file__).resolve().parent / "python-deps"
    if local_deps.exists():
        sys.path.insert(0, str(local_deps))
    import rdflib
from rdflib import Graph, URIRef, BNode, Literal, RDF, RDFS, OWL, SKOS
from rdflib.compare import to_canonical_graph

# Preserve source lexical forms as well as RDF datatype/language information.
rdflib.NORMALIZE_LITERALS = False

PIN = "2d73435a4419b66b7c9f44cb9763e35fe8ac7890"
TAG = "master_2026Q3"
REFERENCE = "fibo-2026q3"
BASE = "https://spec.edmcouncil.org/fibo/ontology/"
ARCHIVE = f"https://github.com/edmcouncil/fibo/archive/{PIN}.zip"
DOMAIN_NAMES = {
    "ACTUS": "Algorithmic Contract Types Unified Standards", "BE": "Business Entities",
    "BP": "Business Processes", "CAE": "Corporate Actions and Events",
    "DER": "Derivatives", "EXMP": "Examples", "FBC": "Financial Business and Commerce",
    "FND": "Foundations", "IND": "Indices and Indicators", "LOAN": "Loans",
    "MD": "Market Data", "SEC": "Securities", "ROOT": "FIBO release metadata",
    "Commons": "OMG Commons Ontology Library", "LCC": "Languages, Countries and Codes",
    "MVF": "Multiple Vocabulary Facility",
    "External": "Other imported standards",
}
CLASS_TYPES = {str(OWL.Class), str(RDFS.Class)}
PROPERTY_TYPES = {str(RDF.Property), str(OWL.ObjectProperty), str(OWL.DatatypeProperty),
                  str(OWL.AnnotationProperty), str(OWL.OntologyProperty)}
PROPERTY_CHARACTERISTICS = {str(OWL.FunctionalProperty), str(OWL.InverseFunctionalProperty),
                           str(OWL.TransitiveProperty), str(OWL.SymmetricProperty),
                           str(OWL.AsymmetricProperty), str(OWL.ReflexiveProperty),
                           str(OWL.IrreflexiveProperty)}
DEFINITION_PREDICATES = [str(SKOS.definition), "http://purl.org/dc/terms/description",
                         "http://purl.org/dc/elements/1.1/description", str(RDFS.comment)]
LABEL_PREDICATES = [str(RDFS.label), str(SKOS.prefLabel), "http://purl.org/dc/terms/title"]
SYNONYM_SUFFIXES = ("/synonym", "#synonym", "/abbreviation", "#abbreviation", "/acronym", "#acronym")


def dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        return target.read_bytes()
    req = urllib.request.Request(url, headers={"User-Agent": "Lobu-FIBO-reference-demo/1.0",
        "Accept": "application/rdf+xml, text/turtle;q=0.9, application/zip;q=0.8, */*;q=0.1"})
    with urllib.request.urlopen(req, timeout=50) as response:
        data = response.read(100 * 1024 * 1024 + 1)
        if len(data) > 100 * 1024 * 1024:
            raise ValueError("Download exceeds 100 MB limit")
    temporary = target.with_suffix(target.suffix + ".part")
    temporary.write_bytes(data)
    temporary.replace(target)
    return data


def acquire_source(work):
    archive = work / ("fibo-" + PIN + ".zip")
    fetch(ARCHIVE, archive)
    root = work / ("fibo-" + PIN)
    if not root.exists():
        with zipfile.ZipFile(archive) as zipped:
            for entry in zipped.infolist():
                destination = (work / entry.filename).resolve()
                if not destination.is_relative_to(work.resolve()):
                    raise ValueError("Archive path escapes acquisition directory")
                if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError("Unexpected archive symbolic link")
            zipped.extractall(work)
    return root, {"url": ARCHIVE, "sha256": sha256(archive.read_bytes()), "bytes": archive.stat().st_size}


def source_documents(root):
    return sorted(p for p in root.rglob("*") if p.suffix.lower() in {".rdf", ".ttl"}
                  and p.relative_to(root).parts[0] not in {"etc", ".git", ".github"})


def read_graph(path, public_id=None):
    graph = Graph()
    graph.parse(path, format="turtle" if path.suffix == ".ttl" else "xml", publicID=public_id)
    return graph


def ref(term):
    return "_:" + str(term) if isinstance(term, BNode) else str(term)


def literal_value(values):
    values = [v for v in values if isinstance(v, Literal)]
    if not values:
        return ""
    values.sort(key=lambda v: (0 if v.language in ("en", "en-US", "en-GB") else 1 if not v.language else 2, str(v)))
    return str(values[0])


def local_name(iri):
    return iri.rstrip("/#").rsplit("/", 1)[-1].rsplit("#", 1)[-1]


def label_from_iri(iri):
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", local_name(iri)).replace("_", " ")


def namespace(iri):
    if "#" in iri:
        return iri.rsplit("#", 1)[0] + "#"
    return iri.rsplit("/", 1)[0] + "/"


def domain_for(source_file):
    pieces = source_file.split("/")
    if pieces[0] == "dependencies":
        return pieces[1] if len(pieces) > 2 else "External"
    return pieces[0] if len(pieces) > 1 else "ROOT"


def external_candidates(iri):
    # Only known public standards are fetched. They remain preserved as snapshots.
    commons = "https://www.omg.org/spec/Commons/"
    lcc = "https://www.omg.org/spec/LCC/"
    mvf = "https://www.omg.org/spec/MVF/"
    if iri.startswith(commons):
        tail = iri[len(commons):].strip("/")
        tail = re.sub(r"^\d{8}/", "", tail)
        return [(commons + "20250801/" + tail + ".rdf", "Commons/" + tail + ".rdf")]
    if iri.startswith(lcc):
        tail = iri[len(lcc):].strip("/")
        tail = re.sub(r"^\d{8}/", "", tail)
        return [(lcc + "20211101/" + tail + ".rdf", "LCC/" + tail + ".rdf")]
    if iri.startswith(mvf):
        tail = iri[len(mvf):].strip("/")
        tail = re.sub(r"^\d{8}/", "", tail)
        return [(mvf + "20251101/" + tail + ".rdf", "MVF/" + tail + ".rdf")]
    if iri.rstrip("/#") in {"http://www.w3.org/2004/02/skos/core", "https://www.w3.org/2004/02/skos/core"}:
        return [("https://www.w3.org/2009/08/skos-reference/skos.rdf", "External/skos.rdf")]
    if iri.startswith(("http://www.omg.org/techprocess/ab/", "https://www.omg.org/techprocess/ab/")):
        name = local_name(iri)
        return [("https://www.omg.org/techprocess/ab/" + name + ".rdf", "External/" + name + ".rdf")]
    if iri.rstrip("/#") in {"http://www.w3.org/2006/time", "https://www.w3.org/2006/time"}:
        return [("https://www.w3.org/2006/time.rdf", "External/time.rdf")]
    return []


def verify_tree(root, tree_path, docs):
    if not tree_path or not tree_path.exists():
        return {"verified": False, "reason": "Pinned Git tree not supplied"}
    tree = json.loads(tree_path.read_text())
    expected = {x["path"]: x["sha"] for x in tree["tree"] if x["type"] == "blob"
                and pathlib.Path(x["path"]).suffix in {".rdf", ".ttl"}
                and pathlib.Path(x["path"]).parts[0] not in {"etc", ".git", ".github"}}
    actual = {}
    for path in docs:
        data = path.read_bytes()
        actual[path.relative_to(root).as_posix()] = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    missing = sorted(set(expected) - set(actual))
    extras = sorted(set(actual) - set(expected))
    mismatch = sorted(p for p in set(actual) & set(expected) if actual[p] != expected[p])
    result = {"verified": not (missing or extras or mismatch), "expected_documents": len(expected),
              "actual_documents": len(actual), "missing": missing, "extra": extras, "mismatched": mismatch}
    if not result["verified"]:
        raise ValueError("Source does not match pinned Git tree: " + dump(result))
    return result


def export(root, output, tree_path, fetch_dependencies, archive_info, chunk_size, chunk_bytes):
    output.mkdir(parents=True, exist_ok=True)
    docs = source_documents(root)
    verification = verify_tree(root, tree_path, docs)
    graphs = []
    errors, dependency_failures = [], []
    source_url = f"https://raw.githubusercontent.com/edmcouncil/fibo/{PIN}/"
    for index, path in enumerate(docs):
        relative = path.relative_to(root).as_posix()
        try:
            graphs.append({"graph": read_graph(path, source_url + relative), "path": path,
                           "source_file": relative, "url": source_url + relative, "external": False})
        except Exception as exc:
            errors.append({"source_file": relative, "error": str(exc)})
        if index % 50 == 0:
            print(f"Parsed {index + 1}/{len(docs)} source documents", file=sys.stderr, flush=True)
    attempted = set()
    while True:
        known = {str(s) for item in graphs for s in item["graph"].subjects(RDF.type, OWL.Ontology)}
        known.update(str(v) for item in graphs for v in item["graph"].objects(None, OWL.versionIRI))
        imported = {str(o) for item in graphs for o in item["graph"].objects(None, OWL.imports)}
        pending = sorted(imported - known - attempted)
        if not fetch_dependencies or not pending:
            break
        for iri in pending:
            attempted.add(iri)
            candidates = external_candidates(iri)
            if not candidates:
                continue
            last_error = ""
            for url, relative in candidates:
                path = output / "sources" / "dependencies" / relative
                try:
                    fetch(url, path)
                    graph = read_graph(path, url)
                    graphs.append({"graph": graph, "path": path, "source_file": "dependencies/" + relative,
                                   "url": url, "external": True, "requested_import": iri})
                    print("Fetched dependency " + relative, file=sys.stderr, flush=True)
                    break
                except Exception as exc:
                    last_error = str(exc)
            else:
                dependency_failures.append({"iri": iri, "error": last_error})
    print(f"Building catalog from {len(graphs)} parsed graphs", file=sys.stderr, flush=True)
    axiom_path = output / "axioms.jsonl"
    nquads_path = output / "asserted.nq"
    terms = collections.defaultdict(lambda: {"predicates": collections.defaultdict(set), "sources": set()})
    modules, file_rows = [], []
    blank_nodes, restrictions = set(), set()
    source_stats = {}
    imports = set()
    ontology_iris = set()
    counts_by_domain = collections.defaultdict(collections.Counter)
    axiom_count = 0
    with axiom_path.open("w") as axiom_out, nquads_path.open("w") as nq_out:
        for index, item in enumerate(graphs):
            graph, relative = item["graph"], item["source_file"]
            data = item["path"].read_bytes()
            document_hash = sha256(data)
            graph_iri = "urn:lobu:fibo:source:" + sha256(relative.encode())
            # Canonicalization gives stable blank-node identities on repeat builds.
            canonical = to_canonical_graph(graph)
            prefix = "d" + sha256(relative.encode())[:16] + "_"
            scoped = Graph()
            for s, p, o in canonical:
                scoped.add((BNode(prefix + str(s)) if isinstance(s, BNode) else s, p,
                            BNode(prefix + str(o)) if isinstance(o, BNode) else o))
            ontology_nodes = sorted(scoped.subjects(RDF.type, OWL.Ontology), key=str)
            primary = str(ontology_nodes[0]) if ontology_nodes else namespace(BASE + relative)
            ontology_iris.update(str(x) for x in ontology_nodes)
            domain_code = domain_for(relative)
            primary_maturity = []
            for subject in ontology_nodes:
                for predicate, obj in scoped.predicate_objects(subject):
                    if local_name(str(predicate)) == "hasMaturityLevel":
                        primary_maturity.append(local_name(str(obj)))
            maturity = sorted(set(primary_maturity))[0] if primary_maturity else ("external-standard" if item["external"] else "unspecified")
            metadata_types = {"Domain", "Module", "Specification"}
            module_subjects = set(ontology_nodes)
            for s, o in scoped.subject_objects(RDF.type):
                if local_name(str(o)) in metadata_types and isinstance(s, URIRef):
                    module_subjects.add(s)
            for subject in sorted(module_subjects, key=str):
                obj_types = {local_name(str(o)) for o in scoped.objects(subject, RDF.type)}
                module_kind = "domain" if "Domain" in obj_types else "module" if "Module" in obj_types else "ontology"
                ontology_imports = sorted(str(o) for o in scoped.objects(subject, OWL.imports))
                imports.update(ontology_imports)
                label = next((literal_value(scoped.objects(subject, URIRef(p))) for p in LABEL_PREDICATES
                              if literal_value(scoped.objects(subject, URIRef(p)))), label_from_iri(str(subject)))
                definition = next((literal_value(scoped.objects(subject, URIRef(p))) for p in DEFINITION_PREDICATES
                                   if literal_value(scoped.objects(subject, URIRef(p)))), "")
                modules.append({"iri": str(subject), "code": str(subject).removeprefix(BASE).strip("/"),
                    "label": label, "definition": definition, "domain_code": domain_code, "kind": module_kind,
                    "maturity": maturity, "source_file": relative, "imports": ontology_imports,
                    "version_iri": sorted(str(o) for o in scoped.objects(subject, OWL.versionIRI)),
                    "source_url": item["url"], "external": item["external"]})
            file_row = {"source_file": relative, "source_url": item["url"], "sha256": document_hash,
                "bytes": len(data), "triples": len(scoped), "ontology_iris": [str(x) for x in ontology_nodes],
                "module_iri": primary, "module_code": primary.removeprefix(BASE).strip("/"),
                "domain_code": domain_code, "maturity": maturity, "external": item["external"],
                "graph_iri": graph_iri,
                "version_iris": sorted(str(o) for o in scoped.objects(None, OWL.versionIRI)),
                "copyright": sorted(str(o) for s, p, o in scoped if local_name(str(p)) == "copyright"),
                "licenses": sorted(str(o) for s, p, o in scoped if local_name(str(p)) in {"license", "licenseURI"})}
            file_rows.append(file_row)
            source_stats[relative] = file_row
            counts_by_domain[domain_code]["files"] += 1
            counts_by_domain[domain_code]["axioms"] += len(scoped)
            for s, p, o in sorted(scoped, key=lambda t: tuple(x.n3() for x in t)):
                subject, predicate, obj = ref(s), str(p), ref(o)
                object_kind = "bnode" if isinstance(o, BNode) else "literal" if isinstance(o, Literal) else "iri"
                row = {"key": sha256((relative + "\n" + s.n3() + " " + p.n3() + " " + o.n3()).encode()),
                    "subject": subject, "predicate": predicate, "object": obj, "object_kind": object_kind,
                    "datatype": str(o.datatype) if isinstance(o, Literal) and o.datatype else None,
                    "language": o.language if isinstance(o, Literal) else None,
                    "module_iri": primary, "domain_code": domain_code, "source_file": relative}
                axiom_out.write(dump(row) + "\n")
                # n3() literals are legal N-Triples except triple-quoted multiline forms;
                # use RDFLib's N-Triples literal escaping for exact N-Quads serialization.
                from rdflib.plugins.serializers.nt import _quoteLiteral
                object_nq = _quoteLiteral(o) if isinstance(o, Literal) else o.n3()
                nq_out.write(s.n3() + " " + p.n3() + " " + object_nq + " <" + graph_iri + "> .\n")
                axiom_count += 1
                for node in (s, o):
                    if isinstance(node, BNode):
                        blank_nodes.add(ref(node))
                if p == RDF.type and o == OWL.Restriction:
                    restrictions.add(subject)
                if isinstance(s, URIRef):
                    terms[str(s)]["predicates"][predicate].add(o)
                    terms[str(s)]["sources"].add(relative)
            if not item["external"]:
                destination = output / "sources" / "fibo" / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item["path"], destination)
            if index % 40 == 0:
                print(f"Catalogued {index + 1}/{len(graphs)} graphs; {axiom_count} statements", file=sys.stderr, flush=True)
    for license_name in ("LICENSE", "README.md", "ONTOLOGY_GUIDE.md"):
        path = root / license_name
        if path.exists():
            shutil.copy2(path, output / ("FIBO-" + license_name))
    categorized = {"classes": [], "properties": [], "individuals": []}
    for iri, item in sorted(terms.items()):
        pred = item["predicates"]
        types = {str(o) for o in pred[str(RDF.type)]}
        if types & CLASS_TYPES:
            kind = "classes"
        elif types & (PROPERTY_TYPES | PROPERTY_CHARACTERISTICS):
            kind = "properties"
        elif str(OWL.Ontology) in types or any(local_name(t) in {"Domain", "Module", "Specification"} for t in types):
            continue
        elif types:
            kind = "individuals"
        else:
            # Untyped named resources still remain losslessly in asserted statements.
            continue
        sources = sorted(item["sources"])
        # Prefer the source ontology whose namespace actually defines the term.
        primary_source = max(sources, key=lambda p: (
            max([len(x) for x in source_stats[p]["ontology_iris"] if iri.startswith(x)] or [0]),
            1 if not source_stats[p]["external"] else 0,
            len([o for o in pred[str(RDFS.label)] if isinstance(o, Literal)]), -len(p)))
        source = source_stats[primary_source]
        definitions = [str(o) for p in DEFINITION_PREDICATES for o in sorted(pred[p], key=str) if isinstance(o, Literal)]
        label = next((literal_value(pred[p]) for p in LABEL_PREDICATES if literal_value(pred[p])), label_from_iri(iri))
        synonyms = {str(o) for p, values in pred.items() for o in values if isinstance(o, Literal)
                    and (p == str(SKOS.altLabel) or p.endswith(SYNONYM_SUFFIXES))}
        parents = sorted(ref(o) for o in pred[str(RDFS.subPropertyOf if kind == "properties" else RDFS.subClassOf)])
        record = {"iri": iri, "label": label, "definition": definitions[0] if definitions else "",
            "definitions": list(dict.fromkeys(definitions)), "module_iri": source["module_iri"],
            "module_code": source["module_code"], "domain_code": source["domain_code"],
            "namespace": namespace(iri), "maturity": source["maturity"], "synonyms": sorted(synonyms),
            "types": sorted(types), "parents": parents,
            "domain": sorted(ref(o) for o in pred[str(RDFS.domain)]),
            "range": sorted(ref(o) for o in pred[str(RDFS.range)]),
            "inverse": sorted(ref(o) for o in pred[str(OWL.inverseOf)]),
            "equivalent": sorted({ref(o) for p in (OWL.equivalentClass, OWL.equivalentProperty) for o in pred[str(p)]}),
            "disjoint": sorted(ref(o) for o in pred[str(OWL.disjointWith)]),
            "restrictions": [o for o in parents if o in restrictions],
            "source_file": primary_source, "source_files": sources,
            "source_url": source["source_url"], "external": source["external"],
            "deprecated": any(str(o).lower() in {"true", "1"} for o in pred[str(OWL.deprecated)]),
            "characteristics": sorted(types & PROPERTY_CHARACTERISTICS)}
        categorized[kind].append(record)
        counts_by_domain[source["domain_code"]][kind] += 1
    # Deduplicate module declarations while retaining every source triple separately.
    unique_modules = {x["iri"]: x for x in modules}
    categorized["modules"] = sorted(unique_modules.values(), key=lambda x: (x["domain_code"], x["iri"]))
    for row in categorized["modules"]:
        counts_by_domain[row["domain_code"]]["modules"] += 1
    for kind, rows in categorized.items():
        with (output / (kind + ".jsonl")).open("w") as stream:
            for row in rows:
                stream.write(dump(row) + "\n")
    with (output / "files.jsonl").open("w") as stream:
        for row in file_rows:
            stream.write(dump(row) + "\n")
    known_versions = {v for file in file_rows for v in file["version_iris"]}
    unresolved = sorted(imports - ontology_iris - known_versions)
    manifest = {
        "reference_id": REFERENCE, "catalog_version": REFERENCE, "release_tag": TAG,
        "commit_sha": PIN, "release_url": "https://github.com/edmcouncil/fibo/releases/tag/" + TAG,
        "source_repository": "https://github.com/edmcouncil/fibo", "archive": archive_info,
        "source_tree_verification": verification, "built_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "parser": {"name": "rdflib", "version": rdflib.__version__, "blank_nodes": "canonical per source graph; source-scoped", "reasoning": "none"},
        "scope": "All RDF/XML and Turtle ontology/reference/example documents in the pinned FIBO repository, excluding etc tooling/test fixtures; imported official dependency snapshots included when resolved",
        "counts": {**{kind: len(rows) for kind, rows in categorized.items()}, "axioms": axiom_count,
            "restrictions": len(restrictions), "blank_nodes": len(blank_nodes), "files": len(file_rows),
            "fibo_files": len(docs), "dependency_files": sum(f["external"] for f in file_rows)},
        "domains": [{"code": code, "label": DOMAIN_NAMES.get(code, code), **dict(counts_by_domain[code])}
                    for code in sorted(counts_by_domain)],
        "maturity": dict(collections.Counter(f["maturity"] for f in file_rows)),
        "parse_errors": errors, "dependency_failures": dependency_failures,
        "unresolved_imports": unresolved, "all_source_documents_parsed": not errors,
        "complete_import_closure": not unresolved,
        "dependency_pins": {"Commons": "https://www.omg.org/spec/Commons/20250801/", "LCC": "https://www.omg.org/spec/LCC/20211101/", "MVF": "https://www.omg.org/spec/MVF/20251101/"},
        "licenses": {"FIBO": "FIBO-LICENSE", "dependencies": "Original copyright/license annotations preserved in sources and asserted graph; see files.jsonl"},
        "checksums": {},
    }
    with (output / "events.jsonl").open("w") as event_stream:
        chunk_counts = {}
        for kind in ("classes", "properties", "individuals", "modules", "axioms"):
            items, size, index = [], 0, 0
            def emit():
                nonlocal items, size, index
                if not items:
                    return
                metadata = {"reference_id": REFERENCE, "catalog_version": REFERENCE,
                    "release_tag": TAG, "commit_sha": PIN, "chunk_kind": kind, "item_kind": kind,
                    "chunk_index": index, "item_count": len(items), "items": items}
                range_field = "subject" if kind == "axioms" else "iri"
                range_values = [row[range_field] for row in items]
                metadata[range_field + "_min"] = min(range_values)
                metadata[range_field + "_max"] = max(range_values)
                event_stream.write(dump({"kind": "ontology_catalog_chunk",
                    "idempotency_key": f"{REFERENCE}:{kind}:{index}", "metadata": metadata}) + "\n")
                index += 1
                items, size = [], 0
            with (output / (kind + ".jsonl")).open() as source:
                for line in source:
                    item = json.loads(line)
                    item_bytes = len(line.encode())
                    if items and (len(items) >= chunk_size or size + item_bytes > chunk_bytes):
                        emit()
                    items.append(item)
                    size += item_bytes
            emit()
            chunk_counts[kind] = index
        manifest["chunk_counts"] = chunk_counts
    # Verify the artifacts actually contain every item counted in memory.
    validation = {"line_counts": {}, "chunk_item_counts": {}, "max_event_bytes": 0,
                  "max_event_nodes": 0, "max_event_depth": 0}
    for kind in ("classes", "properties", "individuals", "modules", "axioms", "files"):
        with (output / (kind + ".jsonl")).open() as stream:
            actual_count = sum(1 for _ in stream)
        expected_count = manifest["counts"][kind]
        if actual_count != expected_count:
            raise ValueError(f"{kind} artifact count {actual_count} != expected {expected_count}")
        validation["line_counts"][kind] = actual_count
    event_counts = collections.Counter()
    def structure_stats(value, depth=0):
        if isinstance(value, dict):
            child_stats = [structure_stats(v, depth+1) for v in value.values()]
        elif isinstance(value, list):
            child_stats = [structure_stats(v, depth+1) for v in value]
        else:
            return 1, depth
        return 1 + sum(n for n, d in child_stats), max([depth] + [d for n, d in child_stats])
    with (output / "events.jsonl").open() as stream:
        for line in stream:
            event = json.loads(line)
            meta = event["metadata"]
            event_counts[meta["chunk_kind"]] += len(meta["items"])
            byte_count = len(dump(meta).encode())
            node_count, max_depth = structure_stats(meta)
            validation["max_event_bytes"] = max(validation["max_event_bytes"], byte_count)
            validation["max_event_nodes"] = max(validation["max_event_nodes"], node_count)
            validation["max_event_depth"] = max(validation["max_event_depth"], max_depth)
            if byte_count >= 120000 or node_count >= 8000 or max_depth >= 30:
                raise ValueError(f"Chunk exceeds demo safety bounds: bytes={byte_count}, nodes={node_count}, depth={max_depth}")
    for kind, count in event_counts.items():
        if count != manifest["counts"][kind]:
            raise ValueError(f"Chunked {kind} count {count} != expected {manifest['counts'][kind]}")
    validation["chunk_item_counts"] = dict(event_counts)
    validation["passed"] = True
    manifest["artifact_validation"] = validation
    for name in ("classes.jsonl", "properties.jsonl", "individuals.jsonl", "modules.jsonl", "axioms.jsonl", "files.jsonl", "asserted.nq", "events.jsonl"):
        path = output / name
        manifest["checksums"][name] = {"sha256": sha256(path.read_bytes()), "bytes": path.stat().st_size}
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    (output / "manifest-event.json").write_text(json.dumps({"kind": "ontology_catalog_manifest",
        "idempotency_key": REFERENCE + ":manifest", "metadata": manifest}, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"counts": manifest["counts"], "domains": manifest["domains"],
        "maturity": manifest["maturity"], "parse_errors": errors, "unresolved_imports": unresolved,
        "source_tree_verification": verification, "chunk_counts": chunk_counts}, indent=2))
    if errors:
        raise SystemExit("Source parse failures; do not advertise full coverage")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", type=pathlib.Path, default=pathlib.Path(__file__).parent / "acquired")
    parser.add_argument("--source", type=pathlib.Path, help="Existing exact pinned source checkout; otherwise download immutable archive")
    parser.add_argument("--output", type=pathlib.Path, default=pathlib.Path(__file__).parent / "catalog")
    parser.add_argument("--tree", type=pathlib.Path, default=pathlib.Path(__file__).parent / "pinned-source-tree.json")
    parser.add_argument("--no-dependencies", action="store_true")
    parser.add_argument("--chunk-size", type=int, default=80)
    parser.add_argument("--chunk-bytes", type=int, default=90000)
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    root, archive_info = (args.source, None) if args.source else acquire_source(args.work)
    export(root, args.output, args.tree, not args.no_dependencies, archive_info, args.chunk_size, args.chunk_bytes)


if __name__ == "__main__":
    main()
