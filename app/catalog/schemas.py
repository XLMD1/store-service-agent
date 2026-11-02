from pydantic import Field, StringConstraints, field_validator
from typing import Annotated, Literal
from uuid import uuid4

from app.auth.schemas import StrictModel


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Code = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)]


class Confirmed(StrictModel):
    confirmed: Literal[True]

    @field_validator('confirmed', mode='before')
    @classmethod
    def explicit_confirmation(cls, value):
        if value is not True:
            raise ValueError('Explicit confirmation is required')
        return value


class WarehouseCreate(Confirmed):
    code: Code = Field(default_factory=lambda: uuid4().hex)
    name: Name


class ModelCreate(Confirmed):
    name: Name
    aliases: list[Name] = Field(default_factory=list, max_length=50)


class WarehouseUpdate(Confirmed):
    expected_version: int = Field(strict=True, ge=1)
    name: Name | None = None
    code: Code | None = None
    enabled: bool | None = Field(default=None, strict=True)


class ModelUpdate(Confirmed):
    expected_version: int = Field(strict=True, ge=1)
    name: Name | None = None
    aliases: list[Name] | None = Field(default=None, max_length=50)
    enabled: bool | None = Field(default=None, strict=True)


class CustomerCreate(Confirmed):
    display_name: Name
    phone: str | None = Field(default=None, max_length=64)
    address: str | None = Field(default=None, max_length=500)
