from app.knowledge.repair import evidence_segments


def test_evidence_prefers_the_requested_table_row_over_earlier_keywords():
    rows = ['排气口会冒白烟'] + [f'其余现象及表格原文第{i}条' for i in range(1, 8)]
    relevant = '现象【供暖系统水压异常降低】｜可能原因【供暖系统渗漏】'
    rows.append(relevant)
    assert relevant in evidence_segments('\n'.join(rows), ['供暖系统水压异常降低', '排气口冒白烟', '排气口会冒白烟'])


def test_evidence_matches_shortened_search_terms_to_the_original_row():
    rows = ['排气口会冒白烟'] + [f'其余现象及表格原文第{i}条' for i in range(1, 8)]
    relevant = '现象【从泄压管流出水来】｜原因及处理方法【说明书中的对应文字】'
    rows.append(relevant)
    assert relevant in evidence_segments('\n'.join(rows), ['泄压管出水', '排气口会冒白烟'])


def test_evidence_keeps_non_fault_heading_for_a_later_row_in_its_table():
    heading = '有以下情况发生时并非故障状况。'
    prior_rows = [f'现象【样例现象{i}】｜原因及处理方法【样例说明】' for i in range(7)]
    relevant = '现象【从样例管流出水来】｜原因及处理方法【样例说明】'
    excerpt = '\n'.join([heading, *prior_rows, relevant])
    result = evidence_segments(excerpt, ['样例管出水'])
    assert heading in result
    assert relevant in result
    assert len(result) <= 6
    other_section = '\n'.join([heading, *prior_rows, '其他异常现象', prior_rows[0], relevant])
    assert heading not in evidence_segments(other_section, ['样例管出水'])
