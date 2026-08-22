/* PBers — channel detail page renderer (uses window.CH + window.CH_HISTORY) */
(function () {
  var CH = window.CH || {}, H = window.CH_HISTORY || { dates: [] };
  var gm = 'subs';
  var UNIT = { subs: '人', views: '回', videos: '本' };
  var WORD = { subs: '登録者数', views: '総再生数', videos: '投稿数' };
  var COLOR = { subs: '#33bb74', views: '#9b7bff', videos: '#eba864' };

  function fmt(n) { return n == null ? '—' : n.toLocaleString('en-US'); }
  function sig3(x) { var d = x < 10 ? 2 : (x < 100 ? 1 : 0); return parseFloat(x.toFixed(d)).toString(); }
  function jp(n) { if (n == null) return '—'; if (n >= 1e8) return sig3(n / 1e8) + '億'; if (n >= 1e4) return sig3(n / 1e4) + '万'; return fmt(n); }
  function shortDate(s) { var p = s.split('-'); return (+p[1]) + '/' + (+p[2]); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]; }); }

  var root = document.getElementById('ch-root'); if (!root) return;
  document.documentElement.style.setProperty('--accent', CH.color || '#ac1c1c');

  root.innerHTML =
    '<div class="ch-head">' +
      '<img class="ch-av" src="' + CH.avatar + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
      '<div class="ch-meta">' +
        '<div class="ch-genre">' + esc(CH.genre || '') + ' ・ 総合 ' + CH.rank + '位 / ' + CH.total + '</div>' +
        '<h1 class="ch-name">' + esc(CH.name) + '</h1>' +
        '<div class="ch-actions">' +
          '<a class="yt-btn" href="' + CH.url + '" target="_blank" rel="noopener">YouTube ↗</a>' +
          '<button class="sh sh-x" id="sh-x">𝕏 シェア</button>' +
          '<button class="sh sh-copy" id="sh-copy">リンクをコピー</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="ch-stats">' +
      statTile('登録者数', CH.subs, '人') +
      statTile('総再生数', CH.views, '回') +
      statTile('投稿数', CH.videos, '本') +
    '</div>' +
    '<div class="sec-head" style="margin-top:34px"><h2>推移 <span class="en">History</span></h2>' +
      '<span class="note" id="ch-note"></span></div>' +
    '<div class="controls" style="justify-content:flex-start">' +
      '<div class="toggle" id="ch-toggle">' +
        '<button class="tg on" data-gm="subs">登録者</button>' +
        '<button class="tg" data-gm="views">総再生数</button>' +
        '<button class="tg" data-gm="videos">投稿数</button>' +
        '<span class="tg-ind" id="ch-tind"></span>' +
      '</div>' +
    '</div>' +
    '<div class="trend" id="ch-chart"></div>';

  function statTile(label, v, unit) {
    return '<div class="ch-tile"><div class="k">' + label + '</div>' +
      '<div class="v num">' + (v == null ? '非公開' : fmt(v)) + (v == null ? '' : '<small>' + unit + '</small>') + '</div>' +
      '<div class="sub">' + (v == null ? '' : jp(v) + unit) + '</div></div>';
  }

  function renderChart() {
    var host = document.getElementById('ch-chart');
    var note = document.getElementById('ch-note');
    var dates = H.dates || [], vals = (H[gm] || []).slice();
    // drop leading nulls (channel may hide a metric)
    var pts = [];
    for (var i = 0; i < dates.length; i++) if (vals[i] != null) pts.push({ d: dates[i], v: vals[i] });
    if (pts.length < 1) { host.innerHTML = '<div class="t-empty">まだ推移データがありません（記録が増えると表示されます）。</div>'; if (note) note.textContent = ''; return; }
    if (note) note.textContent = pts.length + '日分（' + shortDate(pts[0].d) + '〜' + shortDate(pts[pts.length - 1].d) + '）';
    var W = 720, Hh = 260, padL = 56, padR = 16, padT = 18, padB = 30;
    var iW = W - padL - padR, iH = Hh - padT - padB, n = pts.length;
    var mn = Math.min.apply(null, pts.map(function (p) { return p.v; })), mx = Math.max.apply(null, pts.map(function (p) { return p.v; }));
    if (mn === mx) { mn = mn * 0.98; mx = mx * 1.02 || 1; }
    var pad = (mx - mn) * 0.15 || 1, yMin = mn - pad, yMax = mx + pad;
    function X(i) { return n === 1 ? padL + iW / 2 : padL + iW * i / (n - 1); }
    function Y(v) { return padT + iH * (1 - (v - yMin) / (yMax - yMin)); }
    var col = COLOR[gm];
    var d = '';
    for (var k = 0; k < n; k++) { var x = X(k), y = Y(pts[k].v); d += k === 0 ? ('M' + x + ',' + y) : (' L' + x + ',' + Y(pts[k - 1].v) + ' L' + x + ',' + y); }
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
  tabs.forEach(function (b) { b.addEventListener('click', function () { if (b.dataset.gm === gm) return; gm = b.dataset.gm; tabs.forEach(function (x) { x.classList.toggle('on', x === b); }); moveInd(); renderChart(); }); });

  // share
  var shareUrl = location.origin + location.pathname;
  var shareText = CH.name + ' の登録者数・再生数・投稿数｜PBers';
  var bx = document.getElementById('sh-x'); if (bx) bx.addEventListener('click', function () { window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText) + '&url=' + encodeURIComponent(shareUrl), '_blank', 'noopener'); });
  var bc = document.getElementById('sh-copy'); if (bc) bc.addEventListener('click', function () { navigator.clipboard && navigator.clipboard.writeText(shareUrl).then(function () { bc.textContent = 'コピーしました'; setTimeout(function () { bc.textContent = 'リンクをコピー'; }, 1500); }); });

  renderChart(); moveInd();
  window.addEventListener('resize', moveInd);
})();
