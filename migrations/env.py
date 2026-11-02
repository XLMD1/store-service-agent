from alembic import context
from sqlalchemy import create_engine

from app.config import Settings
from app.db import Base
from app.auth import models  # noqa: F401
from app.catalog import models as catalog_models  # noqa: F401
from app.inventory import models as inventory_models  # noqa: F401
from app.operations import models as operation_models  # noqa: F401


url = context.config.attributes.get('database_url') or Settings.load().database_url
engine = create_engine(url, hide_parameters=True)
with engine.connect() as connection:
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()
engine.dispose()
