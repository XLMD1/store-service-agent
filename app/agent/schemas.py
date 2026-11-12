import re
from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import AwareDatetime, Field, SecretStr, field_validator

from app.auth.schemas import StrictModel
from app.operations.schemas import Occurred


Action = Literal['query_inventory', 'query_reservations', 'query_statistics', 'query_ledger',
                 'inventory_opening', 'inventory_inbound', 'inventory_outbound', 'reservation_create',
                 'reservation_pickup', 'reservation_cancel', 'inventory_adjustment', 'inventory_correction']


class PlanStep(StrictModel):
    id: UUID | None = None
    action: Action
    warehouse: str = Field(default='', max_length=100)
    model: str = Field(default='', max_length=100)
    customer: str = Field(default='', max_length=200)
    reference: str = Field(default='', max_length=100, description='仅提货/取消的预留编号或更正的原单编号；不是到货/领用/留货依据文本')
    quantity: int | None = Field(default=None, strict=True, ge=1, le=2147483647)
    on_hand: int | None = Field(default=None, strict=True, ge=0, le=2147483647)
    opening_reserved: int | None = Field(default=None, strict=True, ge=0, le=2147483647)
    new_quantity: int | None = Field(default=None, strict=True, ge=0, le=2147483647)
    t0: AwareDatetime | None = None
    occurred: Occurred | None = None
    basis_note: str = Field(default='', max_length=1000, description='依据的原文连续引文，如虚构到货单；输入给出依据时必须填写此字段')
    basis_kind: Literal['oral', 'deposit', 'paid'] | None = None
    start: date | None = None
    end: date | None = None
    group_by: Literal['date', 'warehouse', 'model'] = 'date'
    evidence: dict[Literal['quantity','on_hand','opening_reserved','new_quantity','basis_kind'],
                   Annotated[str, Field(min_length=1, max_length=100)]] = Field(default_factory=dict)

    @field_validator('occurred', mode='before')
    @classmethod
    def local_occurrence_time(cls, value):
        if isinstance(value, dict) and value.get('precision') == 'datetime':
            timestamp = value.get('at')
            if isinstance(timestamp, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?', timestamp):
                local = datetime.fromisoformat(timestamp).replace(tzinfo=ZoneInfo('Asia/Shanghai'))
                return {**value, 'at': local}
        return value


class Plan(StrictModel):
    steps: list[PlanStep] = Field(default_factory=list, max_length=4)
    question: str = Field(default='', max_length=1000)


class TaskCreate(StrictModel):
    request_id: UUID
    text: str = Field(min_length=1, max_length=10000)

    @field_validator('text')
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError('Task text is required')
        return value.strip()


class TaskRun(StrictModel):
    expected_version: int = Field(strict=True, ge=1)
    reply: str = Field(default='', max_length=5000)


class Selection(TaskRun):
    item_id: UUID
    field: Literal['warehouse', 'model', 'customer', 'reference']
    value: UUID


class ProviderSettings(StrictModel):
    api_key: SecretStr = Field(min_length=8, max_length=512)
    confirmed: Literal[True]

    @field_validator('api_key')
    @classmethod
    def valid_key(cls, value):
        key = value.get_secret_value()
        if not key.isascii() or any(char.isspace() for char in key):
            raise ValueError('Invalid key')
        return value

    @field_validator('confirmed', mode='before')
    @classmethod
    def explicit_confirmation(cls, value):
        if value is not True:
            raise ValueError('Explicit confirmation required')
        return value
