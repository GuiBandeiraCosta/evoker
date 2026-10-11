"""Reconstructs simple Lua data tables from the disassembly text produced by lua51dump.py.
Handles the patterns  R0["key"] := "value"  (flat string maps) and
  Rn := {} ... Rn["f"] := v ... R0["key"] := Rn   (map of records).
Usage: python -I extract_tables.py <dump.txt> <mode: flat|records|colors> <out.json>
"""
import sys, re, json

SET = re.compile(r'^\s*\d+ \[\s*\d+\] SETTABLE\s+R(\d+)\[(.+?)\] := (.+)$')
NEWT = re.compile(r'^\s*\d+ \[\s*\d+\] NEWTABLE\s+R(\d+) := \{\}')
LOADK = re.compile(r'^\s*\d+ \[\s*\d+\] LOADK\s+R(\d+) := (.+)$')


def lit(s):
    s = s.strip()
    if s.startswith('"') and s.endswith('"'):
        return s[1:-1].replace('\\n', '\n')
    if s in ('True', 'False'):
        return s == 'True'
    if s == 'None':
        return None
    try:
        return int(s)
    except ValueError:
        try:
            return float(s)
        except ValueError:
            return s  # register reference like R3


def main():
    path, mode, out = sys.argv[1], sys.argv[2], sys.argv[3]
    lines = open(path, encoding='utf-8').read().split('\n')
    # only the top-level function body (stop at first nested function)
    body = []
    started = False
    for ln in lines:
        if ln.startswith('function main'):
            started = True
            continue
        if started and re.match(r'^\s+function ', ln):
            break
        if started:
            body.append(ln)
    regs = {}
    result = {}
    for ln in body:
        m = NEWT.match(ln)
        if m:
            regs[int(m.group(1))] = {}
            continue
        m = LOADK.match(ln)
        if m:
            regs[int(m.group(1))] = lit(m.group(2))
            continue
        m = SET.match(ln)
        if m:
            r, key, val = int(m.group(1)), lit(m.group(2)), m.group(3).strip()
            if re.fullmatch(r'R\d+', val):
                v = regs.get(int(val[1:]))
                v = json.loads(json.dumps(v)) if isinstance(v, dict) else v
            else:
                v = lit(val)
            if r == 0 or (mode == 'colors' and r == 2):
                result[key] = v
            else:
                tbl = regs.setdefault(r, {})
                if isinstance(tbl, dict):
                    tbl[key] = v
    json.dump(result, open(out, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print(path.split('/')[-1], '->', len(result), 'entries; sample:', list(result.items())[:2])


main()
