"""Minimal Lua 5.1 bytecode reader: splits a Corona .car archive into chunks, parses each function tree and
dumps constants, instructions (with constant resolution) and nested prototypes to a text file per chunk.
Usage: python -I lua51dump.py resource.car outdir
"""
import sys, struct, os, re, json

OPS = ['MOVE', 'LOADK', 'LOADBOOL', 'LOADNIL', 'GETUPVAL', 'GETGLOBAL', 'GETTABLE', 'SETGLOBAL', 'SETUPVAL',
       'SETTABLE', 'NEWTABLE', 'SELF', 'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'POW', 'UNM', 'NOT', 'LEN', 'CONCAT',
       'JMP', 'EQ', 'LT', 'LE', 'TEST', 'TESTSET', 'CALL', 'TAILCALL', 'RETURN', 'FORLOOP', 'FORPREP',
       'TFORLOOP', 'SETLIST', 'CLOSE', 'CLOSURE', 'VARARG']
ARITH = {'ADD': '+', 'SUB': '-', 'MUL': '*', 'DIV': '/', 'MOD': '%', 'POW': '^'}
CMP = {'EQ': '==', 'LT': '<', 'LE': '<='}


class Reader:
    def __init__(self, data, pos):
        self.b = data
        self.p = pos

    def u8(self):
        v = self.b[self.p]
        self.p += 1
        return v

    def u32(self):
        v = struct.unpack_from('<I', self.b, self.p)[0]
        self.p += 4
        return v

    def size_t(self, n):
        v = int.from_bytes(self.b[self.p:self.p + n], 'little')
        self.p += n
        return v

    def num(self):
        v = struct.unpack_from('<d', self.b, self.p)[0]
        self.p += 8
        return v

    def string(self, n):
        ln = self.size_t(n)
        if ln == 0:
            return None
        s = self.b[self.p:self.p + ln - 1]
        self.p += ln
        return s.decode('utf-8', 'replace')


def read_function(r, hdr):
    f = {'source': r.string(hdr['size_t']), 'line': r.u32(), 'lastline': r.u32(),
         'nups': r.u8(), 'nparams': r.u8(), 'vararg': r.u8(), 'maxstack': r.u8()}
    n = r.u32()
    f['code'] = [r.u32() for _ in range(n)]
    n = r.u32()
    consts = []
    for _ in range(n):
        t = r.u8()
        if t == 0:
            consts.append(None)
        elif t == 1:
            consts.append(bool(r.u8()))
        elif t == 3:
            consts.append(r.num())
        elif t == 4:
            consts.append(r.string(hdr['size_t']))
        else:
            raise ValueError('bad const type %d' % t)
    f['consts'] = consts
    n = r.u32()
    f['protos'] = [read_function(r, hdr) for _ in range(n)]
    n = r.u32()
    f['lines'] = [r.u32() for _ in range(n)]
    n = r.u32()
    f['locals'] = [(r.string(hdr['size_t']), r.u32(), r.u32()) for _ in range(n)]
    n = r.u32()
    f['upvals'] = [r.string(hdr['size_t']) for _ in range(n)]
    return f


def parse_chunk(data):
    if data[:4] != b'\x1bLua' or data[4] != 0x51:
        raise ValueError('not Lua 5.1')
    hdr = {'size_t': data[8]}
    r = Reader(data, 12)
    return read_function(r, hdr), r.p


def fmt_const(v):
    if isinstance(v, str):
        return '"%s"' % v.replace('\n', '\\n')[:70]
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return repr(v)


def rk(f, x):
    if x & 256:
        return fmt_const(f['consts'][x & 255])
    return 'R%d' % x


