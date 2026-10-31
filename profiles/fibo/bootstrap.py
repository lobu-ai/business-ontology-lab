#!/usr/bin/env python3
"""Recreate the financial profile in a fresh workspace, without a prior local database."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import sys
from apply_demo import Lobu, schema, model, data, catalog, finish, event_id, write_state
ROOT = pathlib.Path(__file__).resolve().parent

def seed_baseline(client, state_path):
    state = json.loads(state_path.read_text())
    company_ids = [state['entities']['company:demo-atlas'], state['entities']['company:demo-beacon']]
    saved = state.setdefault('baseline_events', {})
    for scope, record, initial, corrected, withdrawn in [('demo-registry','annual-2025',40,45,False),('demo-vendor','report-2025',60,60,True)]:
        previous_source = previous_observation = None
        for revision, percentage, status in [('r1',initial,'reported'),('r2',corrected,'retracted' if withdrawn else 'reported')]:
            key = scope + ':' + revision
            source_meta = {'demo_suite':'ownership-demo-v1','synthetic':True,'source_scope':scope,'source_record_key':record,'source_revision':revision,'as_of':'2025-12-31','logical_source_key':scope+'|'+record}
            source = {'semantic_type':'content','title':'Synthetic ownership source '+key,'content':'SYNTHETIC: '+scope+' reports '+str(percentage)+' percent ordinary equity as of 2025-12-31; status '+status+'.','metadata':source_meta,'entity_ids':company_ids,'occurred_at':'2026-01-'+('15' if revision=='r1' else '20')+'T12:00:00Z','idempotency_key':'fibo-baseline-source:'+key}
            if previous_source: source['supersedes_event_id'] = previous_source
            source_id = event_id(client.save(source))
            logical_key = 'v1::'+hashlib.sha256((scope+'|'+record+'|equity').encode()).hexdigest()[:24]
            metadata = {'source_scope':scope,'source_record_key':record,'source_revision':revision,'statement_slot':'equity','owner_entity_id':company_ids[0],'owned_entity_id':company_ids[1],'percentage':percentage,'basis':'equity','share_class':'ordinary','as_of':'2025-12-31','status':status,'mapping_version':'ownership-demo-v1','synthetic':True,'source_event_id':source_id,'logical_observation_key':logical_key}
            observation = {'semantic_type':'ownership_observation','title':'Synthetic ordinary equity report '+key,'content':source['content'],'metadata':metadata,'entity_ids':company_ids,'parent_event_id':source_id,'occurred_at':source['occurred_at'],'idempotency_key':'fibo-baseline-observation:'+key}
            if previous_observation: observation['supersedes_event_id'] = previous_observation
            observation_id = event_id(client.save(observation))
            saved[key]={'source':source_id,'observation':observation_id}
            previous_source, previous_observation = source_id, observation_id
            write_state(state_path,state)
    print(json.dumps({'baseline_source_versions':4,'baseline_observation_versions':4}))

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url',required=True)
    parser.add_argument('--org',default='fibo-demo')
    parser.add_argument('--home-org',default='local-install')
    parser.add_argument('--catalog',type=pathlib.Path,required=True)
    parser.add_argument('--state',type=pathlib.Path)
    parser.add_argument('--skip-catalog',action='store_true',help='Only for a workspace whose exact pinned catalog is already installed')
    args=parser.parse_args()
    if not args.org or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in args.org):raise ValueError('Invalid workspace slug')
    state_path=args.state or ROOT.parent.parent/'.runtime'/args.org/'fibo-state.json'
    state_path.parent.mkdir(parents=True,exist_ok=True)
    owner=Lobu(args.base_url,args.home_org)
    orgs=owner.call('organizations.list',{})
    if not any(x['slug']==args.org for x in orgs):owner.request('/api/auth/organization/create',{'name':'FIBO financial ontology demo','slug':args.org,'metadata':{'purpose':'synthetic-fibo-evaluation'}})
    client=Lobu(args.base_url,args.org)
    fixture=json.loads((ROOT/'financial_demo_fixture.json').read_text())
    schema(client)
    model(client,fixture)
    if not args.skip_catalog:catalog(client,args.catalog)
    data(client,fixture,state_path)
    seed_baseline(client,state_path)
    finish(client,fixture,state_path,args.catalog)
    client.call("views.set", {"source_code": (ROOT/"overview.tsx").read_text()}, True)
    result=subprocess.run([sys.executable,str(ROOT/'verify_live_demo.py'),'--base-url',args.base_url,'--org',args.org,'--fixture',str(ROOT/'financial_demo_fixture.json'),'--state',str(state_path),'--output',str(state_path.parent/'fibo-verification.json'),'--require-manifest'])
    if result.returncode:raise SystemExit(result.returncode)
    print(json.dumps({'status':'verified','organization':args.org,'state':str(state_path),'scope':'Pinned reference catalog and six synthetic financial scenarios, not full OWL reasoning'}))

if __name__=='__main__':main()
