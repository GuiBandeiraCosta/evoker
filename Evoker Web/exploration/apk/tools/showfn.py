"""Prints named methods from a lua51dump disassembly. Methods are closures assigned by name
(CLOSURE Rn := closure #k ... SETTABLE Rm["name"] := Rn) inside a constructor function.
Usage: python -I showfn.py <dump.txt> [--list] [name ...]
"""
import sys, re

path = sys.argv[1]
args = sys.argv[2:]
text = open(path, encoding='utf-8').read().split('\n')

# index functions: name -> (start, end)
funcs = []
for i, ln in enumerate(text):
    m = re.match(r'^(\s*)function (\S+) ', ln)
    if m:
        funcs.append((m.group(2), i, len(m.group(1))))
bounds = {}
for idx, (name, start, indent) in enumerate(funcs):
    end = len(text)
    for name2, start2, indent2 in funcs[idx + 1:]:
        if indent2 <= indent:
            end = start2
            break
    bounds[name] = (start, end)

# closure -> method name within each function body (own instructions only)
names = {}
for name, (s, e) in bounds.items():
    own = []
    for ln in text[s + 1:e]:
        if re.match(r'^\s+function ', ln):
            break
        own.append(ln)
    reg_closure = {}
    for ln in own:
        m = re.search(r'CLOSURE\s+R(\d+) := closure #(\d+)', ln)
        if m:
            reg_closure[int(m.group(1))] = int(m.group(2))
        m = re.search(r'SETTABLE\s+R\d+\["([^"]+)"\] := R(\d+)', ln)
        if m and int(m.group(2)) in reg_closure:
            names['%s.#%d' % (name, reg_closure[int(m.group(2))])] = m.group(1)
            del reg_closure[int(m.group(2))]

if '--list' in args:
    for k, v in names.items():
        print(k, '->', v)
    sys.exit()
wanted = [a for a in args if not a.startswith('--')]
for fn, label in names.items():
    if label in wanted:
        s, e = bounds[fn]
        print('==================== %s (%s) ====================' % (label, fn))
        for ln in text[s:e]:
            print(ln[:160])
