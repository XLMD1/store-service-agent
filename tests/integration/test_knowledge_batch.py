from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from tests.integration.test_auth import create_user, csrf, login
from tests.integration.test_knowledge_versions import create_version, import_data, sign_in, transition, transition_data
from tests.integration.test_repair_retrieval import search


def test_batch_ocr_retains_drafts_and_confirms_selected_pages(application):
    runs = []

    def recognize(data):
        with Image.open(BytesIO(data)) as image:
            runs.append(image.getpixel((0, 0)))
        if len(runs) == 2:
            raise OSError('sample failure')
        if len(runs) == 3:
            return '使用说明书\n故障分析\n供暖系统渗漏\n图\n表\n误'
        return ('使用说明书\n故障、异常的判断及处理方法\nE 3 供暖温度传感器故障\n'
                '控制器显示故障码时应核对说明书。' if runs[-1] == (255, 0, 0) else
                '使用说明书\n故障分析\n供暖系统渗漏\n原页说明用于核对记录。')

    application.state.knowledge_ocr = recognize
    with TestClient(application) as owner, TestClient(application) as technician, TestClient(application) as clerk:
        login(owner)
        create_user(owner, 'batch-tech', ['technician'])
        create_user(owner, 'batch-clerk', ['clerk'])
        sign_in(technician, 'batch-tech')
        sign_in(clerk, 'batch-clerk')
        path = create_version(owner, import_data())
        batch = path + '/index-drafts'
        limits = {'first_page': 1, 'last_page': 2}
        listing = batch + '?first_page=1&last_page=2'

        def generate(client, **changes):
            return client.post(batch + '/recognize', headers=csrf(client), json={**limits, **changes})

        def confirm(client, entries, confirmed=True):
            return client.post(batch + '/confirm', headers=csrf(client), json={'entries': entries, 'confirmed': confirmed})

        assert generate(technician).status_code == 409
        assert transition(technician, path, transition_data('review', 1)).status_code == 200
        assert transition(owner, path, transition_data('publish', 2)).status_code == 200
        assert generate(clerk).status_code == 403
        assert clerk.get(listing).status_code == 403
        assert generate(technician, last_page=3).status_code == 404
        assert not runs
        generated = generate(technician)
        assert generated.status_code == 200, generated.text
        first, failed = generated.json()['items']
        assert (first['page'], first['status'], first['title']) == (1, 'ready', '故障、异常的判断及处理方法')
        assert first['keywords'].split()[0] == 'E3'
        assert first['original_url'] == path + '/pages/1'
        assert technician.get(first['original_url']).status_code == 200
        assert (failed['page'], failed['status']) == (2, 'failed')
        assert search(clerk, 'SAMPLE-1', 'E3')['status'] == 'no_index'
        assert technician.get(listing).json() == generated.json()

        second = generate(technician, first_page=2).json()['items'][0]
        assert (second['page'], second['status']) == (2, 'needs_review')
        assert generate(technician, retry=True).status_code == 422
        second = generate(technician, first_page=2, retry=True).json()['items'][0]
        assert (second['page'], second['status']) == (2, 'ready')
        assert len(runs) == 4
        assert generate(technician).status_code == 200
        assert len(runs) == 4

        def entry(row, **changes):
            return {**{key: row[key] for key in ('page', 'revision', 'title', 'keywords', 'source_excerpt')}, **changes}

        selected = entry(first, keywords='E3 供暖温度传感器故障', source_excerpt='控制器显示故障码时应核对说明书。')
        assert confirm(clerk, [selected]).status_code == 403
        assert confirm(technician, [selected], confirmed=False).status_code == 422
        assert confirm(technician, [selected, selected]).status_code == 422
        rejected = confirm(technician, [selected, entry(second, revision=9)])
        assert rejected.status_code == 409
        assert search(clerk, 'SAMPLE-1', 'E3')['status'] == 'no_index'

        saved = confirm(technician, [selected])
        assert saved.status_code == 200, saved.text
        assert confirm(technician, [selected]).json() == saved.json()
        assert search(clerk, 'SAMPLE-1', '供暖系统渗漏')['status'] == 'no_match'
        hits = search(clerk, 'SAMPLE-1', '控制器显示故障码')['items']
        assert [hit['page'] for hit in hits] == [1]
        assert hits[0]['source_excerpt'] == selected['source_excerpt']
        assert search(clerk, 'SAMPLE-1', 'E30')['status'] == 'no_match'
        assert search(clerk, 'SAMPLE-10', 'E3')['status'] == 'unsupported_model'
        assert generate(technician).json()['items'][0]['current']['keywords'] == selected['keywords']
        assert confirm(technician, [entry(second)]).status_code == 200
        assert search(clerk, 'SAMPLE-1', '供暖系统渗漏')['items'][0]['page'] == 2
        assert transition(owner, path, transition_data('retire', 3)).status_code == 200
        assert generate(technician).status_code == 409
        assert confirm(technician, [selected]).status_code == 409
        assert search(clerk, 'SAMPLE-1', 'E3')['status'] == 'unsupported_model'
        assert clerk.get(first['original_url']).status_code == 200
