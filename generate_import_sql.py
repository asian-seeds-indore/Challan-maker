#!/usr/bin/env python3
"""
Generates import_challans.sql — run the output in Supabase SQL Editor.
Uses the same parser + fixes as dryrun_import.py.
"""

import xlrd, openpyxl, uuid
from datetime import datetime, date
from collections import defaultdict

EXCEL_PATH  = "/Users/radhikavarma/Downloads/Soybean Dispatch - 2026.xls"
DIST_XLSX   = "/Users/radhikavarma/Desktop/ASN-Challan/distributors_clean.xlsx"
RETAIL_XLSX = "/Users/radhikavarma/Desktop/ASN-Challan/retailers_clean.xlsx"
OUT_SQL     = "/Users/radhikavarma/Desktop/ASN-Challan/import_challans.sql"

ASN_MAX_DC   = 231
ASIAN_MAX_DC = 320

DATA_FIXES = {
    ("ASN", 107, "Asian-777"): 9.99,
}

PACKING = {
    "JS-335":          30.0,
    "JS-9305":         30.0,
    "JS-9560":         30.0,
    "RVSM-1135":       30.0,
    "KDS-726":         30.0,
    "Asian-777":       27.0,
    "Asian Sanjivani": 27.0,
    "Confidence":      27.0,
    "Krushi Gold-151": 25.0,
    "Game Changer":    25.0,
}

VARIETY_COLS_ASN   = {6:"JS-335", 7:"JS-9305", 8:"JS-9560",
                      9:"RVSM-1135", 10:"KDS-726", 11:"Asian-777",
                      12:"Asian Sanjivani", 13:"Confidence"}
VARIETY_COLS_ASIAN = {6:"JS-335", 7:"JS-9305", 8:"JS-9560",
                      9:"Krushi Gold-151", 10:"Game Changer"}

EXCEL_DIST_MAP = {
    "SAI KRUPA KRISHI VIKAS KENDRA":   "SAI KRUPA KVK",
    "JAI KISAN KRISHI SEVA KENDRA":    "Jai Kisan Krishi Kendra",
    "JAISWAL KRISHI SEVA KENDRA":      "Jaiswal Krishi Kendra",
    "RAMLINGESHWAR FERTILIZER":        "Ramlingeshwar Fertilizers",
    "GIRIRAJ TRADING CO.":             "GIRIRAJ TRADING CO.",
    "SHRIPAD KRISHI KENDRA":           "Sripad Krishi Seva Kendra",
    "KOTKAR AGRO TRADERS":             "Kotkar Agro",
    "RAM KRISHI KENDRA":               "Ram Krushi Kendra",
    "GANESH KRISHI VIKAS KENDRA":      "Ganesh Krushi Vikas Kendra",
    "ASHOK KUMAR BAJRANGLAL":          "Ashok Kumar Bajranglal",
    "VIVAN FERTILIZERS":               "Vivaan Fertilizer",
    "VIVAN FERTILIZER":                "Vivaan Fertilizer",
    "TIRUPATI AGRO AGENCIES":          "Tirupati Agro Agency",
    "PADMA AGRO TRADERS":              "Padma Agro",
    "NALLAWAR KRISHI KENDRA":          "Nallawar Krishi Kendra Patan",
    "VARUN SEEDS & FERTILIZERS":       "Varun Seeds And Fertilizers",
    "VARUN SEEDS & FERTILIZER":        "Varun Seeds And Fertilizers",
    "N.C. KOCHAR":                     "N C Kochar",
    "SHIVSHANKAR KIRANA & FERTILIZER": "Shivshankar Kirana & Ferti.",
    "PRANAV AGENCY":                   "Pranav Agencies",
    "KHANDESHWAR KRUSHI KENDRA":       "Khandeshwar Krushi Kendra",
    "KARANJA SAHKARI TALUKA":          "Karanja Sahkari Taluka Kharedi Vikri",
    "CHARBHUJA ENTERPRISES":           "CHARBHUJA ENTERPRISES [NOT IN DB]",
}

