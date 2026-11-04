from dataclasses import replace
import os

from fastapi.testclient import TestClient

from tests.integration.test_auth import csrf, login, create_user


def isolated_settings(application,tmp_path):
    application.state.settings=replace(application.state.settings,deepseek_settings_file=str(tmp_path/'deepseek.json'))
    return tmp_path/'deepseek.json'


def test_owner_can_replace_and_clear_local_key_without_disclosure(application,tmp_path,monkeypatch):
    from app.agent.provider import DeepSeekPlanner
    target=isolated_settings(application,tmp_path)
    monkeypatch.setenv('DEEPSEEK_API_KEY','synthetic-environment-key')
    with TestClient(application) as client:
        login(client)
        for key in ['synthetic-local-first-key','synthetic-local-replacement-key']:
            response=client.post('/api/agent/settings',headers=csrf(client),json={'api_key':key,'confirmed':True})
            assert response.status_code==200,response.text
            assert response.json()['configured'] and response.json()['source']=='local'
            assert key not in response.text
            assert key not in client.get('/api/agent/settings').text
            if os.name=='nt':assert key not in target.read_text(encoding='utf-8')
            planner=DeepSeekPlanner(target)
            assert planner.available and planner.key()==key
        cleared=client.delete('/api/agent/settings',headers=csrf(client))
        assert cleared.status_code==200 and not cleared.json()['configured']
        assert not DeepSeekPlanner(target).available
        # A new provider/process must respect the persisted stop instead of restoring env key.
        assert client.get('/api/agent/status').json()['configured'] is False
        assert target.exists()


def test_only_owner_can_read_or_change_settings(application,tmp_path):
    target=isolated_settings(application,tmp_path)
    with TestClient(application) as owner:
        login(owner)
        create_user(owner)
    with TestClient(application) as client:
        login(client,{'username':'demo-stock','password':'Sample-Stock-Password-123'})
        assert client.get('/api/agent/settings').status_code==403
        assert client.post('/api/agent/settings',headers=csrf(client),json={
            'api_key':'synthetic-not-authorized','confirmed':True}).status_code==403
        assert client.delete('/api/agent/settings',headers=csrf(client)).status_code==403
    assert not target.exists()


def test_settings_require_csrf_confirmation_and_valid_key_without_echo(application,tmp_path):
    target=isolated_settings(application,tmp_path)
    with TestClient(application) as client:
        login(client)
        data={'api_key':'synthetic-sensitive-key','confirmed':True}
        assert client.post('/api/agent/settings',json=data).status_code==403
        assert client.delete('/api/agent/settings').status_code==403
        for update in [{'api_key':'bad\nsynthetic-sensitive-key'}, {'confirmed':False}, {'api_key':''}]:
            response=client.post('/api/agent/settings',headers=csrf(client),json={**data,**update})
            assert response.status_code==422
            assert 'synthetic-sensitive-key' not in response.text
    assert not target.exists()
