from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


Role = Literal['clerk', 'technician', 'stock_operator', 'owner']


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Login(StrictModel):
    username: str = Field(min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_.-]+$')
    password: SecretStr = Field(min_length=1, max_length=256)


class AccountCreate(Login):
    password: SecretStr = Field(min_length=12, max_length=256)
    roles: list[Role] = Field(min_length=1, max_length=4)
    confirmed: Literal[True]

    @field_validator('confirmed', mode='before')
    @classmethod
    def explicit_confirmation(cls, value):
        if value is not True:
            raise ValueError('Explicit confirmation is required')
        return value


class AccountUpdate(StrictModel):
    roles: list[Role] | None = Field(default=None, min_length=1, max_length=4)
    enabled: bool | None = Field(default=None, strict=True)
    confirmed: Literal[True]

    @field_validator('confirmed', mode='before')
    @classmethod
    def explicit_confirmation(cls, value):
        return AccountCreate.explicit_confirmation(value)