# ── Load distributor list ─────────────────────────────────────────────────────
wb_dist = openpyxl.load_workbook(DIST_XLSX)
dist_upper_to_name = {}
for row in wb_dist.active.iter_rows(min_row=2, values_only=True):
    if row[0]:
        dist_upper_to_name[row[0].strip().upper()] = row[0].strip()
dist_upper_to_name["KARANJA SAHKARI TALUKA KHAREDI VIKRI"] = "Karanja Sahkari Taluka Kharedi Vikri"

# ── Load existing retailers ───────────────────────────────────────────────────
wb_ret = openpyxl.load_workbook(RETAIL_XLSX)
existing_retailers = set()
for row in wb_ret.active.iter_rows(min_row=2, values_only=True):
    if row[0]:
        ret_name = str(row[0]).strip().upper()
        dist_name = str(row[3]).strip().upper() if len(row) > 3 and row[3] else ""
        existing_retailers.add((ret_name, dist_name))

# ── Parser helpers ────────────────────────────────────────────────────────────
def cell_str(cell):
    if cell.ctype == xlrd.XL_CELL_EMPTY: return ""
    if cell.ctype == xlrd.XL_CELL_NUMBER:
        v = cell.value
        return str(int(v)) if v == int(v) else str(v)
    return str(cell.value).strip()

def cell_num(cell):
    if cell.ctype == xlrd.XL_CELL_NUMBER: return cell.value
    try: return float(str(cell.value).strip())
    except: return 0.0

def parse_date(cell, wb):
    if cell.ctype in (xlrd.XL_CELL_DATE, xlrd.XL_CELL_NUMBER) and cell.value > 1000:
        try:
            t = xlrd.xldate_as_tuple(cell.value, wb.datemode)
            return date(t[0], t[1], t[2])
        except: pass
    s = str(cell.value).strip()
    for fmt in ["%d.%m.%y","%d.%m.%Y","%d/%m/%y","%d/%m/%Y","%d-%m-%Y","%d-%b-%Y"]:
        try: return datetime.strptime(s, fmt).date()
        except: pass
    return None

def match_distributor(header_col0):
    raw = str(header_col0).strip()
    name_part = raw
    for sep in ["- ", " -", "-"]:
        if sep in raw:
            name_part = raw.split(sep)[0].strip()
            break
    name_up = name_part.strip().upper()
    if name_up in EXCEL_DIST_MAP:
        return EXCEL_DIST_MAP[name_up]
    if name_up in dist_upper_to_name:
        return dist_upper_to_name[name_up]
    raw_up = raw.upper()
    if raw_up in dist_upper_to_name:
        return dist_upper_to_name[raw_up]
    for d_up, d_name in dist_upper_to_name.items():
        if d_up in raw_up or raw_up in d_up:
            return d_name
    return None

def _norm(s):
    return s.replace("KRUSHI", "KRISHI")

def is_same_as_dist(party_name, dist_name):
    if not party_name: return True
    pu_raw = party_name.strip().upper()
    du_raw = dist_name.strip().upper()
    pu = _norm(pu_raw); du = _norm(du_raw)
    if pu == du: return True
    p_words = set(pu.split()); d_words = set(du.split())
    if p_words <= d_words: return True
    if pu_raw.endswith(" KSK") or pu_raw.endswith(" KK"):
        if pu_raw.split()[0] == du_raw.split()[0]: return True
    p_sig = [w for w in pu.split() if len(w) > 2]
    d_sig = [w for w in du.split() if len(w) > 2]
    if p_sig and d_sig and p_sig[0] == d_sig[0]:
        if len(pu) < len(du): return True
        if len(pu) == len(du):
            if len(p_sig) < 2 or len(d_sig) < 2 or p_sig[1] == d_sig[1]: return True
    return False

# ── Parse Excel ───────────────────────────────────────────────────────────────
wb = xlrd.open_workbook(EXCEL_PATH)
SHEETS = [
    ("ASN Soya Final",   "ASN",   ASN_MAX_DC,   VARIETY_COLS_ASN),
    ("ASIAN Soya Final", "ASIAN", ASIAN_MAX_DC, VARIETY_COLS_ASIAN),
]
all_challans = []
new_retailers = []

