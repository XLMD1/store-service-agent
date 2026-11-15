import re
from datetime import date
from unicodedata import normalize

from app.service_records.archive import phone_key
from app.service_records.schemas import DraftFields


LABELS = {
    '姓名': 'customer_name', '客户': 'customer_name', '客户称呼': 'customer_name',
    '电话': 'phone', '联系电话': 'phone', '手机': 'phone', '手机号': 'phone',
    '地址': 'address', '服务地址': 'address',
    '问题': 'problem', '问题描述': 'problem', '故障': 'problem', '故障描述': 'problem',
    '型号': 'model', '设备型号': 'model', '故障码': 'error_code',
    '维修日期': 'repair_date', '维修时间': 'repair_date',
    '处理': 'treatment', '处理方法': 'treatment',
    '配件': 'parts', '更换配件': 'parts', '结果': 'result', '实际结果': 'result',
}
RECORD_MARKER = re.compile(r'(?:第[0-9]+条(?:记录)?|记录[0-9]+):?')
REPAIR_DATE = re.compile(r'([0-9]{4})(?:-([0-9]{1,2})(?:-([0-9]{1,2}))?)?')
CHINESE_DATE = re.compile(r'([0-9]{4})年(?:([0-9]{1,2})月(?:([0-9]{1,2})日)?)?')
OCR_HAN_SPACING = re.compile(r'(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])')
MAX_RECORDS = 20


def parse_repair_date(value):
    value = ''.join(normalize('NFKC', value).split())
    match = REPAIR_DATE.fullmatch(value) or CHINESE_DATE.fullmatch(value)
    if not match:
        return None, 'unknown'
    year, month, day = match.groups()
    try:
        parsed = date(int(year), int(month or '1'), int(day or '1')).isoformat()
    except ValueError:
        return None, 'unknown'
    if day:
        return parsed, 'day'
    if month:
        return parsed[:7], 'month'
    return parsed[:4], 'year'


def extract_fields(text, *, from_photo=False):
    records = []
    fields = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or RECORD_MARKER.fullmatch(''.join(normalize('NFKC', line).split())):
            if fields:
                records.append(fields)
                fields = {}
            continue
        label, *values = re.split(r'[:：]', line, maxsplit=1)
        field = LABELS.get(''.join(label.split()))
        if not field or not values or not values[0].strip():
            continue
        if field in fields:
            raise ValueError('Repeated field without a record separator')
        value = values[0].strip()
        fields[field] = OCR_HAN_SPACING.sub('', value) if from_photo else value
    if fields:
        records.append(fields)
    if not records or len(records) > MAX_RECORDS:
        raise ValueError('Unsupported number of extracted records')

    drafts = []
    for fields in records:
        uncertain = list(fields) if from_photo else []
        if fields.get('phone') and not phone_key(fields['phone']) and 'phone' not in uncertain:
            uncertain.append('phone')
        if 'repair_date' in fields:
            fields['repair_date'], precision = parse_repair_date(fields['repair_date'])
            fields['repair_date_precision'] = precision
            if precision == 'unknown' and 'repair_date' not in uncertain:
                uncertain.append('repair_date')
        drafts.append(DraftFields(**fields, uncertain_fields=uncertain))
    return drafts
