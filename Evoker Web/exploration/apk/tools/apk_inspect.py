import sys, zipfile, collections, os, re
p = sys.argv[1]
z = zipfile.ZipFile(p)
bad = z.testzip()
print("zip integrity:", "OK" if bad is None else "CORRUPT at " + bad)
names = z.namelist()
print("entries:", len(names), "uncompressed MB:", round(sum(i.file_size for i in z.infolist())/1e6, 1))
top = collections.Counter(n.split('/')[0] if '/' in n else '(root)' for n in names)
print("top-level:", dict(top.most_common(12)))
ext = collections.Counter((os.path.splitext(n)[1].lower() or '(none)') for n in names if not n.endswith('/'))
print("by extension:", dict(ext.most_common(16)))
big = sorted(z.infolist(), key=lambda i: -i.file_size)[:12]
print("largest:"); [print("  %9d  %s" % (i.file_size, i.filename)) for i in big]
engine = [n for n in names if re.search(r'libunity|libmono|il2cpp|Assembly-CSharp|cocos2d|libgame|libcorona|Flash|adobe|libplayer|unity|monogame', n, re.I)]
print("engine hints:", engine[:15])
meta = [n for n in names if n.startswith('META-INF/')]
print("META-INF:", meta[:10])
# package name from the binary manifest (UTF-16LE strings)
m = z.read('AndroidManifest.xml')
u = m.decode('utf-16-le', errors='ignore')
pk = sorted(set(re.findall(r'com\.[a-z0-9_.]+', u)))
print("manifest package-like strings:", pk[:12])
vers = re.findall(r'\d+\.\d+\.\d+', u)
print("manifest version-like strings:", sorted(set(vers))[:6])
# sample asset paths
samples = [n for n in names if n.startswith('assets/')][:25]
print("assets sample:", samples)
