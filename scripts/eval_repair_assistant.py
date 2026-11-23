"""Compare the same model with no manuals, the full corpus, and the local RAG entry point."""

import argparse
import json
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.engine import make_url

from app.agent.provider import DeepSeekPlanner, ProviderUnavailable
from app.auth.models import User
from app.auth.service import initialize_owner
from app.config import Settings
from app.knowledge.repair import evidence_segments, select_prompt, validated_points
from app.main import create_app
from tests.integration.test_auth import create_user, csrf, login
from tests.integration.test_knowledge_versions import create_version, import_data, sign_in, transition, transition_data


def seed_manuals(owner, worker, suffix, sources, state):
    manuals = []
    for i, row in enumerate(sources):
        model = 'QA-' + row['model'] + '-' + suffix
        path = create_version(owner, import_data(models=[model], document_code=f'QA-{suffix}-{i}',
                                                 title=row['title'], edition='D'))
        assert transition(worker, path, transition_data('review', 1)).status_code == 200
        assert transition(owner, path, transition_data('publish', 2)).status_code == 200
        state.knowledge_ocr = lambda _, item=row: item['title'] + '\n' + item['excerpt']
        endpoint = path + '/index-drafts'
        recognized = worker.post(endpoint+'/recognize', headers=csrf(worker), json={'first_page':1, 'last_page':1})
        assert recognized.status_code == 200
        saved = worker.post(endpoint+'/confirm', headers=csrf(worker), json={'confirmed':True, 'entries':[
            {'page':1, 'revision':0, 'title':row['title'], 'keywords':row['keywords'], 'source_excerpt':row['excerpt']},
        ]})
        assert saved.status_code == 200, saved.text
        manuals.append({'version_id':path.rsplit('/',1)[-1], 'model':model, 'excerpt':row['excerpt']})
    return manuals


def score(case, status, points, sources, expected_source):
    if case['expected'] != 'answered':
        return (status == case['expected'] or status == 'insufficient') and not points
    if status != 'answered' or not points:
        return False
    return (all(sources[point['source']-1]['version_id'] == expected_source['version_id'] for point in points)
            and any(point['kind']=='meaning' and case['meaning'] in point['quote'] for point in points))


def compare(worker, state, provider, data, manuals, suffix):
    prompt = select_prompt()
    report = []
    for case in data['cases']:
        question = {key:case[key] for key in ('model','problem','condition')}
        question['model'] = 'QA-' + case['model'] + '-' + suffix if case['model'] else ''
        row = {'id':case['id'], 'expected':case['expected'], 'runs':{}}
        expected = manuals[case['source']] if 'source' in case else None
        full_context = [{'version_id':source['version_id'],'model':source['model'], 'source':i,
                         'segments':evidence_segments(source['excerpt'])} for i,source in enumerate(manuals,1)]
        for name, sources in (('direct', []), ('all_materials', full_context), ('rag', None)):
            start = perf_counter()
            usage = {'total_tokens':0, 'calls':0}

            def call(context):
                usage['calls'] += 1
                content, billed = provider.complete_json(prompt,context)
                usage.update(billed)
                return content

            status, points = 'provider_error', []
            try:
                if sources is None:
                    state.repair_responder = call
                    response = worker.post('/api/repair/ask',headers=csrf(worker),json=question)
                    assert response.status_code == 200, response.text
                    result = response.json()
                    status, points, sources = result['status'], result.get('points',[]), result['sources']
                else:
                    status, points = validated_points(call({**question,'sources':sources}),sources,question['condition'])
            except ProviderUnavailable:
                pass
            except (ValueError, TypeError):
                status = 'invalid_citation'
            row['runs'][name] = {'status':status, 'passed':score(case,status,points,sources,expected),
                                 'elapsed_ms':round((perf_counter()-start)*1000), **usage, 'points':points}
        report.append(row)
        print(case['id'], [(name, run['status']) for name, run in row['runs'].items()], flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--deepseek-config', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    settings = Settings.load(Path('.local/test.json'))
    url = make_url(settings.database_url)
    if (url.host, url.database) != ('127.0.0.1','store_agent_m1_test'):
        raise SystemExit('The evaluator writes synthetic records to the dedicated test database only.')
    provider = DeepSeekPlanner(Settings.load(Path(args.deepseek_config)).deepseek_settings_file)
    if not provider.available:
        raise SystemExit('DeepSeek unavailable in the existing configuration.')
    data = json.loads(Path('evals/repair/comparison-cases.json').read_text(encoding='utf-8'))
    app = create_app(settings)
    with app.state.sessions.begin() as db:
        if db.scalar(select(User.id)) is None:
            initialize_owner(db,'demo-owner','Sample-Owner-Password-123',confirmed=True)
    suffix = uuid4().hex[:8]
    username = 'repair-eval-' + suffix
    with TestClient(app) as owner, TestClient(app) as worker:
        login(owner)
        create_user(owner,username,['technician'])
        sign_in(worker,username)
        manuals = seed_manuals(owner,worker,suffix,data['sources'],app.state)
        rows = compare(worker,app.state,provider,data,manuals,suffix)
    report = {'scope':data['scope'], 'model':provider.model, 'results':rows,
              'note':'按预期状态、版次原文及故障含义自动评分。各组使用同一模型；RAG 的缺型号、未知型号和紧急场景有本地分流。'}
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


if __name__ == '__main__':
    main()
