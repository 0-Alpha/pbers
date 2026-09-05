/* PBers — channel detail page renderer (uses window.CH + window.CH_HISTORY) */
(function () {
  var CH = window.CH || {}, H = window.CH_HISTORY || { dates: [] };
  var gm = 'subs';
  var chRange = 'all';   // 表示期間: '7' / '30' / 'all'
  function inRange(pts) {   // 直近 N 日に絞る(pts は昇順・{d,...})
    if (chRange === 'all' || !pts.length) return pts;
    var days = +chRange, last = new Date(dayOf(pts[pts.length - 1].d));
    var cut = new Date(last); cut.setDate(cut.getDate() - (days - 1));
    return pts.filter(function (p) { return new Date(dayOf(p.d)) >= cut; });
  }
  var UNIT = { subs: '人', views: '回', videos: '本' };
  var WORD = { subs: '登録者数', views: '総再生数', videos: '投稿数' };
  var COLOR = { subs: '#33bb74', views: '#9b7bff', videos: '#eba864' };

  function fmt(n) { return n == null ? '—' : n.toLocaleString('en-US'); }
  function sig3(x) { var d = x < 10 ? 2 : (x < 100 ? 1 : 0); return parseFloat(x.toFixed(d)).toString(); }
  function jp(n) { if (n == null) return '—'; if (n >= 1e8) return sig3(n / 1e8) + '億'; if (n >= 1e4) return sig3(n / 1e4) + '万'; return fmt(n); }
  function shortDate(s) {
    if (!s) return '';
    s = String(s);
    var y = +s.slice(0, 4), mo = +s.slice(5, 7), da = +s.slice(8, 10);
    var t = s.length > 10 ? s.slice(11, 16) : '';
    if (t === '00:00') { var dt = new Date(y, mo - 1, da); dt.setDate(dt.getDate() - 1); return (dt.getMonth() + 1) + '/' + dt.getDate(); }
    return mo + '/' + da;
  }
  function dayOf(s) {
    s = String(s);
    if (s.length <= 10) return s;
    var t = s.slice(11, 16);
    if (t === '00:00') { var dt = new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); dt.setDate(dt.getDate() - 1); return dt.toISOString().slice(0, 10); }
    return s.slice(0, 10);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]; }); }

  // ヘッダ(名前・数値・説明・トグル・共有ボタン)はサーバー側で静的出力済み(SEO用)。
  // ここでは配色設定と、推移グラフの描画＋操作の紐付けだけを行う。
  var root = document.getElementById('ch-root'); if (!root) return;
  document.documentElement.style.setProperty('--accent', CH.color || '#ac1c1c');

  function renderChart() {
    var host = document.getElementById('ch-chart');
    var note = document.getElementById('ch-note');
    var dates = H.dates || [], vals = (H[gm] || []).slice();
    // drop leading nulls (channel may hide a metric)
    var pts = [];
    for (var i = 0; i < dates.length; i++) if (vals[i] != null) pts.push({ d: dates[i], v: vals[i] });
    pts = inRange(pts);   // 選択期間に絞る
    if (pts.length < 1) { host.innerHTML = '<div class="t-empty">この期間の記録はまだありません。</div>'; if (note) note.textContent = ''; return; }
    if (note) { var dset = {}; pts.forEach(function (p) { dset[dayOf(p.d)] = 1; }); note.textContent = Object.keys(dset).length + '日分（' + shortDate(pts[0].d) + '〜' + shortDate(pts[pts.length - 1].d) + '）'; }
    var W = Math.max(300, (host.clientWidth || 720) - 28), Hh = 240, padL = 54, padR = 16, padT = 18, padB = 30;
    var iW = W - padL - padR, iH = Hh - padT - padB, n = pts.length;
    var mn = Math.min.apply(null, pts.map(function (p) { return p.v; })), mx = Math.max.apply(null, pts.map(function (p) { return p.v; }));
    if (mn === mx) { mn = mn * 0.98; mx = mx * 1.02 || 1; }
    var pad = (mx - mn) * 0.15 || 1, yMin = mn - pad, yMax = mx + pad;
    function X(i) { return n === 1 ? padL + iW / 2 : padL + iW * i / (n - 1); }
    function Y(v) { return padT + iH * (1 - (v - yMin) / (yMax - yMin)); }
    var col = COLOR[gm];
    var d = '';   // 点を直線で結ぶ折れ線
    for (var k = 0; k < n; k++) { d += (k === 0 ? 'M' : ' L') + X(k) + ',' + Y(pts[k].v); }
    var grid = '', yl = '';
    [yMax, (yMax + yMin) / 2, yMin].forEach(function (gv) { var gy = Y(gv); grid += '<line class="t-grid" x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>'; yl += '<text class="t-axis" x="' + (padL - 8) + '" y="' + (gy + 4) + '" text-anchor="end">' + jp(Math.round(gv)) + '</text>'; });
    var xl = '', step = Math.max(1, Math.ceil(n / 6));
    for (var j = 0; j < n; j++) if (j % step === 0 || j === n - 1) xl += '<text class="t-axis" x="' + X(j) + '" y="' + (Hh - 10) + '" text-anchor="middle">' + shortDate(pts[j].d) + '</text>';
    var dots = ''; for (var m = 0; m < n; m++) dots += '<circle class="t-dot" cx="' + X(m) + '" cy="' + Y(pts[m].v) + '" r="3.5" fill="' + col + '"/>';
    var last = '<text class="t-val" x="' + X(n - 1) + '" y="' + (Y(pts[n - 1].v) - 9) + '" text-anchor="end">' + jp(pts[n - 1].v) + UNIT[gm] + '</text>';
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + Hh + '" preserveAspectRatio="xMidYMid meet">' + grid + yl + xl + '<path class="t-line" d="' + d + '" stroke="' + col + '"/>' + dots + last + '</svg>';
  }

  // toggle
  var tabs = [].slice.call(document.querySelectorAll('#ch-toggle .tg'));
  function moveInd() { var on = document.querySelector('#ch-toggle .tg.on'), ind = document.getElementById('ch-tind'); if (on && ind) { ind.style.left = on.offsetLeft + 'px'; ind.style.width = on.offsetWidth + 'px'; } }
  tabs.forEach(function (b) { b.addEventListener('click', function () { if (b.dataset.gm === gm) return; gm = b.dataset.gm; tabs.forEach(function (x) { x.classList.toggle('on', x === b); }); moveInd(); renderChart(); if (numsOpen) renderNums(); }); });

  // 期間切替(1週間 / 1ヶ月 / 全期間)
  var rgs = [].slice.call(document.querySelectorAll('#ch-range .rg'));
  rgs.forEach(function (b) { b.addEventListener('click', function () { if (b.dataset.days === chRange) return; chRange = b.dataset.days; rgs.forEach(function (x) { x.classList.toggle('on', x === b); }); renderChart(); if (numsOpen) renderNums(); }); });

  // 過去の実数値テーブル(日付 + 登録者/総再生/投稿。選択期間に連動・新しい順)
  var numsOpen = false;
  function renderNums() {
    var host = document.getElementById('ch-nums'); if (!host) return;
    var dates = H.dates || [], rows = [];
    for (var i = 0; i < dates.length; i++) rows.push({ d: dates[i], subs: (H.subs || [])[i], views: (H.views || [])[i], videos: (H.videos || [])[i] });
    rows = inRange(rows).slice().reverse();   // 新しい順
    if (!rows.length) { host.innerHTML = '<div class="t-empty">この期間の記録はまだありません。</div>'; return; }
    var html = '<table class="ch-table"><thead><tr><th>日付</th><th>登録者</th><th>総再生数</th><th>投稿</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr><td>' + esc(shortDate(r.d)) + '</td><td class="num">' + fmt(r.subs) + '</td><td class="num">' + fmt(r.views) + '</td><td class="num">' + fmt(r.videos) + '</td></tr>';
    });
    host.innerHTML = html + '</tbody></table>';
  }
  var numsBtn = document.getElementById('ch-nums-btn');
  if (numsBtn) numsBtn.addEventListener('click', function () {
    numsOpen = !numsOpen;
    var host = document.getElementById('ch-nums'); if (host) host.hidden = !numsOpen;
    numsBtn.textContent = numsOpen ? '数値を隠す ▴' : '数値で見る ▾';
    if (numsOpen) renderNums();
  });

  // share
  var shareUrl = location.origin + location.pathname;
  var shareText = CH.name + ' の登録者数は' + jp(CH.subs) + '人、総再生数は' + jp(CH.views) + '回、投稿数は' +
    (CH.videos == null ? '—' : fmt(CH.videos)) + '本です！ #ポーランドボール';
  var bx = document.getElementById('sh-x'); if (bx) bx.addEventListener('click', function () { window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText) + '&url=' + encodeURIComponent(shareUrl), '_blank', 'noopener'); });
  var bc = document.getElementById('sh-copy'); if (bc) bc.addEventListener('click', function () { navigator.clipboard && navigator.clipboard.writeText(shareUrl).then(function () { bc.textContent = 'コピーしました'; setTimeout(function () { bc.textContent = 'リンクをコピー'; }, 1500); }); });

  renderChart(); moveInd();
  var _rz;
  window.addEventListener('resize', function () { moveInd(); clearTimeout(_rz); _rz = setTimeout(renderChart, 200); });
})();
