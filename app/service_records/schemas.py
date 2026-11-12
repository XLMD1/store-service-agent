import re
from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.sources.schemas import check_text


ReviewField = Literal['customer_name', 'phone', 'address', 'problem', 'model', 'error_code',
                      'repair_date', 'treatment', 'parts', 'result']
DATE_FORMATS = {
    'year': (r'[0-9]{4}', '-01-01'),
    'month': (r'[0-9]{4}-[0-9]{2}', '-01'),
    'day': (r'[0-9]{4}-[0-9]{2}-[0-9]{2}', ''),
}


class DraftFields(BaseModel):
    model_config = ConfigDict(extra='forbid')

    customer_name: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=100)
    address: str | None = Field(default=None, max_length=500)
    problem: str | None = Field(default=None, max_length=4000)
    model: str | None = Field(default=None, max_length=100)
    error_code: str | None = Field(default=None, max_length=100)
    repair_date: str | None = Field(default=None, max_length=10)
    repair_date_precision: Literal['unknown', 'year', 'month', 'day'] = 'unknown'
    treatment: str | None = Field(default=None, max_length=4000)
    parts: str | None = Field(default=None, max_length=4000)
    result: str | None = Field(default=None, max_length=4000)
    uncertain_fields: list[ReviewField] = Field(default_factory=list, max_length=10)

    @field_validator('customer_name', 'phone', 'address', 'problem', 'model', 'error_code',
                     'treatment', 'parts', 'result')
    @classmethod
    def validate_text(cls, value):
        if value is not None:
            check_text(value)
        return value

    @model_validator(mode='after')
    def validate_date(self):
        if self.repair_date_precision == 'unknown':
            if self.repair_date is not None:
                raise ValueError('Unknown repair date must be empty')
        else:
            pattern, suffix = DATE_FORMATS[self.repair_date_precision]
            if self.repair_date is None or not re.fullmatch(pattern, self.repair_date):
                raise ValueError('Repair date must match its precision')
            date.fromisoformat(self.repair_date + suffix)
        return self


class DraftInput(BaseModel):
    model_config = ConfigDict(extra='forbid')

    fields: DraftFields


class DraftCreate(DraftInput):
    request_id: UUID


class DraftUpdate(DraftInput):
    version: int = Field(ge=1, strict=True)
