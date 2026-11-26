"""HTTP timing for the local benchmark process only."""
from math import ceil
from time import perf_counter

from app.main import create_app


def timed_app():
    application = create_app()

    async def wrapper(scope, receive, send):
        if scope['type'] != 'http':
            return await application(scope, receive, send)
        start = perf_counter()

        async def timed_send(message):
            if message['type'] == 'http.response.start':
                elapsed = (perf_counter() - start) * 1000
                message['headers'].append((b'x-benchmark-app-ms', f'{elapsed:.3f}'.encode('ascii')))
            await send(message)

        await application(scope, receive, timed_send)

    return wrapper


def print_timings(samples, label, count):
    rows = [(client, server) for key, client, server in samples if key == label]
    assert len(rows) == count
    for name, values in zip(('client', 'server'), zip(*rows)):
        times = sorted(values)
        print(f'{label} {name} n={count} p95={times[ceil(.95 * count) - 1]:.1f} ms max={max(times):.1f} ms')
