# -*- coding: utf-8 -*-
"""index.html のアセット参照をインライン化した _preview_standalone.html を作る（?v= 付きでもOK）。"""
import os, re
BASE = os.path.dirname(os.path.abspath(__file__))
html = open(os.path.join(BASE, "index.html"), encoding="utf-8").read()

def read(p): return open(os.path.join(BASE, p), encoding="utf-8").read()

# NOTE: use function replacements so backslashes in JS/CSS aren't treated as regex backrefs
html = re.sub(r'<link rel="stylesheet" href="assets/style\.css[^"]*">',
              lambda m: "<style>" + read("assets/style.css") + "</style>", html)
for name in ["data", "news", "growth", "race", "app"]:
    html = re.sub(r'<script src="assets/' + name + r'\.js[^"]*"></script>',
                  (lambda nm: (lambda m: "<script>" + read("assets/" + nm + ".js") + "</script>"))(name), html)
open(os.path.join(BASE, "_preview_standalone.html"), "w", encoding="utf-8").write(html)
print("wrote _preview_standalone.html")
