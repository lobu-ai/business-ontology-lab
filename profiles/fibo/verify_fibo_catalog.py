#!/usr/bin/env python3
"""Independent structural audit and per-source RDF-isomorphism round trip."""
import argparse
import collections
import json
import pathlib

import build_fibo_catalog as build
from rdflib import Dataset, URIRef
from rdflib.compare import isomorphic


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("catalog", type=pathlib.Path)
    args = parser.parse_args()
    folder = args.catalog
    manifest = json.loads((folder / "manifest.json").read_text())
    dataset = Dataset()
    dataset.parse(folder / "asserted.nq", format="nquads")
    source_files = [json.loads(line) for line in (folder / "files.jsonl").open()]
    mismatches = []
    total = 0
    for item in source_files:
        local = folder / "sources" / item["source_file"] if item["external"] else folder / "sources" / "fibo" / item["source_file"]
        original = build.read_graph(local, item["source_url"])
        restored = dataset.graph(URIRef(item["graph_iri"]))
        same = isomorphic(original, restored)
        total += len(restored)
        if len(restored) != item["triples"] or not same:
            mismatches.append({"source_file": item["source_file"], "expected": len(original),
                               "restored": len(restored), "isomorphic": same})
    keys = set()
    duplicate_keys = 0
    subject_nodes = set()
    object_nodes = set()
    for line in (folder / "axioms.jsonl").open():
        row = json.loads(line)
        if row["key"] in keys:
            duplicate_keys += 1
        keys.add(row["key"])
        if row["subject"].startswith("_:"):
            subject_nodes.add(row["subject"])
        if row["object_kind"] == "bnode":
            object_nodes.add(row["object"])
    # RDF permits blank nodes used only as an object, so report rather than reject them.
    dangling = sorted(object_nodes - subject_nodes)
    result = {"passed": not mismatches and total == manifest["counts"]["axioms"] and not duplicate_keys,
        "source_graphs_checked": len(source_files), "source_graphs_isomorphic": len(source_files) - len(mismatches),
        "nquads_source_statements": total, "unique_axiom_keys": len(keys),
        "duplicate_axiom_keys": duplicate_keys, "blank_nodes_with_no_outgoing_triples": dangling,
        "mismatches": mismatches}
    (folder / "roundtrip-verification.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
