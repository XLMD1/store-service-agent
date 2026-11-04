from typing import TypedDict

from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph import END, START, StateGraph
from langsmith import tracing_context
from sqlalchemy.engine import make_url

from app.agent.schemas import Plan


class PlanningState(TypedDict, total=False):
    text: str
    catalog: dict
    previous: list
    plan: dict
    usage: dict


def plan_task(settings, thread_id, planner, text, catalog, previous):
    url = make_url(settings.database_url).set(drivername='postgresql').render_as_string(hide_password=False)
    with tracing_context(enabled=False), PostgresSaver.from_conn_string(url) as saver:
        def parse(state):
            plan, usage = planner.parse(state['text'], state['catalog'], state['previous'])
            return {'plan': Plan.model_validate(plan).model_dump(mode='json'), 'usage': usage}
        builder = StateGraph(PlanningState)
        builder.add_node('parse', parse)
        builder.add_edge(START, 'parse')
        builder.add_edge('parse', END)
        graph = builder.compile(checkpointer=saver)
        config = {'configurable': {'thread_id': thread_id}, 'recursion_limit': 3}
        saved = graph.get_state(config)
        if saved.values.get('plan') and not saved.next:
            return saved.values
        return graph.invoke(None if saved.next else {'text': text, 'catalog': catalog, 'previous': previous}, config)
