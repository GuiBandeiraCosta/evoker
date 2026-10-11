import sys, zipfile, hashlib, base64, re
z = zipfile.ZipFile(sys.argv[1])
mf = z.read('META-INF/MANIFEST.MF').decode('utf-8', 'replace')
sf = z.read('META-INF/CERT.SF').decode('utf-8', 'replace')
def sections(text):
    out = {}; cur = None; buf = []
    for line in text.replace('\r\n', '\n').split('\n'):
        if line.startswith('Name: '):
            cur = line[6:]; out[cur] = {}
        elif line.startswith(' ') and cur:  # continuation line of a long name
            cur = cur + line[1:]; out[cur] = out.pop(list(out)[-1])
        elif line.startswith('SHA1-Digest: ') and cur: out[cur]['sha1'] = line[13:].strip()
        elif line.startswith('SHA-256-Digest: ') and cur: out[cur]['sha256'] = line[16:].strip()
    return out
m = sections(mf)
missing = bad = ok = 0
names = set(z.namelist())
for name, d in m.items():
    if name not in names: missing += 1; continue
    data = z.read(name)
    if 'sha1' in d and base64.b64encode(hashlib.sha1(data).digest()).decode() == d['sha1']: ok += 1
    elif 'sha256' in d and base64.b64encode(hashlib.sha256(data).digest()).decode() == d['sha256']: ok += 1
    else: bad += 1; print('DIGEST MISMATCH', name)
unsigned = [n for n in names if not n.endswith('/') and not n.startswith('META-INF/') and n not in m]
print(f'manifest entries {len(m)}: ok {ok}, mismatched {bad}, missing files {missing}; files not covered by the manifest: {len(unsigned)} {unsigned[:5]}')
# CERT.SF: digest of the whole manifest + per-section digests
sfm = re.search(r'SHA1-Digest-Manifest: (\S+)', sf)
mf_raw = z.read('META-INF/MANIFEST.MF')
print('SF manifest digest matches:', sfm and base64.b64encode(hashlib.sha1(mf_raw).digest()).decode() == sfm.group(1))
