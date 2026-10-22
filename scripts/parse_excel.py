"""Parse the three Chennai Vara Excel batches into seed JSON + review report.
Usage: python parse_excel.py <excel_dir> <out_json>   (needs openpyxl)"""
import glob, json, re, sys
import openpyxl

D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],
     [5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
     [9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]

def verhoeff_ok(num: str) -> bool:
    c = 0
    for i, ch in enumerate(reversed(num)):
        c = D[c][P[i % 8][int(ch)]]
    return c == 0

def clean(s):
    return re.sub(r"\s+", " ", str(s)).strip() if s is not None else None

def main(src, out):
    people, cur, report = [], None, []
    for f in sorted(glob.glob(f"{src}/Chennai Vara Batch -*.xlsx")):
        batch = int(re.search(r"-(\d)\.xlsx$", f).group(1))
        ws = openpyxl.load_workbook(f, data_only=True).active
        for n, r in enumerate(ws.iter_rows(min_row=3, values_only=True), 3):
            sn, reg, name, side, app, aad = (list(r) + [None] * 6)[:6]
            if all(v is None for v in r):
                continue
            where = f"batch {batch} row {n}"
            if reg is not None or name is not None:   # a new beneficiary line
                cur = dict(batch=batch, serial_no=sn, reg_no=clean(reg), name=clean(name), aadhaar_raw=aad,
                           appliances=[], notes=[])
                if reg is None:
                    cur["notes"].append(f"No Reg. No. in Excel ({where}); assign manually")
                people.append(cur)
            elif cur is None:
                report.append(f"{where}: continuation row with no parent"); continue
            if app is not None and clean(app):
                cur["appliances"].append({"name": clean(app), "side": clean(side)})
            else:
                cur["notes"].append(f"{where}: row has no appliance")
            if reg is None and name is None and aad:   # Aadhaar sitting on a continuation row
                if cur["aadhaar_raw"] is None:
                    cur["aadhaar_raw"] = aad
                    cur["notes"].append(f"Aadhaar taken from continuation row ({where}); please verify")
    for p in people:
        raw = p.pop("aadhaar_raw")
        p["aadhaar_no"] = None
        if raw is None:
            p["notes"].append("No Aadhaar in Excel")
        else:
            s = str(int(raw)) if isinstance(raw, (int, float)) else re.sub(r"\D", "", str(raw))
            if len(s) == 12 and s[0] in "23456789":
                p["aadhaar_no"] = s
                if not verhoeff_ok(s):
                    p["notes"].append("Aadhaar fails checksum; verify against card")
            else:
                p["notes"].append(f"Invalid Aadhaar in Excel ({s}, {len(s)} digits); not imported")
    seen = {}
    for p in people:
        if p["aadhaar_no"] in seen and p["aadhaar_no"]:
            p["notes"].append(f"Duplicate Aadhaar with Reg {seen[p['aadhaar_no']]}")
        seen[p["aadhaar_no"]] = p["reg_no"]
    json.dump(people, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(len(people), "beneficiaries;", sum(len(p["appliances"]) for p in people), "appliance lines;",
          sum(1 for p in people if p["notes"]), "need review;",
          sum(1 for p in people if p["aadhaar_no"] and not verhoeff_ok(p["aadhaar_no"])), "fail checksum")
    for x in report: print(x)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
