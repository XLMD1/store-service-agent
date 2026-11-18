from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.sources.schemas import check_text


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class ConfirmedInput(Input):
    confirmed: bool = Field(strict=True)

    @field_validator('confirmed')
    @classmethod
    def explicit_confirmation(cls, value):
        if not value:
            raise ValueError('Explicit confirmation is required')
        return value


Page = Annotated[int, Field(ge=1, le=9999, strict=True)]
ExtraPages = Annotated[int, Field(ge=0, le=20, strict=True)]
ModelName = Annotated[str, StringConstraints(min_length=1, max_length=100)]


class ScanInput(Input):
    first_page: Page
    last_page: Page
    leading_pages: ExtraPages = 0
    trailing_pages: ExtraPages = 0
    image_base64: str = Field(min_length=1)

    @model_validator(mode='after')
    def valid_range(self):
        if self.last_page < self.first_page:
            raise ValueError('Scan page ranges must be at least one page')
        return self


class ManualImport(ConfirmedInput):
    request_id: UUID
    title: str = Field(min_length=1, max_length=200)
    document_code: str = Field(min_length=1, max_length=80)
    edition: str = Field(min_length=1, max_length=80)
    models: list[ModelName] = Field(min_length=1, max_length=30)
    scans: list[ScanInput] = Field(min_length=1, max_length=40)

    @model_validator(mode='after')
    def validate_metadata(self):
        for value in [self.title, self.document_code, self.edition, *self.models]:
            check_text(value)
        if len({name.casefold() for name in self.models}) != len(self.models):
            raise ValueError('Applicable model names must be distinct')
        for previous, current in zip(self.scans, self.scans[1:]):
            if current.first_page != previous.last_page + 1:
                raise ValueError('Scan page ranges must be consecutive')
        return self


class Transition(ConfirmedInput):
    version: int = Field(ge=1, strict=True)
    operation_id: UUID
    action: Literal['review', 'publish', 'retire']
    note: str = Field(min_length=1, max_length=1000)

    @field_validator('note')
    @classmethod
    def valid_note(cls, value):
        check_text(value)
        return value