for sheet_name, comp_code, max_dc, variety_cols in SHEETS:
    ws = wb.sheet_by_name(sheet_name)
    ncols = ws.ncols
    current_dist = None
    for ri in range(ws.nrows):
        row = ws.row(ri)
        c0 = cell_str(row[0])
        import re as _re
        if row[0].ctype not in (xlrd.XL_CELL_NUMBER, xlrd.XL_CELL_EMPTY):
            _sno_m = _re.match(r'^(\d+)[A-Za-z]$', c0.strip())
            if not _sno_m:
                others_empty = all(row[ci].ctype == xlrd.XL_CELL_EMPTY or
                    str(row[ci].value).strip() in ("","0","0.0") for ci in range(1, min(6,ncols)))
                if others_empty and c0:
                    c0_up = c0.upper()
                    if c0_up in ("ASN AGRI GENETICS PVT.LTD.","ASIAN SEEDS PVT.LTD.",
                                 "ASN AGRI GENETICS PVT. LTD.","ASIAN SEEDS PVT. LTD."): continue
                    if c0_up.startswith("DISPATCH DETAILS"): continue
                    dn = match_distributor(c0)
                    if dn: current_dist = dn
                continue
        try:
            sno = int(float(c0)) if row[0].ctype == xlrd.XL_CELL_NUMBER else int(_re.match(r'^(\d+)', c0).group(1))
        except: continue
        _m = _re.match(r'^(\d+)\s*([A-Za-z]?)$', cell_str(row[2]).strip())
        if not _m: continue
        dc_num    = int(_m.group(1))
        dc_suffix = _m.group(2) or None
        if dc_num > max_dc: continue
        if not current_dist: continue
        dc_date = parse_date(row[1], wb)
        party_name = cell_str(row[3]).strip()
        place_name = cell_str(row[4]).strip()
        total_qty  = cell_num(row[5])
        if "ADD:-" in party_name.upper() or "LESS:-" in party_name.upper(): continue
        ship_to_dist = is_same_as_dist(party_name, current_dist)
        new_ret = False
        if not ship_to_dist and party_name:
            party_up = party_name.strip().upper()
            ret_key = (party_up, current_dist.upper())
            if ret_key not in existing_retailers:
                new_ret = True
                if not any(nr["name"].upper() == party_up and nr["dist_name"].upper() == current_dist.upper()
                           for nr in new_retailers):
                    new_retailers.append({
                        "name": party_name, "city": place_name,
                        "dist_name": current_dist,
                        "uuid": str(uuid.uuid4())
                    })
        items = []
        for ci, variety_token in variety_cols.items():
            if ci >= ncols: continue
            qty_val = cell_num(row[ci])
            if qty_val <= 0: continue
            fix_key = (comp_code, dc_num, variety_token)
            if fix_key in DATA_FIXES:
                qty_val = DATA_FIXES[fix_key]
            pkg = PACKING.get(variety_token, 30.0)
            items.append({
                "product_name": variety_token,
                "qty_qtl": round(qty_val, 2),
                "bags": 0,
                "packing_kg": pkg,
            })
        all_challans.append({
            "uuid":          str(uuid.uuid4()),
            "company":       comp_code,
            "dc_number":     dc_num,
            "dc_suffix":     dc_suffix,
            "dc_date":       dc_date.isoformat() if dc_date else "2026-04-01",
            "dist_name":     current_dist,
            "party_name":    party_name,
            "ship_to_dist":  ship_to_dist,
            "new_retailer":  new_ret,
            "total_qty_qtl": round(total_qty, 2),
            "items":         items,
        })

print(f"Parsed: {len(all_challans)} challans, {sum(len(c['items']) for c in all_challans)} items, {len(new_retailers)} new retailers")

# ── SQL helpers ───────────────────────────────────────────────────────────────
def sq(s):
    """Escape for SQL single-quoted string."""
    if s is None:
        return 'NULL'
    return "'" + str(s).replace("'", "''") + "'"

def dist_id_sql(name):
    return f"(SELECT id FROM distributors WHERE name = {sq(name)})"

def company_id_sql(code):
    return f"(SELECT id FROM companies WHERE code = {sq(code)})"

