from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.sources.schemas import check_text


def clean_text(value):
    check_text(value)
    return value


ShortText = Annotated[str, Field(min_length=1, max_length=100), AfterValidator(clean_text)]
Location = Annotated[str, Field(min_length=1, max_length=500), AfterValidator(clean_text)]
Description = Annotated[str, Field(min_length=1, max_length=2000), AfterValidator(clean_text)]
Cents = Annotated[int, Field(ge=0, le=100_000_000, strict=True)]
Version = Annotated[int, Field(ge=1, strict=True)]
FeeState = Literal['assigned', 'review', 'payable', 'deducted', 'paid']


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


class WorkFields(Input):
    kind: Literal['installation', 'repair']
    location: Location
    description: Description
    scheduled_on: date | None = None
    service_record_id: UUID | None = None
    reference: ShortText | None = None


class FeeItem(Input):
    name: ShortText
    quantity: int = Field(ge=1, le=10000, strict=True)
    amount_cents: Cents


class ReportFields(Input):
    worked_on: date
    result: Description
    items: list[FeeItem] = Field(min_length=1, max_length=20)
    reported_deduction_cents: Cents | None = None

    @property
    def total(self):
        return sum(item.amount_cents for item in self.items)

    @model_validator(mode='after')
    def bounded_total(self):
        if self.total > 100_000_000:
            raise ValueError('Fee total exceeds limit')
        return self


class JobCreate(ConfirmedInput):
    request_id: UUID
    work: WorkFields
    worker_ids: list[UUID] = Field(min_length=1, max_length=20)

    @field_validator('worker_ids')
    @classmethod
    def unique_workers(cls, values):
        if len(set(values)) != len(values):
            raise ValueError('Workers must be distinct')
        return values


class WorkReport(Input):
    request_id: UUID
    work: WorkFields
    report: ReportFields


class WorkerAdd(ConfirmedInput):
    worker_id: UUID


class ReportUpdate(Input):
    operation_id: UUID
    version: Version
    report: ReportFields


class Approve(Input):
    action: Literal['approve']
    amount_cents: Cents
    reason: Description | None = None


class Settle(Input):
    action: Literal['paid', 'deducted']
    occurred_on: date
    note: Description
    collected_cents: Cents | None = None
    returned_cents: Cents | None = None

    @model_validator(mode='after')
    def deduction_evidence(self):
        if self.action == 'paid' and (self.collected_cents is not None or self.returned_cents is not None):
            raise ValueError('Collection evidence applies to a deduction')
        if self.collected_cents is not None and self.returned_cents is not None and self.returned_cents > self.collected_cents:
            raise ValueError('Returned amount exceeds collection')
        return self


class Reopen(Input):
    action: Literal['reopen']
    reason: Description


class CorrectAmount(Input):
    action: Literal['correct_amount']
    amount_cents: Cents
    reason: Description


class FeeDecision(ConfirmedInput):
    operation_id: UUID
    version: Version
    decision: Annotated[Approve | Settle | Reopen | CorrectAmount, Field(discriminator='action')]


class Backfill(ConfirmedInput):
    request_id: UUID
    work: WorkFields
    worker_id: UUID
    report: ReportFields
    cutoff_on: date
    amount_cents: Cents
    reason: Description
    settlement: Settle | None = None
