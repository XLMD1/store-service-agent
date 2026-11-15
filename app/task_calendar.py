from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException


def month_range(month):
    zone = ZoneInfo('Asia/Shanghai')
    try:
        year, number = map(int, month.split('-'))
        start = datetime(year, number, 1, tzinfo=zone)
        end = datetime(year + (number == 12), number % 12 + 1, 1, tzinfo=zone)
    except ValueError:
        raise HTTPException(422, 'Invalid calendar month') from None
    return start, end
