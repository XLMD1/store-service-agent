import re
import unicodedata


NUMERALS = '零〇一二两三四五六七八九十百千'


def number(value):
    value = unicodedata.normalize('NFKC', value)
    if re.fullmatch(r'[0-9]+', value):
        return int(value)
    if not value or any(char not in NUMERALS for char in value):
        return None
    digits = dict(zip('零〇一二两三四五六七八九', [0,0,1,2,2,3,4,5,6,7,8,9]))
    if not any(char in '十百千' for char in value):
        if len(value) > 1 and not any(char in '零〇' for char in value):
            return None
        return int(''.join(str(digits[char]) for char in value))
    total, digit, last_unit = 0, 0, 10000
    for char in value:
        if char in digits:
            if digit and digits[char]:
                return None
            digit = digits[char]
        else:
            unit = {'十':10, '百':100, '千':1000}[char]
            if unit >= last_unit:
                return None
            total, digit, last_unit = total+(digit or 1)*unit, 0, unit
    if last_unit > 10 and digit and not value.endswith(('零'+value[-1], '〇'+value[-1])):
        return None
    return total+digit


def warehouse_name(value):
    value = unicodedata.normalize('NFKC', value).strip().casefold()
    return re.sub(r'([0-9'+NUMERALS+r']+)(?:号)?(?:仓库|库房|库)$',
        lambda match: str(number(match[1]))+'号库' if number(match[1]) is not None else match[0], value)


def literal_quote(quote, text):
    boundary = r'A-Za-z0-9０-９.'+NUMERALS
    left = NUMERALS if quote[0] in NUMERALS else boundary
    pattern = r'(?<!['+left+r'])'+re.escape(quote)+r'(?!['+boundary+r'年月日号])'
    return any(not re.search(r'(?:不是|并非|未|没|不|约|至少|至多|少于|多于|不到|到|至)\s*$', text[:match.start()])
               for match in re.finditer(pattern, text))


def grounded_plan(plan, text):
    """Validate extracted values, never infer actions or fill missing fields."""
    common = {'id', 'action', 'basis_note', 'evidence'}
    fields = {
        'query_inventory': {'warehouse','model'},
        'query_reservations': {'warehouse','model','customer'},
        'query_statistics': {'warehouse','model','start','end','group_by'},
        'query_ledger': {'warehouse','model','start','end'},
        'inventory_opening': {'warehouse','model','t0','on_hand','opening_reserved'},
        'inventory_inbound': {'warehouse','model','quantity','occurred'},
        'inventory_outbound': {'warehouse','model','quantity','occurred'},
        'inventory_adjustment': {'warehouse','model','on_hand','occurred'},
        'inventory_correction': {'reference','new_quantity'},
        'reservation_create': {'warehouse','model','customer','quantity','occurred','basis_kind'},
        'reservation_pickup': {'warehouse','model','customer','reference','quantity','occurred'},
        'reservation_cancel': {'warehouse','model','customer','reference','quantity','occurred'},
    }
    basis = {'oral':r'口头(?:留货|预留|约定)?', 'deposit':r'(?:已收|已付|收到)(?:定金|订金)',
             'paid':r'(?:已收|已付|收到)全款|(?:货款)?已付清'}
    for step in plan.steps:
        allowed = common | fields[step.action]
        for field, definition in type(step).model_fields.items():
            if field not in allowed:
                setattr(step, field, definition.default)
        step.evidence = {key: quote for key, quote in step.evidence.items() if key in allowed}
        for field in ['quantity','on_hand','opening_reserved','new_quantity','basis_kind']:
            value, quote = getattr(step, field), step.evidence.get(field, '')
            if value is None:
                continue
            valid = bool(quote and literal_quote(quote, text))
            if field == 'basis_kind':
                valid = valid and bool(re.fullmatch(basis[value], quote))
            else:
                match = re.fullmatch(r'([0-9０-９'+NUMERALS+r']+)\s*(?:台|个|件|套|部|箱)?', quote)
                valid = valid and bool(match and number(match[1]) == value)
            if not valid:
                setattr(step, field, None)
                step.evidence.pop(field, None)
        if step.basis_note not in text:
            step.basis_note = ''
    return plan
