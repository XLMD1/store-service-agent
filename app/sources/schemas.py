from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator


class TextSourceCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')

    request_id: UUID
    text: str = Field(min_length=1, max_length=100_000)
    source_kind: Literal['chat', 'paper', 'other'] | None = None
    source_label: str | None = Field(default=None, max_length=100)
    message_time: AwareDatetime | None = None
    page_label: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=500)

    @field_validator('text', 'source_label', 'page_label', 'note')
    @classmethod
    def valid_text(cls, value):
        if value is not None:
            value.encode('utf-8')
            if '\x00' in value:
                raise ValueError('NUL is not valid in source text')
        return value

    @field_validator('text')
    @classmethod
    def nonempty_original(cls, value):
        if not value.strip():
            raise ValueError('Source text is empty')
        return value
