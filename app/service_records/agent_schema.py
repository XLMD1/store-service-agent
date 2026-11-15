from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.sources.schemas import check_text


Intent = Literal['lookup', 'new', 'supplement']


class ServiceTaskInput(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ServiceTaskCreate(ServiceTaskInput):
    request_id: UUID
    text: str = Field(min_length=1, max_length=10000)

    @field_validator('text')
    @classmethod
    def valid_text(cls, value):
        check_text(value)
        if not value.strip():
            raise ValueError('A task description is required')
        return value


class ServiceTaskVersion(ServiceTaskInput):
    version: int = Field(ge=1, strict=True)


class ServiceTaskConfigure(ServiceTaskVersion):
    intent: Intent
    lookup: str = Field(default='', max_length=500)
    content: str = Field(default='', max_length=4000)

    @field_validator('lookup', 'content')
    @classmethod
    def checked_text(cls, value):
        check_text(value)
        return value.strip()


class ServiceTaskSelect(ServiceTaskVersion):
    contact_id: UUID | None = None
    record_id: UUID | None = None

    @model_validator(mode='after')
    def one_candidate(self):
        if (self.contact_id is None) == (self.record_id is None):
            raise ValueError('Choose one candidate')
        return self
