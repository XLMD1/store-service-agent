from fastapi.testclient import TestClient

from app.agent.provider import ProviderUnavailable
from tests.integration.test_auth import create_user, csrf, login
from tests.integration.test_knowledge_versions import create_version, import_data, sign_in, transition, transition_data


def test_assistant_checks_model_evidence_risk_and_feedback(application):
    seen = []
    valid = {'status': 'answered', 'points': [
        {'kind': 'meaning', 'source': 1, 'segment': 1},
        {'kind': 'check', 'source': 1, 'segment': 2},
    ]}

    def answer(context):
        seen.append(context)
        return valid

    application.state.repair_responder = answer
    with TestClient(application) as owner, TestClient(application) as technician:
        login(owner)
        create_user(owner, 'repair-tech', ['technician'])
        sign_in(technician, 'repair-tech')

        def query(model, problem, condition=''):
            response = technician.post('/api/repair/ask', headers=csrf(technician),
                                       json={'model':model, 'problem':problem, 'condition':condition})
            assert response.status_code == 200, response.text
            return response.json()

        assert query('', '闻到燃气味，怎么修')['status'] == 'urgent'
        assert query('', '炉子着火了')['status'] == 'urgent'
        assert query('SAMPLE-10', '锅炉打不着火')['status'] == 'no_evidence'
        assert query('', '这个锅炉报 E3')['status'] == 'need_model'
        assert query('SAMPLE-10', 'E3')['status'] == 'no_evidence'
        path = create_version(owner, import_data(models=['SAMPLE-1']))
        assert transition(technician, path, transition_data('review', 1)).status_code == 200
        assert transition(owner, path, transition_data('publish', 2)).status_code == 200
        assert query('SAMPLE-1', 'E3')['status'] == 'no_evidence'
        index = {'title': '样例故障说明', 'keywords': 'E3 传感器检查', 'revision': 0, 'confirmed': True}
        assert technician.put(path+'/pages/1/index',headers=csrf(technician),json=index).status_code == 200
        assert query('SAMPLE-1', 'E3')['status'] == 'source_only'
        assert not seen
        application.state.knowledge_ocr = lambda _: '使用说明书\n样例故障说明\nE3 指样例传感器检查提示。\n样例补充说明用于测试。'
        draft = technician.post(path+'/index-drafts/recognize', headers=csrf(technician), json={'first_page':1,'last_page':1})
        assert draft.status_code == 200
        approved={**{key: value for key, value in index.items() if key!='confirmed'}, 'page':1, 'revision':1,
                  'source_excerpt':'E3 指样例传感器检查提示。\n当样例设备进入保护状态，请先停止演示，然后联系样例人员。'}
        assert technician.post(path+'/index-drafts/confirm', headers=csrf(technician),
                               json={'confirmed':True,'entries':[approved]}).status_code == 200
        result = query('SAMPLE-1', '壁挂炉报E3怎么办')
        assert result['status'] == 'answered'
        assert len(seen) == 1 and seen[0]['model'] == 'SAMPLE-1'
        assert result['points'][0]['quote'] == 'E3 指样例传感器检查提示。'
        assert [point['kind'] for point in result['points']] == ['meaning']
        assert result['sources'][0]['original_url'] == path + '/pages/1'
        assert query('SAMPLE-1', '壁挂炉报E3怎么办') == result
        assert len(seen) == 1
        changed = query('SAMPLE-1', '壁挂炉报E3怎么办', '样例屏幕持续显示代码')
        assert changed['answer_id'] != result['answer_id']
        assert len(seen) == 2
        feedback_path = '/api/repair/answers/' + result['answer_id'] + '/feedback'
        feedback = {'rating':'wrong_source','note':'虚构回归测试反馈'}
        assert owner.post(feedback_path, headers=csrf(owner), json=feedback).status_code == 404
        assert technician.post(feedback_path, headers=csrf(technician), json=feedback).status_code == 200
        assert technician.post(feedback_path, headers=csrf(technician), json=feedback).json() == {'saved':True}
        review_path = '/api/repair/feedback'
        assert technician.get(review_path).status_code == 403
        review = owner.get(review_path)
        assert review.status_code == 200, review.text
        [reviewed] = review.json()['items']
        assert review.json()['next_offset'] is None
        assert reviewed['answer_id'] == result['answer_id'] and reviewed['actor'] == 'repair-tech'
        assert reviewed['answered_at'] and reviewed['feedback'] == feedback
        assert reviewed['model'] == 'SAMPLE-1' and reviewed['points'] == result['points']
        assert reviewed['sources'] == result['sources'] and 'request_key' not in reviewed
        assert owner.get(review_path, params={'offset': 1}).json()['items'] == []
        application.state.repair_responder=lambda _: {'status':'answered','points':[
            {'kind':'meaning','source':1,'segment':99}]}
        assert query('SAMPLE-1','E3')['status']=='source_only'

        manufacturer_note = '当设备显示样例状态时，请先联系样例服务人员。'
        explicit = {**approved, 'revision': 2, 'keywords': 'E3 E30',
                    'source_excerpt': f'E30：样例供水异常\nE3：样例传感器故障\n{manufacturer_note}'}
        assert technician.post(path+'/index-drafts/confirm', headers=csrf(technician),
                               json={'confirmed':True,'entries':[explicit]}).status_code == 200

        def unused_model(_):
            seen.append('unexpected model request')
            return {'status':'insufficient','points':[]}

        application.state.repair_responder = unused_model
        direct = query('SAMPLE-1','E3')
        assert direct['status'] == 'answered'
        assert direct['origin'] == 'manual'
        assert direct['passages'] == [{'source':1,'text':'E3：样例传感器故障\n'+manufacturer_note}]
        assert direct['manufacturer_guidance'] == [{'source':1,'quote':manufacturer_note}]
        assert query('SAMPLE-1', 'E30')['manufacturer_guidance'] == []
        for extra, expected in [('闻到燃气味','urgent'), ('现在报 E30','need_code')]:
            reply = technician.post('/api/repair/ask',headers=csrf(technician),
                                    json={'model':'SAMPLE-1','problem':'E3','question':extra})
            assert reply.json()['status'] == expected
        assert direct['points'] == [{'kind':'meaning','source':1,'quote':'E3：样例传感器故障','condition':''}]
        assert direct['sources'][0]['original_url'] == path + '/pages/1'
        observed = []

        def followup_reply(context):
            observed.append(context)
            return {'status':'answered','points':[{'kind':'action','source':1,'segment':3,'condition_segment':2}]}

        application.state.repair_responder = followup_reply
        followup = {'model':'SAMPLE-1','problem':'E3','question':'接下来呢？','previous_answer_id':direct['answer_id']}
        reply = technician.post('/api/repair/ask',headers=csrf(technician),json=followup).json()
        assert reply['status'] == 'source_only'
        assert observed[0]['previous_quotes'] == ['E3：样例传感器故障'] and not observed[0]['condition']
        application.state.repair_responder = unused_model

        draft = technician.post(path+'/index-drafts/recognize', headers=csrf(technician),
                                json={'first_page':2,'last_page':2})
        assert draft.status_code == 200
        verified_table = {**approved, 'page':2, 'revision':0, 'keywords':'指示压力下降', 'source_excerpt': '\n'.join([
            '现象【指示压力下降、显示数值不稳】｜可能原因【样例管路渗漏】｜处理方法【由样例人员检查】',
            '现象【指示压力下降】｜可能原因【样例阀未拧紧】｜处理方法【由样例人员复核】',
            '现象【水流指示异常】｜可能原因【样例传感器故障】｜处理方法【另行核对】',
        ])}
        assert technician.post(path+'/index-drafts/confirm', headers=csrf(technician),
                               json={'confirmed':True,'entries':[verified_table]}).status_code == 200
        symptom = query('SAMPLE-1', '指示压力下降')
        assert symptom['status'] == 'answered'
        assert [(point['kind'],point['quote']) for point in symptom['points']] == [
            ('candidate','样例管路渗漏'), ('candidate','样例阀未拧紧'),
        ]
        assert symptom['sources'][0]['original_url'] == path + '/pages/2'
        assert 'unexpected model request' not in seen
        application.state.repair_responder = lambda _: {'status':'answered','points':[
            {'kind':'meaning','source':1,'segment':2}]}
        updated = query('SAMPLE-1', '壁挂炉报E3怎么办')
        assert updated['answer_id'] != result['answer_id']
        assert updated['points'][0]['quote'] == 'E3：样例传感器故障'

        def unavailable(_):
            raise ProviderUnavailable('sandbox model unavailable')

        application.state.repair_responder = unavailable
        degraded = query('SAMPLE-1', 'E3', '样例屏幕仍显示 E3')
        assert degraded['status'] == 'source_only'
        assert '模型暂时未能完成答复' in degraded['message']
        assert degraded['sources'][0]['original_url'] == path + '/pages/1'

        competing = create_version(owner, import_data(document_code='SAMPLE-OVERLAP'))
        assert query('SAMPLE-1', 'E3')['sources'][0]['original_url'] == path + '/pages/1'
        assert transition(owner, competing, transition_data('review', 1)).status_code == 200
        assert transition(owner, competing, transition_data('publish', 2)).status_code == 200
        assert owner.put(competing+'/pages/1/index', headers=csrf(owner), json=index).status_code == 200
        conflict = query('SAMPLE-1','E3')
        assert conflict['status'] == 'conflict'
        assert {source['original_url'] for source in conflict['sources']} == {path+'/pages/1',competing+'/pages/1'}
        assert 'points' not in conflict
        assert transition(owner,competing,transition_data('retire',3)).status_code == 200
        assert transition(owner,path,transition_data('retire',3)).status_code==200
        assert query('SAMPLE-1','E3')['status']=='no_evidence'
