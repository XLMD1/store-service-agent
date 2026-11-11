from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator


class SourceCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')

    request_id: UUID
    source_kind: Literal['chat', 'paper', 'other'] | None = None
    source_label: str | None = Field(default=None, max_length=100)
    message_time: AwareDatetime | None = None
    page_label: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=500)

    @field_validator('source_label', 'page_label', 'note')
    @classmethod
    def valid_metadata(cls, value):
        if value is not None:
            check_text(value)
        return value


class TextSourceCreate(SourceCreate):
    text: str = Field(min_length=1, max_length=100_000)

    @field_validator('text')
    @classmethod
    def nonempty_original(cls, value):
        check_text(value)
        if not value.strip():
            raise ValueError('Source text is empty')
        return value


class PhotoSourceCreate(SourceCreate):
    image_base64: str = Field(min_length=1)


def check_text(value):
    value.encode('utf-8')
    if '\x00' in value:
        raise ValueError('NUL is not valid in source text')
