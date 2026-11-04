from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.auth.router import router
from app.config import Settings
from app.db import create_database
from app.catalog.router import router as catalog_router
from app.inventory.router import router as inventory_router
from app.operations.router import router as operations_router
from app.agent.router import router as agent_router


def create_app(settings: Settings | None = None):
    settings = settings or Settings.load()
    app = FastAPI(title='门店助手 API', docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.engine, app.state.sessions = create_database(settings)

    @app.middleware('http')
    async def private_responses(request: Request, call_next):
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request, error):
        # Pydantic errors otherwise echo raw input, including submitted passwords.
        return JSONResponse(status_code=422, content={'detail': [
            {'loc': list(item['loc']), 'type': item['type'], 'msg': 'Invalid input'}
            for item in error.errors()]})

    app.include_router(router)
    app.include_router(catalog_router)
    app.include_router(inventory_router)
    app.include_router(operations_router)
    app.include_router(agent_router)
    web = Path(__file__).parent / 'web'
    app.mount('/web', StaticFiles(directory=web), name='web')

    @app.get('/', include_in_schema=False)
    def home():
        return FileResponse(web / 'index.html')
    return app
