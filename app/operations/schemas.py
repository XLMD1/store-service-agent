from datetime import date as CalendarDate, timezone
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, field_validator, model_validator

from app.auth.schemas import StrictModel


class OpeningReservation(StrictModel):
    customer_id: UUID
    remaining_quantity: int = Field(strict=True, ge=1, le=2147483647)
    basis_note: str = Field(min_length=1, max_length=1000)


class OpeningParameters(StrictModel):
    warehouse_id: UUID | None = None
    model_id: UUID | None = None
    t0: AwareDatetime | None = None
    on_hand: int | None = Field(default=None, strict=True, ge=0, le=2147483647)
    opening_reservations: list[OpeningReservation] = Field(default_factory=list, max_length=500)
    basis_note: str = Field(default='', max_length=1000)

    @field_validator('t0')
    @classmethod
    def canonical_time(cls, value):
        return value.astimezone(timezone.utc) if value else value


class DraftCreate(StrictModel):
    kind: Literal['inventory_opening', 'inventory_inbound']
    parameters: dict


class DraftUpdate(StrictModel):
    expected_version: int = Field(strict=True, ge=1)
    parameters: dict


class Confirmation(StrictModel):
    draft_id: UUID
    draft_version: int = Field(strict=True, ge=1)
    parameters: dict


class Occurred(StrictModel):
    precision: Literal['date', 'datetime']
    date: CalendarDate | None = None
    at: AwareDatetime | None = None
    t0_relation: Literal['after', 'at_or_before', 'unknown'] | None = None
    boundary_note: str = Field(default='', max_length=1000)

    @field_validator('at')
    @classmethod
    def canonical_time(cls, value):
        return value.astimezone(timezone.utc) if value else value

    @model_validator(mode='after')
    def matching_precision(self):
        if self.precision == 'date' and self.at is not None:
            raise ValueError('Date-only events cannot contain an invented time')
        if self.precision == 'datetime' and (self.date is not None or self.t0_relation is not None or self.boundary_note):
            raise ValueError('Precise timestamps do not use date-only boundary assertions')
        return self


class InboundParameters(StrictModel):
    warehouse_id: UUID | None = None
    model_id: UUID | None = None
    quantity: int | None = Field(default=None, strict=True, ge=1, le=2147483647)
    occurred: Occurred | None = None
    basis_note: str = Field(default='', max_length=1000)