def disasm(f, out, name='main', depth=0):
    ind = '  ' * depth
    out.append('%sfunction %s (params=%d, lines %d-%d, upvals=%s, locals=%s)' % (
        ind, name, f['nparams'], f['line'], f['lastline'], f['upvals'], [l[0] for l in f['locals']][:24]))
    strs = [c for c in f['consts'] if isinstance(c, str)]
    nums = [c for c in f['consts'] if isinstance(c, float)]
    out.append('%s  constants: strings=%s numbers=%s' % (ind, strs[:100], [int(x) if x == int(x) else x for x in nums][:100]))
    for pc, ins in enumerate(f['code']):
        op = ins & 0x3f
        a = (ins >> 6) & 0xff
        c = (ins >> 14) & 0x1ff
        b = (ins >> 23) & 0x1ff
        bx = ins >> 14
        sbx = bx - 131071
        o = OPS[op] if op < len(OPS) else '?%d' % op
        line = f['lines'][pc] if pc < len(f['lines']) else 0
        if o == 'LOADK':
            txt = 'R%d := %s' % (a, fmt_const(f['consts'][bx]))
        elif o == 'GETGLOBAL':
            txt = 'R%d := _G[%s]' % (a, fmt_const(f['consts'][bx]))
        elif o == 'SETGLOBAL':
            txt = '_G[%s] := R%d' % (fmt_const(f['consts'][bx]), a)
        elif o == 'GETTABLE':
            txt = 'R%d := R%d[%s]' % (a, b, rk(f, c))
        elif o == 'SETTABLE':
            txt = 'R%d[%s] := %s' % (a, rk(f, b), rk(f, c))
        elif o == 'SELF':
            txt = 'R%d := R%d; R%d := R%d[%s]' % (a + 1, b, a, b, rk(f, c))
        elif o in ARITH:
            txt = 'R%d := %s %s %s' % (a, rk(f, b), ARITH[o], rk(f, c))
        elif o in CMP:
            txt = 'if (%s %s %s) ~= %d then skip next' % (rk(f, b), CMP[o], rk(f, c), a)
        elif o == 'JMP':
            txt = 'jmp %+d -> %d' % (sbx, pc + 1 + sbx)
        elif o == 'CALL':
            txt = 'R%d(...) nargs=%d nret=%d' % (a, b - 1, c - 1)
        elif o == 'TAILCALL':
            txt = 'return R%d(...) nargs=%d' % (a, b - 1)
        elif o == 'RETURN':
            txt = 'return R%d.. (%d values)' % (a, b - 1)
        elif o == 'CLOSURE':
            txt = 'R%d := closure #%d' % (a, bx)
        elif o == 'GETUPVAL':
            txt = 'R%d := upval %s' % (a, f['upvals'][b] if b < len(f['upvals']) else b)
        elif o == 'SETUPVAL':
            txt = 'upval %s := R%d' % (f['upvals'][b] if b < len(f['upvals']) else b, a)
        elif o == 'MOVE':
            txt = 'R%d := R%d' % (a, b)
        elif o == 'LOADBOOL':
            txt = 'R%d := %s%s' % (a, bool(b), ' (skip)' if c else '')
        elif o == 'LOADNIL':
            txt = 'R%d..R%d := nil' % (a, b)
        elif o == 'NEWTABLE':
            txt = 'R%d := {} (array %d, hash %d)' % (a, b, c)
        elif o == 'FORPREP':
            txt = 'for R%d.. jmp %+d' % (a, sbx)
        elif o == 'FORLOOP':
            txt = 'forloop R%d jmp %+d' % (a, sbx)
        elif o == 'TFORLOOP':
            txt = 'tforloop R%d nres=%d' % (a, c)
        elif o == 'TEST':
            txt = 'if (R%d truthy) ~= %d then skip next' % (a, c)
        elif o == 'TESTSET':
            txt = 'if (R%d truthy) == %d then R%d := R%d else skip next' % (b, c, a, b)
        elif o == 'NOT':
            txt = 'R%d := not R%d' % (a, b)
        elif o == 'UNM':
            txt = 'R%d := -R%d' % (a, b)
        elif o == 'LEN':
            txt = 'R%d := #R%d' % (a, b)
        elif o == 'CONCAT':
            txt = 'R%d := R%d .. ... .. R%d' % (a, b, c)
        elif o == 'SETLIST':
            txt = 'R%d[...] := R%d.. (n=%d, block %d)' % (a, a + 1, b, c)
        elif o == 'VARARG':
            txt = 'R%d.. := ... (%d)' % (a, b - 1)
        else:
            txt = 'A=%d B=%d C=%d' % (a, b, c)
        out.append('%s  %4d [%4d] %-9s %s' % (ind, pc, line, o, txt))
    for i, p in enumerate(f['protos']):
        disasm(p, out, '%s.#%d' % (name, i), depth + 1)


def main():
    car, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    data = open(car, 'rb').read()
    starts = [m.start() for m in re.finditer(rb'\x1bLua\x51', data)]
    index = {}
    for i, s in enumerate(starts):
        try:
            f, end = parse_chunk(data[s:])
        except Exception as e:
            print('chunk', i, 'at', s, 'failed:', e)
            continue
        src = f['source'] or 'chunk%d' % i
        base = re.sub(r'[^A-Za-z0-9_.-]', '_', src.strip('@=')) or 'chunk%d' % i
        out = []
        disasm(f, out)
        path = os.path.join(outdir, base[:120] + '.txt')
        n = 1
        while os.path.exists(path):
            n += 1
            path = os.path.join(outdir, '%s_%d.txt' % (base[:120], n))
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(out))
        index[os.path.basename(path)] = {'offset': s, 'size': end, 'functions': 1 + len(f['protos'])}
    with open(os.path.join(outdir, '_index.json'), 'w') as fh:
        json.dump(index, fh, indent=1)
    print('chunks parsed:', len(index))


main()
