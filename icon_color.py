"""チャンネルアイコンから「いちばん多い成分の色」を取り出す(FIXED で色が決まっていないチャンネル用)。

- アイコンは丸く表示されるので、四隅(円の外)は数えない。
- 画素を「白 / 黒 / 灰 / 色相(15°刻み)」に分け、いちばん多い区分の平均色を使う。
- 白と黒は 80% 以上を占める時だけ採用(背景の白・縁の黒に引っ張られないように)。
- 暗い背景・明るい背景のどちらでも見えるよう、明るさと鮮やかさを少しだけ整える。
- 結果は icon_colors.json にキャッシュ(アイコンURLが変わった時だけ計算し直す)。
Pillow が無い環境やダウンロード失敗時は None を返し、呼び出し側の既定色になる。
"""
import colorsys, io, json, os, urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(BASE, "icon_colors.json")
MONO_MIN = 0.80   # 白/黒をテーマ色にするのに必要な割合
HUE_BINS = 24

try:
    from PIL import Image
except ImportError:   # 色は既定の割り当てにフォールバック
    Image = None

_cache = None


def _load():
    global _cache
    if _cache is None:
        try:
            _cache = json.load(open(CACHE, encoding="utf-8"))
        except Exception:
            _cache = {}
    return _cache


def save():
    if _cache is not None:
        with open(CACHE, "w", encoding="utf-8") as f:
            json.dump(_cache, f, ensure_ascii=False, indent=1, sort_keys=True)


def _src(url):   # サイズ指定(=s900-...)を除いた本体。これが変わったら計算し直す
    return (url or "").split("=")[0]


def _hex(r, g, b):
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def dominant(img):
    """PIL画像 -> (#hex, 区分名, 割合)。数える画素が無ければ None。"""
    img = img.convert("RGBA")
    if img.size != (88, 88):
        img = img.resize((88, 88), Image.NEAREST)   # 縮小で混ざった中間色(灰色)を作らない
    px = img.load()
    c, rad2 = 43.5, 43.5 ** 2
    bins = {}
    total = 0
    for y in range(88):
        for x in range(88):
            if (x - c) ** 2 + (y - c) ** 2 > rad2:
                continue
            r, g, b, a = px[x, y]
            if a < 128:
                continue
            r, g, b = r / 255, g / 255, b / 255
            h, l, s = colorsys.rgb_to_hls(r, g, b)
            mx, mn = max(r, g, b), min(r, g, b)
            sat = (mx - mn) / mx if mx else 0   # HSV の彩度(暗い色の判定がしやすい)
            if mx < 0.18:
                k = "black"
            elif sat < 0.18 and mx > 0.75:   # 薄い灰色(白背景の影や圧縮ノイズ)も白に数える
                k = "white"
            elif sat < 0.18:
                k = "gray"
            else:
                k = int(h * HUE_BINS) % HUE_BINS
            e = bins.setdefault(k, [0, 0.0, 0.0, 0.0])
            e[0] += 1; e[1] += r; e[2] += g; e[3] += b
            total += 1
    if not total:
        return None
    for mono in ("white", "black"):
        if bins.get(mono, [0])[0] / total >= MONO_MIN:
            return (("#eeeeee" if mono == "white" else "#444444"), mono, bins[mono][0] / total)
    # 隣り合う色相の区分は合算して比べる(境目で票が割れないように)
    hue = {k: v for k, v in bins.items() if isinstance(k, int)}
    cands = []
    for k in hue:
        n = sum(hue.get((k + d) % HUE_BINS, [0])[0] for d in (-1, 0, 1))
        cands.append((n, k))
    best = max(cands, key=lambda t: (t[0], t[1])) if cands else None
    # 灰色は線の縁や影にも出るので、色の付いた部分の1.5倍以上ある時だけ採用(灰色メインのアイコン用)
    g = bins.get("gray", [0])[0]
    if g and (not best or g >= best[0] * 1.5):
        best = (g, "gray")
    if not best:
        return None
    n, k = best
    if k == "gray":
        e = bins["gray"]
    else:   # 中心の区分と両隣の画素の平均色
        e = [0, 0.0, 0.0, 0.0]
        for d in (-1, 0, 1):
            v = hue.get((k + d) % HUE_BINS)
            if v:
                for i in range(4):
                    e[i] += v[i]
    r, g, b = e[1] / e[0], e[2] / e[0], e[3] / e[0]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    l = min(max(l, 0.42), 0.68)          # 暗すぎ/明るすぎを抑える
    if k != "gray":
        s = max(s, 0.45)                 # くすみすぎを抑える
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return (_hex(r, g, b), str(k), n / total)


def color_for(cid, avatar):
    """チャンネルのテーマ色(#hex)。求められなければ None。"""
    if not avatar:
        return None
    cache = _load()
    hit = cache.get(cid)
    if hit and hit.get("src") == _src(avatar):
        return hit.get("color")
    if Image is None:
        return hit.get("color") if hit else None
    url = _src(avatar) + "=s88-c-k-c0x00ffffff-no-rj"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req, timeout=15).read()
        res = dominant(Image.open(io.BytesIO(data)))
    except Exception:
        return hit.get("color") if hit else None
    if not res:
        return None
    cache[cid] = {"src": _src(avatar), "color": res[0], "kind": res[1], "share": round(res[2], 3)}
    return res[0]