def product_id_sql(code, variety):
    return (f"(SELECT id FROM products "
            f"WHERE company_id = {company_id_sql(code)} "
            f"AND name ILIKE {sq('%' + variety + '%')} "
            f"ORDER BY name LIMIT 1)")

def retailer_id_sql(party_name, dist_name):
    return (f"(SELECT r.id FROM retailers r "
            f"JOIN distributors d ON r.distributor_id = d.id "
            f"WHERE UPPER(r.name) = UPPER({sq(party_name)}) "
            f"AND d.name = {sq(dist_name)} LIMIT 1)")

# ── Generate SQL ──────────────────────────────────────────────────────────────
lines = []
lines.append("-- ============================================================")
lines.append("-- Historical DC Import  —  ASN DCs 1–231 | ASIAN DCs 1–320")
lines.append(f"-- Generated from: Soybean Dispatch 2026.xls")
lines.append(f"-- Challans: {len(all_challans)}  |  Items: {sum(len(c['items']) for c in all_challans)}  |  New retailers: {len(new_retailers)}")
lines.append("-- ============================================================")
lines.append("")
lines.append("BEGIN;")
lines.append("")

# ── Step 1: Retailers ─────────────────────────────────────────────────────────
lines.append("-- ────────────────────────────────────────────────────────────")
lines.append(f"-- Step 1: Create {len(new_retailers)} new retailers")
lines.append("-- ────────────────────────────────────────────────────────────")
lines.append("")
for nr in new_retailers:
    lines.append(
        f"INSERT INTO retailers (id, name, city, distributor_id) "
        f"SELECT {sq(nr['uuid'])}, {sq(nr['name'])}, {sq(nr['city'])}, d.id "
        f"FROM distributors d WHERE d.name = {sq(nr['dist_name'])};"
    )

lines.append("")
lines.append("-- ────────────────────────────────────────────────────────────")
lines.append(f"-- Step 2: Insert {len(all_challans)} challans + {sum(len(c['items']) for c in all_challans)} items")
lines.append("-- ────────────────────────────────────────────────────────────")

for ch in all_challans:
    lines.append("")
    lines.append(f"-- {ch['company']} DC {ch['dc_number']}  |  {ch['dist_name']}  →  {'SELF' if ch['ship_to_dist'] else ch['party_name']}")

    # retailer_id
    if ch["ship_to_dist"]:
        ret_id = "NULL"
    else:
        ret_id = retailer_id_sql(ch["party_name"], ch["dist_name"])

    suffix_sql = f"'{ch['dc_suffix']}'" if ch.get('dc_suffix') else "NULL"
    lines.append(
        f"INSERT INTO challans "
        f"(id, dc_number, dc_suffix, company_id, dc_date, distributor_id, retailer_id, "
        f"total_bags, total_qty_qtl, total_value, created_by) VALUES ("
        f"{sq(ch['uuid'])}, "
        f"{ch['dc_number']}, "
        f"{suffix_sql}, "
        f"{company_id_sql(ch['company'])}, "
        f"'{ch['dc_date']}', "
        f"{dist_id_sql(ch['dist_name'])}, "
        f"{ret_id}, "
        f"0, {ch['total_qty_qtl']}, 0, NULL);"
    )

    for pos, it in enumerate(ch["items"], 1):
        lines.append(
            f"INSERT INTO challan_items "
            f"(challan_id, product_id, product_name, lot_id, lot_number, "
            f"packing_size_kg, bags, qty_qtl, rate_per_bag, line_value, position) VALUES ("
            f"{sq(ch['uuid'])}, "
            f"{product_id_sql(ch['company'], it['product_name'])}, "
            f"{sq(it['product_name'])}, "
            f"NULL, '', "
            f"{it['packing_kg']}, 0, {it['qty_qtl']}, 0, 0, {pos});"
        )

lines.append("")
lines.append("COMMIT;")
lines.append("")

sql_text = "\n".join(lines)

with open(OUT_SQL, "w") as f:
    f.write(sql_text)

print(f"Written: {OUT_SQL}")
print(f"Lines:   {len(lines)}")
print(f"Size:    {len(sql_text) // 1024} KB")
