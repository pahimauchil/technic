import re, zlib, base64

path = r"C:\Users\Pahima\Desktop\New folder\Technic_Technologies_Electronics_ERP_Developer_Handover-1.pdf"
data = open(path, "rb").read()
print("PDF size:", len(data))

streams = re.findall(rb"stream\r?\n(.*?)endstream", data, re.S)
print("streams found:", len(streams))

texts = []
for s in streams:
    s = s.strip(b"\r\n")
    try:
        raw = base64.a85decode(s, adobe=False)
    except Exception:
        try:
            raw = base64.a85decode(s.rstrip(b"~>"), adobe=False)
        except Exception:
            continue
    try:
        dec = zlib.decompress(raw)
    except Exception:
        continue
    texts.append(dec)

print("decompressed streams:", len(texts))

unesc = {r"\(": "(", r"\)": ")", r"\\": "\\", r"\n": "\n", r"\r": "\r"}

out = []
for dec in texts:
    if b"BT" not in dec:
        continue
    content = dec.decode("latin-1", errors="replace")
    lines = []
    for m in re.finditer(r"\[(.*?)\]\s*TJ|\((?:[^()\\]|\\.)*\)\s*Tj", content):
        tok = m.group(0)
        if tok.startswith("["):
            strs = re.findall(r"\((?:[^()\\]|\\.)*\)", tok)
            s = "".join(x[1:-1] for x in strs)
        else:
            s = tok[1:-3]
        for k, v in unesc.items():
            s = s.replace(k, v)
        lines.append(s)
    out.append("\n".join(lines))

full = "\n\n=====PAGE BREAK=====\n\n".join(out)
open("docs/pdf_extracted.txt", "w", encoding="utf-8").write(full)
print("chars extracted:", len(full))
