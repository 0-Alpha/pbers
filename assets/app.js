/* PBers — subscribers / total-views modes, giant donut + vertical columns,
   per-channel colors, hover overlay, scroll-triggered (replaying) animations */
(function () {
  var GBASE = window.PBERS_BASE || '/';   // このエディションの基点("/" または "/global/")
  var ALL = (window.PBERS_DATA || []).slice();
  // 掲示板: 公開状態をWorkerに問い合わせ、公開 or 管理キー所持者のみタブを出す(デプロイ=即公開ではない)
  var BOARD_API = window.PBERS_BOARD_API || '';
  var boardMaint = !!window.PBERS_BOARD_MAINTENANCE;   // 整備中フラグ(trueならAPIを叩かず案内表示)
  var boardKey = '', boardPublic = false, boardEnabled = false;
  var UPDATED = window.PBERS_UPDATED || '';

  var METRICS = {
    subs:   { key: 'subs',   unit: '人', word: '登録者',   cap: '合計登録者数 / Total Subscribers', ccap: 'Subscribers' },
    views:  { key: 'views',  unit: '回', word: '総再生数', cap: '合計総再生数 / Total Views',        ccap: 'Total Views' },
    videos: { key: 'videos', unit: '本', word: '投稿数',   cap: '合計投稿数 / Total Videos',         ccap: 'Videos' }
  };
  var metric = 'subs';
  var viewMode = 'both';       // 総再生数の内訳: both/short/long(横)。総再生数のときだけ有効
  var hideBig = false;         // 登録者10万人以上を除外
  var BIG = 100000;
  var gmetric = 'subs';        // 成長タブの指標
  var tierMetric = 'subs';     // チャンネル一覧タブの指標
  var TIER_BANDS = {
    subs: [
      { t: '10万人以上', min: 100000 }, { t: '5万〜10万人', min: 50000, max: 100000 },
      { t: '3万〜5万人', min: 30000, max: 50000 }, { t: '2万〜3万人', min: 20000, max: 30000 },
      { t: '1万〜2万人', min: 10000, max: 20000 }, { t: '5000〜1万人', min: 5000, max: 10000 },
      { t: '5000人未満', min: 0, max: 5000 }
    ],
    views: [
      { t: '1億回以上', min: 100000000 }, { t: '3000万〜1億回', min: 30000000, max: 100000000 },
      { t: '1000万〜3000万回', min: 10000000, max: 30000000 }, { t: '500万〜1000万回', min: 5000000, max: 10000000 },
      { t: '100万〜500万回', min: 1000000, max: 5000000 }, { t: '100万回未満', min: 0, max: 1000000 }
    ],
    videos: [
      { t: '1000本以上', min: 1000 }, { t: '500〜1000本', min: 500, max: 1000 },
      { t: '300〜500本', min: 300, max: 500 }, { t: '100〜300本', min: 100, max: 300 },
      { t: '100本未満', min: 0, max: 100 }
    ]
  };
  var GROWTH = window.PBERS_GROWTH || { span: { days: 0 }, subs: [], views: [], videos: [] };
  var GDAYS = GROWTH.days || [];             // 全履歴の日別(昇順)
  var GCHAN = GROWTH.channels || [];         // 各チャンネルの日別値(スライダーで任意期間を計算)
  var growWindow = Math.min(7, Math.max(1, GDAYS.length - 1));   // 集計ウィンドウ(日数・小数可)。既定7日
  var GUNIT = { subs: '人', views: '回', videos: '本' };
  // 急上昇タブ(伸び率%): 成長ランキングと同じ仕組みで、増減の代わりに増加率で並べる
  var riseMetric = 'subs';
  var riseWindow = Math.min(7, Math.max(1, GDAYS.length - 1));
  var riseZoom = 1;
  // 伸び率の足切り: 期間開始時の値がこれ未満のチャンネルは除外(小さな母数で率が暴れるのを防ぐ)
  var RISE_FLOOR = { subs: 300, views: 3000, videos: 2 };
  var RACE = window.PBERS_RACE || [];
  var GENRES = window.PBERS_GENRES || [];
  var genreOn = {}; GENRES.forEach(function (g) { genreOn[g.label] = !!g.on; });
  function genreVisible(x) { return x.genre == null || genreOn[x.genre] !== false; }
  var DATA = [];               // current sorted view
  var total = 0;

  /* ---- formatting ---- */
  function fmt(n) { return n.toLocaleString('en-US'); }
  // 3 significant figures: 1万〜10万 は小数2桁(例 2.34万), 10万〜100万 は1桁(例 38.4万)
  function sig3(x) { var dec = x < 10 ? 2 : (x < 100 ? 1 : 0); return parseFloat(x.toFixed(dec)).toString(); }
  function jp(n) {
    if (n == null) return '—';
    if (n >= 1e8) return sig3(n / 1e8) + '億';
    if (n >= 1e4) return sig3(n / 1e4) + '万';
    return fmt(n);
  }
  // 「リアル予測」モードでは円グラフ・棒グラフ・一覧は登録者ベースで描画する
  function bm() { return metric === 'predict' ? 'subs' : metric; }
  function val(d) {
    if (bm() === 'views' && viewMode !== 'both') return (viewMode === 'short' ? d.vShort : d.vLong) || 0;
    return d[bm()] || 0;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]; }); }
  function setText(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
  // fit the donut-center number so long values (e.g. 総再生数) never hit the ring
  function fitNum(el, text) {
    el.textContent = text;
    var stage = document.querySelector('.donut-stage');
    var avail = (stage ? stage.clientWidth : 360) * 0.56;   // inner-hole usable width
    var fs = Math.min(42, Math.max(15, avail / (text.length * 0.62)));
    el.style.fontSize = fs + 'px';
  }

  setText('updated', UPDATED); setText('updated-foot', UPDATED);
  document.getElementById('ch-count').textContent = ALL.length;

  /* ---- static DOM refs ---- */
  var svg = document.getElementById('donut-svg');
  var legend = document.getElementById('legend');
  var cols = document.getElementById('cols');
  var grid = document.getElementById('grid');
  var dcName = document.getElementById('dc-name'), dcNum = document.getElementById('dc-num'),
      dcCap = document.getElementById('dc-cap'), dcPct = document.getElementById('dc-pct');

  var R = 76, SW = 30, C = 2 * Math.PI * R, GAP = 0.006 * C, MAXBAR = 250;
  var TOPD = 30, OTHER_COLOR = '#4c4c4c';   // donut shows top 30 + "その他"
  var circles = [], chips = [], colEls = [], colBars = [];
  var sliceStart = [], sliceFrac = [], donutSegs = [], otherSeg = null;

  /* ---- center overlay ---- */
  function showTotal() {
    dcName.textContent = '';
    fitNum(dcNum, jp(total) + METRICS[bm()].unit);
    dcNum.style.color = 'var(--text)';
    dcCap.textContent = 'Total ・ ' + DATA.length + 'ch';
    dcPct.textContent = '';
  }
  function showChannel(i) {
    var d = DATA[i];
    dcName.textContent = d.name;
    fitNum(dcNum, (val(d) ? fmt(val(d)) : '非公開'));
    dcNum.style.color = d.color;
    dcCap.textContent = METRICS[bm()].ccap;
    dcPct.textContent = total ? (val(d) / total * 100).toFixed(1) + '%' : '';
  }
  function showOther() {
    if (!otherSeg) return;
    dcName.textContent = 'その他';
    fitNum(dcNum, jp(otherSeg.value) + METRICS[bm()].unit);
    dcNum.style.color = '#c9c5c2';
    dcCap.textContent = otherSeg.count + ' channels';
    dcPct.textContent = total ? (otherSeg.value / total * 100).toFixed(1) + '%' : '';
  }

  /* ---- shared hover focus (i = index into DATA) ---- */
  function focus(i) {
    circles.forEach(function (c, k) {
      var s = donutSegs[k];
      var on = s.type === 'ch' ? s.idx === i : i >= TOPD;   // channel is its own slice, or inside "その他"
      c.style.opacity = on ? '1' : '0.25'; c.setAttribute('stroke-width', on ? SW + 8 : SW);
    });
    chips.forEach(function (ch, j) { ch.classList.toggle('dim', j !== i); });
    colEls.forEach(function (co, j) { co.style.opacity = j === i ? '1' : '0.4'; });
    showChannel(i);
  }
  function focusOther() {
    circles.forEach(function (c, k) {
      var on = donutSegs[k].type === 'other';
      c.style.opacity = on ? '1' : '0.25'; c.setAttribute('stroke-width', on ? SW + 8 : SW);
    });
    chips.forEach(function (ch, j) { ch.classList.toggle('dim', j < TOPD); });
    colEls.forEach(function (co, j) { co.style.opacity = j < TOPD ? '0.4' : '1'; });
    showOther();
  }
  function unfocus() {
    circles.forEach(function (c) { c.style.opacity = '1'; c.setAttribute('stroke-width', SW); });
    chips.forEach(function (ch) { ch.classList.remove('dim'); });
    colEls.forEach(function (co) { co.style.opacity = '1'; });
    showTotal();
  }

  /* ---- (re)build everything for current metric ---- */
  function build() {
    var base = ALL.filter(genreVisible);
    if (hideBig) base = base.filter(function (d) { return (d.subs || 0) < BIG; });
    DATA = base.slice().sort(function (a, b) { return val(b) - val(a); });
    total = DATA.reduce(function (s, d) { return s + val(d); }, 0);
    var max = val(DATA[0]) || 1;

    var capSuffix = (bm() === 'views' && viewMode !== 'both') ? (viewMode === 'short' ? '（ショート）' : '（横）') : '';
    setText('total-cap', METRICS[bm()].cap + capSuffix);
    setText('rank-title', METRICS[bm()].word + 'ランキング');
    document.getElementById('total').innerHTML = fmt(total) + '<span class="u">' + METRICS[bm()].unit + '</span>';
    document.getElementById('total-man').textContent = jp(total) + METRICS[bm()].unit;

    /* donut: top 30 individual + "その他" aggregate (hover via setupDonutHover) */
    svg.innerHTML = ''; circles = []; sliceStart = []; sliceFrac = []; donutSegs = []; otherSeg = null;
    var segs = [];
    DATA.slice(0, TOPD).forEach(function (d, i) { segs.push({ type: 'ch', idx: i, value: val(d), color: d.color }); });
    var rest = DATA.slice(TOPD);
    if (rest.length) {
      otherSeg = { type: 'other', value: rest.reduce(function (a, d) { return a + val(d); }, 0), color: OTHER_COLOR, count: rest.length };
      segs.push(otherSeg);
    }
    var acc = 0;
    segs.forEach(function (sg) {
      var frac = total ? sg.value / total : 0;
      var len = Math.max(frac * C - GAP, 0);
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', 100); c.setAttribute('cy', 100); c.setAttribute('r', R);
      c.setAttribute('fill', 'none'); c.setAttribute('stroke', sg.color); c.setAttribute('stroke-width', SW);
      c.setAttribute('stroke-dasharray', '0 ' + C); c.setAttribute('stroke-dashoffset', -acc * C);
      c.style.transition = 'stroke-dasharray .9s cubic-bezier(.22,1,.36,1), opacity .2s ease, stroke-width .2s ease';
      c.style.pointerEvents = 'none';
      c.dataset.len = len;
      svg.appendChild(c); circles.push(c); donutSegs.push(sg);
      sliceStart.push(acc); sliceFrac.push(frac); acc += frac;
    });

    /* legend: top 10 shown, the rest collapsed into a tappable "その他" */
    legend.innerHTML = ''; legend.classList.remove('expanded'); chips = [];
    var TOP = 10;
    var more = document.createElement('div'); more.className = 'legend-more';
    DATA.forEach(function (d, i) {
      var el = document.createElement('span');
      el.className = 'chip';
      el.innerHTML = '<span class="sw" style="background:' + d.color + '"></span>' +
        '<span class="cn">' + esc(d.name) + '</span>' +
        '<span class="cv">' + (val(d) ? jp(val(d)) : '—') + '</span>';
      el.addEventListener('mouseenter', function () { focus(i); });
      el.addEventListener('mouseleave', unfocus);
      chips.push(el);
      (i < TOP ? legend : more).appendChild(el);
    });
    if (DATA.length > TOP) {
      var tog = document.createElement('span');
      tog.className = 'chip more-toggle';
      tog.innerHTML = '<span class="sw"></span><span class="cn">その他 ' + (DATA.length - TOP) + 'ch</span><span class="arw">▾</span>';
      tog.addEventListener('click', function () {
        var open = more.classList.toggle('open');
        legend.classList.toggle('expanded', open);
      });
      legend.appendChild(tog);
      legend.appendChild(more);
    }

    /* columns */
    cols.innerHTML = ''; colEls = []; colBars = [];
    DATA.forEach(function (d, i) {
      var col = document.createElement('div');
      col.className = 'col' + (i < 3 ? ' top' : '');
      col.innerHTML =
        '<div class="col-bararea">' +
          '<div class="col-val" style="color:' + d.color + '">' + (val(d) ? jp(val(d)) : '—') + '</div>' +
          '<div class="col-bar" style="background:' + d.color + '" data-frac="' + (max ? val(d) / max : 0) + '"></div>' +
        '</div>' +
        '<div class="col-foot"><div class="col-rank num">' + (i + 1) + '</div>' +
        '<div class="col-name">' + esc(d.name) + '</div></div>';
      col.addEventListener('mouseenter', function () { focus(i); });
      col.addEventListener('mouseleave', unfocus);
      // タップ/クリックで即そのチャンネルのページへ(横ドラッグ中は .col-scroll.drag が抑止)
      col.style.cursor = 'pointer';
      col.addEventListener('click', function () { location.href = GBASE + 'c/' + encodeURIComponent(d.slug || chId(d)) + '/'; });
      cols.appendChild(col); colEls.push(col); colBars.push(col.querySelector('.col-bar'));
    });

    /* directory: top 20 + "その他" card linking to the channel-list tab */
    grid.innerHTML = '';
    var DIRTOP = 20;
    DATA.slice(0, DIRTOP).forEach(function (d, i) { grid.appendChild(cardEl(d, i + 1)); });
    if (DATA.length > DIRTOP) {
      var more = document.createElement('a');
      more.className = 'card more-card'; more.href = '#';
      more.innerHTML = 'その他 ' + (DATA.length - DIRTOP) + '件を見る <span class="arrow">→</span>';
      more.addEventListener('click', function (e) { e.preventDefault(); switchTab('channels'); });
      grid.appendChild(more);
    }

    showTotal();
    if (metric === 'predict') enterPredictUI(); else exitPredictUI();
  }

  /* ---- リアル予測: サーバ側(gen_data)で算出したモデルから現在値を推定し自動カウントアップ ----
     モデルはチャンネル単位・過去7日・直近ほど加重・総再生数の減少は除外(名簿変更の影響を受けない)。 */
  var predictRAF = null, predictT0 = 0;
  var PREDICT_REVEAL = 1600;   // reveal(0→現在値)の時間(ms)
  var PREDICT = window.PBERS_PREDICT || { asOfMs: Date.now(), subs: { base: 0, rate: 0 }, views: { base: 0, rate: 0 } };
  function liveVal(key) {
    var m = PREDICT[key] || { base: 0, rate: 0 };
    return m.base + m.rate * (Date.now() - (PREDICT.asOfMs || Date.now()));
  }
  function predictFrame(now) {
    if (metric !== 'predict' || (VIEWS.dashboard && VIEWS.dashboard.hidden)) { predictRAF = null; return; }
    var e = Math.min(1, (now - predictT0) / PREDICT_REVEAL); e = 1 - Math.pow(1 - e, 3);   // easeOut
    var subsN = Math.round(liveVal('subs') * e);
    var viewsN = Math.round(liveVal('views') * e);
    var t = document.getElementById('total'); if (t) t.innerHTML = fmt(subsN) + '<span class="u">人</span>';
    var pv = document.getElementById('predict-views'); if (pv) pv.textContent = fmt(viewsN);
    predictRAF = requestAnimationFrame(predictFrame);
  }
  function enterPredictUI() {
    setText('total-cap', 'リアル予測 合計登録者数 / Live Estimate');
    var ts = document.querySelector('.total-sub'); if (ts) ts.hidden = true;
    var ps = document.getElementById('predict-sub'); if (ps) ps.hidden = false;
    if (!predictRAF) { predictT0 = performance.now(); predictRAF = requestAnimationFrame(predictFrame); }
  }
  function exitPredictUI() {
    if (predictRAF) { cancelAnimationFrame(predictRAF); predictRAF = null; }
    var ts = document.querySelector('.total-sub'); if (ts) ts.hidden = false;
    var ps = document.getElementById('predict-sub'); if (ps) ps.hidden = true;
  }

  /* ---- animations (replay on view + on metric change) ---- */
  function playDonut(on) {
    circles.forEach(function (c) { c.setAttribute('stroke-dasharray', on ? (c.dataset.len + ' ' + (C - c.dataset.len)) : ('0 ' + C)); });
  }
  function playCols(on) {
    var area = document.querySelector('.col-bararea');
    var avail = area ? Math.max(60, area.clientHeight - 30) : 220;   // fit whatever height CSS gives (desktop/mobile)
    colBars.forEach(function (b, k) {
      b.style.transitionDelay = on ? (k * 0.03) + 's' : '0s';
      b.style.height = on ? (parseFloat(b.dataset.frac) * avail) + 'px' : '0px';
    });
    colEls.forEach(function (co) { co.classList.toggle('shown', on); });
  }
  // replay() is only called from deliberate actions (metric/filter/genre change,
  // switching to the dashboard). Always play so the donut/columns are guaranteed
  // visible afterward — do NOT gate on scroll position (that could leave the arcs
  // stuck invisible on shorter/mobile viewports).
  function replay() {
    playDonut(false); playCols(false);
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      playDonut(true); playCols(true);
    }); });
  }
  function observe(el, play) {
    if (!el || !('IntersectionObserver' in window)) { play(true); return; }
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { requestAnimationFrame(function () { play(true); }); return; }
        var r = e.boundingClientRect;
        if (r.width || r.height) play(false);   // genuine scroll-out only; ignore tab-hidden (0-size) to avoid a stale false wiping the arcs
      });
    }, { threshold: 0.2 }).observe(el);
  }

  /* ---- toggle wiring ---- */
  var tgBtns = Array.prototype.slice.call(document.querySelectorAll('#toggle .tg'));
  var ind = document.getElementById('tg-ind');
  function moveInd(btn) { ind.style.left = btn.offsetLeft + 'px'; ind.style.width = btn.offsetWidth + 'px'; }
  tgBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.dataset.metric === metric) return;
      metric = btn.dataset.metric;
      tgBtns.forEach(function (b) { b.classList.toggle('on', b === btn); });
      moveInd(btn);
      syncVType();
      build();
      replay();
    });
  });
  /* ---- 総再生数の内訳(両方/ショート/横)。総再生数選択時だけ表示 ---- */
  var vtypeWrap = document.getElementById('vtype');
  function syncVType() { if (vtypeWrap) vtypeWrap.hidden = (metric !== 'views'); }
  if (vtypeWrap) {
    vtypeWrap.querySelectorAll('.vt').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.vt === viewMode) return;
        viewMode = b.dataset.vt;
        vtypeWrap.querySelectorAll('.vt').forEach(function (x) { x.classList.toggle('on', x === b); });
        build();
        replay();
      });
    });
    syncVType();
  }

  /* ---- donut hover by angle (wide band, no dead gaps between slices) ---- */
  function setupDonutHover() {
    var stage = document.querySelector('.donut-stage');
    var TOL = 26;                 // px, widens the hoverable ring band
    var TAU = Math.PI * 2, cur = -1;
    function hitAt(px, py) {   // 座標から扇の index を返す(帯の外は -1)
      var r = stage.getBoundingClientRect();
      var scale = r.width / 200;
      var dx = px - (r.left + r.width / 2);
      var dy = py - (r.top + r.height / 2);
      var dist = Math.sqrt(dx * dx + dy * dy);
      var inner = (R - SW / 2) * scale - TOL, outer = (R + SW / 2) * scale + TOL;
      if (dist < inner || dist > outer) return -1;
      var ang = Math.atan2(dx, -dy); if (ang < 0) ang += TAU;   // 0 at top, clockwise
      var frac = ang / TAU;
      for (var i = 0; i < sliceFrac.length; i++) {
        if (sliceFrac[i] > 0 && frac >= sliceStart[i] && frac < sliceStart[i] + sliceFrac[i]) return i;
      }
      return -1;
    }
    function applyHit(hit) {
      if (hit === cur) return;
      cur = hit;
      if (hit === -1) unfocus();
      else if (donutSegs[hit].type === 'other') focusOther();
      else focus(donutSegs[hit].idx);
    }
    function goto(hit) {   // その扇の遷移先へ
      if (hit < 0) return false;
      if (donutSegs[hit].type === 'other') { switchTab('channels'); return true; }
      var d = DATA[donutSegs[hit].idx];
      if (d) { location.href = GBASE + 'c/' + encodeURIComponent(d.slug || chId(d)) + '/'; return true; }
      return false;
    }
    stage.addEventListener('mousemove', function (e) { applyHit(hitAt(e.clientX, e.clientY)); });
    stage.addEventListener('mouseleave', function () { cur = -1; unfocus(); });

    // タッチ: 1回目のタップ=詳細表示 / 同じ扇をもう一度タップ=そのページへ
    var lastTouchHit = -2, lastTouchTime = 0;
    stage.addEventListener('touchstart', function (e) {
      var t = e.touches && e.touches[0]; if (!t) return;
      lastTouchTime = Date.now();
      var hit = hitAt(t.clientX, t.clientY);
      if (hit >= 0 && hit === lastTouchHit) { if (goto(hit)) return; }
      lastTouchHit = hit;
      applyHit(hit);
    }, { passive: true });
    stage.addEventListener('touchmove', function (e) {
      var t = e.touches && e.touches[0]; if (!t) return;
      lastTouchHit = hitAt(t.clientX, t.clientY);
      applyHit(lastTouchHit);
    }, { passive: true });

    // マウス: クリックでそのページへ(タッチ由来の合成クリックは無視)
    stage.addEventListener('click', function (e) {
      if (Date.now() - lastTouchTime < 700) return;
      goto(hitAt(e.clientX, e.clientY));
    });
    stage.style.cursor = 'pointer';
  }

  /* ---- easier horizontal scroll for column-style charts (wheel + drag) ---- */
  function setupColScroll() { ['col-scroll', 'grow-scroll', 'rise-scroll'].forEach(function (id) { var el = document.getElementById(id); if (el) setupScroll(el); }); }
  function setupScroll(sc) {
    sc.addEventListener('wheel', function (e) {
      if (sc.scrollWidth <= sc.clientWidth) return;
      var d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (d) { sc.scrollLeft += d; e.preventDefault(); }
    }, { passive: false });
    var down = false, sx = 0, sl = 0, moved = 0;
    sc.addEventListener('pointerdown', function (e) {
      down = true; moved = 0; sx = e.clientX; sl = sc.scrollLeft; sc.setPointerCapture(e.pointerId);
    });
    sc.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - sx; moved += Math.abs(dx);
      if (moved > 4) sc.classList.add('drag');
      sc.scrollLeft = sl - dx;
    });
    function end() { down = false; sc.classList.remove('drag'); }
    sc.addEventListener('pointerup', end);
    sc.addEventListener('pointercancel', end);
  }

  /* ---- channel card (used by directory + tier list) ---- */
  function chId(d) { return (d.url || '').split('/channel/')[1] || ''; }
  // YouTubeアバター(=s900 等)を表示サイズ相当に縮小してURLを返す。一覧の画像を軽くする用。
  function avSize(url, px) {
    if (!url) return url;
    return url.replace(/=s\d+/, '=s' + px).replace(/=w\d+-h\d+/, '=s' + px);
  }
  function cardEl(d, rankNum) {
    var wrap = document.createElement('div');
    wrap.className = 'card';
    wrap.style.setProperty('--c', d.color);   // ホバー時の枠色(CSSの .card:hover が参照)
    wrap.innerHTML =
      '<a class="card-main" href="' + GBASE + 'c/' + encodeURIComponent(d.slug || chId(d)) + '/">' +
        '<span class="rk num">' + rankNum + '</span>' +
        '<img class="av" loading="lazy" width="48" height="48" src="' + avSize(d.avatar, 96) + '" alt="" style="border-color:' + d.color + '" onerror="this.style.visibility=\'hidden\'">' +
        '<span class="meta"><span class="cn">' + esc(d.name) + '</span>' +
        '<span class="cstats">' +
          '<span class="cstat"><i>登録者</i>' + (d.subs != null ? jp(d.subs) + '人' : '非公開') + '</span>' +
          '<span class="cstat"><i>総再生</i>' + (d.views != null ? jp(d.views) + '回' : '非公開') + '</span>' +
          '<span class="cstat"><i>投稿数</i>' + (d.videos != null ? fmt(d.videos) + '本' : '—') + '</span>' +
        '</span></span>' +
        '<span class="go" aria-hidden="true">›</span>' +
      '</a>';
    return wrap;
  }

  /* ---- channels-by-tier view (subscriber bands) ---- */
  function moveTierInd() {
    var on = document.querySelector('#tier-toggle .tg.on'), ind = document.getElementById('ttg-ind');
    if (on && ind) { ind.style.left = on.offsetLeft + 'px'; ind.style.width = on.offsetWidth + 'px'; }
  }
  function setupTierToggle() {
    var tabs = [].slice.call(document.querySelectorAll('#tier-toggle .tg'));
    tabs.forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.tm === tierMetric) return;
        tierMetric = b.dataset.tm;
        tabs.forEach(function (x) { x.classList.toggle('on', x === b); });
        moveTierInd(); renderTiers();
      });
    });
  }
  function renderTiers() {
    var host = document.getElementById('tiers'); if (!host) return;
    var m = tierMetric;
    var list = ALL.filter(genreVisible).sort(function (a, b) { return (b[m] || 0) - (a[m] || 0); });
    var rankOf = {}; list.forEach(function (d, i) { rankOf[d.url] = i + 1; });
    host.innerHTML = '';
    TIER_BANDS[m].forEach(function (b) {
      var inb = list.filter(function (d) { var s = d[m] || 0; return s >= b.min && (b.max == null || s < b.max); });
      if (!inb.length) return;
      var band = document.createElement('div'); band.className = 'tier-band';
      var h = document.createElement('h3');
      h.innerHTML = '<span class="bar"></span>' + b.t + '<span class="cnt">' + inb.length + ' ch</span>';
      var g = document.createElement('div'); g.className = 'grid';
      inb.forEach(function (d) { g.appendChild(cardEl(d, rankOf[d.url])); });
      band.appendChild(h); band.appendChild(g); host.appendChild(band);
    });
  }

  /* ---- growth ranking (increase over the available window) ---- */
  function shortDate(s) {
    if (!s) return '';
    s = String(s);
    var y = +s.slice(0, 4), mo = +s.slice(5, 7), da = +s.slice(8, 10);
    var t = s.length > 10 ? s.slice(11, 16) : '';
    if (t === '00:00') { var dt = new Date(y, mo - 1, da); dt.setDate(dt.getDate() - 1); return (dt.getMonth() + 1) + '/' + dt.getDate(); }
    return mo + '/' + da;
  }
  var BASE_GROW_H = 270, growZoom = 1;   // plot height (shared up+down range), zoom multiplier
  var GC = { UP: '#33bb74', DOWN: '#e0554b' };
  function _mean(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : 0; }
  function _std(a) { if (!a.length) return 0; var m = _mean(a); return Math.sqrt(_mean(a.map(function (v) { return (v - m) * (v - m); }))); }

  // 指定ウィンドウの各チャンネル増減を算出し降順で返す。小数の位置は最寄りの整数日に丸める(近似)
  function growSeries(metric, win) {
    if (GDAYS.length < 2) return [];
    var w = Math.max(1, Math.round(win));       // 途中位置は近い方の日数へスナップ
    var end = GDAYS.length - 1, start = Math.max(0, end - w), out = [];
    GCHAN.filter(genreVisible).forEach(function (c) {
      var arr = c[metric] || [], a = null, b = null, cnt = 0;
      for (var i = start; i <= end; i++) {
        if (arr[i] != null) { if (a === null) a = arr[i]; b = arr[i]; cnt++; }
      }
      if (cnt < 2) return;                       // ウィンドウ内に2点以上ないと増減を出せない
      out.push({ name: c.name, color: c.color, delta: b - a });
    });
    out.sort(function (p, q) { return q.delta - p.delta; });
    return out;
  }
  // 固定ベースライン(上72% / 下28%)。ウィンドウが変わってもゼロ線は動かない=滑らかに伸縮
  function growLayout(list, zoom) {
    var z = zoom || growZoom;
    var H = Math.round(BASE_GROW_H * z);
    var PADV = Math.round(30 * z);
    var usable = Math.max(40, H - 2 * PADV);
    var upSpace = usable * 0.72, downSpace = usable * 0.28;
    var maxUp = 0, maxDown = 0;
    list.forEach(function (x) { if (x.delta > maxUp) maxUp = x.delta; if (-x.delta > maxDown) maxDown = -x.delta; });
    var cands = [];
    if (maxUp) cands.push(upSpace / maxUp);
    if (maxDown) cands.push(downSpace / maxDown);
    var perPx = cands.length ? Math.min.apply(null, cands) : 1;
    var baseFromBottom = PADV + downSpace;                  // 固定
    return { H: H, perPx: perPx, baseFromBottom: baseFromBottom, baseFromTop: H - (PADV + downSpace) };
  }
  // 成長/急上昇の棒 → 個別ページへの導線用: チャンネル名から slug / アバターを引く
  var SLUG_BY_NAME = {}, AV_BY_NAME = {};
  ALL.forEach(function (d) { SLUG_BY_NAME[d.name] = d.slug || chId(d); AV_BY_NAME[d.name] = d.avatar || ''; });
  // 掲示板の本文中に書かれたPBer名を検出 → 投稿の下に「言及」注釈として表示するための対応表
  // 完全一致ではなく「正規化」して照合する: 大文字小文字・全角/半角・カタカナ/ひらがな・
  // 中点/記号/絵文字/装飾を吸収し、英数・かな・漢字だけで比較する。さらに:
  //   ・末尾「ぼーる/ボール」は省略しても当たる(mnCoreで核キーも登録)
  //   ・漢字読みや通称など正規化で吸収できないものは MENTION_ALIAS で別名を追加
  // 1チャンネルにつき複数キーを持たせ、長いキー優先で照合。同一チャンネルは1回だけ表示。
  var MENTION = [];   // { key, name, slug, color, avatar } を key の長い順で保持
  var MENTION_ALIAS = {   // 登録名 → 追加で当てたい別名(読み・通称)。正規化で吸収できない分だけ手当て
    '田中MID': ['たなか', '田中'],
    'にこちPB': ['にこち']
  };
  function mnNorm(s) {
    s = String(s == null ? '' : s);
    // 互換分解 + 全角英数記号→半角(NFKC)。全角カナ↔半角カナも半角化される
    try { s = s.normalize('NFKC'); } catch (e) {}
    s = s.toLowerCase();
    // カタカナ→ひらがな (U+30A1..U+30F6)
    s = s.replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
    // 英数字・ひらがな・長音符「ー」・漢字だけ残す(記号/絵文字/中点/空白/装飾を全部除去)
    s = s.replace(/[^0-9a-z぀-ゟー一-鿿]/g, '');
    return s;
  }
  function mnCore(k) { return k.replace(/ぼーる$/, ''); }   // 末尾「ぼーる/ボール」を省いた核
  (function buildMentions() {
    var seenKey = {};
    function add(key, e, minLen) {
      if (!key || key.length < (minLen || 3)) return;   // 短すぎるキーは誤マッチ防止で除外
      if (seenKey[key]) return;                          // 同じキーは先勝ち(重複チャンネル対策)
      seenKey[key] = 1; MENTION.push({ key: key, name: e.name, slug: e.slug, color: e.color, avatar: e.avatar });
    }
    ALL.forEach(function (d) {
      if (!d.name) return;
      var e = { name: d.name, slug: d.slug || chId(d), color: d.color || '#8d8986', avatar: d.avatar || '' };
      var full = mnNorm(d.name); add(full, e);
      var core = mnCore(full); if (core !== full) add(core, e);   // ボール無しでも当てる
      var al = MENTION_ALIAS[d.name];
      if (al) al.forEach(function (a) { add(mnNorm(a), e, 2); });  // 別名は2文字から許可(例:田中)
    });
    MENTION.sort(function (a, b) { return b.key.length - a.key.length; });   // 長いキー優先
  })();
  function mentionsIn(body) {   // 本文から言及されたチャンネルを重複なく抽出
    if (!MENTION.length || !body) return [];
    var hay = mnNorm(body); if (!hay) return [];
    var out = [], seenName = {};
    for (var i = 0; i < MENTION.length && out.length < 12; i++) {
      var e = MENTION[i];
      if (seenName[e.name]) continue;                    // 同一チャンネルは1回だけ
      if (hay.indexOf(e.key) !== -1) { seenName[e.name] = 1; out.push(e); }
    }
    return out;
  }
  function postMentions(body) {   // 投稿の下に出す「言及」注釈(チップ)
    var ms = mentionsIn(body); if (!ms.length) return '';
    return '<div class="post-mentions"><span class="pm-label">言及</span>' + ms.map(function (e) {
      return '<a class="pm-chip" href="' + GBASE + 'c/' + encodeURIComponent(e.slug) + '/" style="--c:' + e.color + '">' +
        (e.avatar ? '<img loading="lazy" width="18" height="18" src="' + esc(avSize(e.avatar, 48)) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
        '<span>' + esc(e.name) + '</span></a>';
    }).join('') + '</div>';
  }
  function makeGrowCol(key) {
    var col = document.createElement('div');
    col.className = 'grow-col shown'; col.dataset.key = key;
    col.innerHTML =
      '<div class="grow-plot">' +
        '<div class="gbaseline"></div>' +
        '<div class="gbar up"><div class="ghead up"></div><div class="gshaft"></div></div>' +
        '<div class="gval up"></div>' +
      '</div>' +
      '<div class="grow-foot"><div class="grow-crank num"></div><div class="grow-cname"></div></div>';
    col.addEventListener('click', function () {   // クリックでそのチャンネルの個別ページへ
      var s = col.dataset.slug; if (s) location.href = GBASE + 'c/' + encodeURIComponent(s) + '/';
    });
    return col;
  }
  function setGrowCol(col, x, rank, L) {
    var bar = col.querySelector('.gbar'), val = col.querySelector('.gval'), head = col.querySelector('.ghead');
    var dir = x.delta > 0 ? 'up' : (x.delta < 0 ? 'down' : 'flat');
    var barPx = dir === 'flat' ? 0 : Math.abs(x.delta) * L.perPx;
    var sign = x.delta > 0 ? '+' : (x.delta < 0 ? '−' : '±');
    bar.className = 'gbar ' + (dir === 'down' ? 'down' : 'up');
    head.className = 'ghead ' + (dir === 'down' ? 'down' : 'up');
    if (dir === 'down') { bar.style.top = L.baseFromTop + 'px'; bar.style.bottom = ''; }
    else { bar.style.bottom = L.baseFromBottom + 'px'; bar.style.top = ''; }
    bar.style.transitionDelay = '0s';
    bar.style.height = barPx + 'px';
    val.className = 'gval ' + dir;
    val.textContent = sign + fmt(Math.abs(x.delta)) + GUNIT[gmetric];
    if (dir === 'down') { val.style.top = (L.baseFromTop + barPx + 6) + 'px'; val.style.bottom = ''; }
    else { val.style.bottom = (L.baseFromBottom + barPx + 6) + 'px'; val.style.top = ''; }
    col.querySelector('.grow-crank').textContent = rank;
  }
  // スライダー/トグルで呼ぶ描画。既存の棒は高さをトランジション、並び替えはFLIPで滑らかに動かす(再描画しない)
  function growRender(animate) {
    var host = document.getElementById('grow-list'); if (!host) return;
    var note = document.getElementById('growth-span');
    var rangeBox = document.getElementById('grow-range');
    var hint = document.getElementById('grow-hint');
    if (GDAYS.length < 2) {
      if (rangeBox) rangeBox.hidden = true;
      if (hint) hint.style.display = 'none';
      if (note) note.textContent = '';
      host.innerHTML = '<div class="grow-empty">成長ランキングは履歴が2日分たまると表示されます（明日以降に自動反映）。</div>';
      return;
    }
    if (rangeBox) rangeBox.hidden = false;
    if (hint) hint.style.display = '';
    var list = growSeries(gmetric, growWindow);
    var L = growLayout(list);
    var end = GDAYS.length - 1, wr = Math.max(1, Math.round(growWindow)), start = Math.max(0, end - wr);
    if (note) note.textContent = '過去' + (end - start) + '日間（' + shortDate(GDAYS[start]) + '→' + shortDate(GDAYS[end]) + '）の増減';
    host.style.gap = Math.round(12 * growZoom) + 'px';
    var colBasis = Math.round(46 * growZoom), colMax = Math.round(66 * growZoom);

    var oldLeft = {}, existing = {};
    [].forEach.call(host.children, function (c) {
      if (c.dataset && c.dataset.key != null) { oldLeft[c.dataset.key] = c.getBoundingClientRect().left; existing[c.dataset.key] = c; }
    });
    var used = {}, fresh = [];
    list.forEach(function (x, i) {
      var col = existing[x.name];
      if (!col) { col = makeGrowCol(x.name); fresh.push(col); }
      col.style.flex = '1 0 ' + colBasis + 'px'; col.style.maxWidth = colMax + 'px';
      col.querySelector('.grow-plot').style.height = L.H + 'px';
      col.querySelector('.gbaseline').style.bottom = L.baseFromBottom + 'px';
      col.querySelector('.grow-cname').textContent = x.name;
      col.dataset.slug = SLUG_BY_NAME[x.name] || '';
      setGrowCol(col, x, i + 1, L);
      host.appendChild(col);          // 正しい順序へ移動
      used[x.name] = true;
    });
    [].slice.call(host.children).forEach(function (c) {
      if (c.dataset && c.dataset.key != null && !used[c.dataset.key]) c.remove();
    });
    // 新規の棒は 0 から目標高さへ伸ばす(登場アニメ)
    fresh.forEach(function (c, k) {
      var bar = c.querySelector('.gbar'), h = bar.style.height;
      bar.style.height = '0px'; bar.offsetHeight;   // reflow
      bar.style.transitionDelay = animate ? (Math.min(k, 30) * 0.015) + 's' : '0s';
      bar.style.height = h;
    });
    // 既存の棒は位置ずれをFLIPで滑らかに(左右に流れて並び替わる)
    if (animate) {
      [].forEach.call(host.children, function (c) {
        var key = c.dataset.key; if (oldLeft[key] == null) return;
        var dx = oldLeft[key] - c.getBoundingClientRect().left;
        if (dx) {
          c.style.transition = 'none'; c.style.transform = 'translateX(' + dx + 'px)';
          requestAnimationFrame(function () { c.style.transition = 'transform .55s cubic-bezier(.22,1,.36,1)'; c.style.transform = ''; });
        }
      });
    }
  }
  function renderGrowth() { growRender(true); }
  function playGrowth() {
    var tog = document.getElementById('growth-toggle'), on = tog && tog.querySelector('.tg.on');
    var gind = document.getElementById('gtg-ind');
    if (on && gind) { gind.style.left = on.offsetLeft + 'px'; gind.style.width = on.offsetWidth + 'px'; }
    growRender(true);
  }
  function setupGrowthSlider() {
    var s = document.getElementById('grow-slider'); if (!s) return;
    var maxW = Math.max(1, GDAYS.length - 1);
    s.min = 1; s.max = maxW; s.step = 'any';       // 連続スライド(小数)。1日=右, 最長=左(CSS direction:rtl)
    if (growWindow > maxW) growWindow = maxW;
    s.value = growWindow;
    var lab = document.getElementById('grow-range-val');
    var lastW = Math.max(1, Math.round(growWindow));
    if (lab) lab.textContent = lastW + '日';
    var raf = null;
    s.addEventListener('input', function () {
      growWindow = parseFloat(s.value) || 1;
      var w = Math.max(1, Math.round(growWindow));
      if (lab) lab.textContent = w + '日';        // ラベルは毎回更新(軽い)
      if (w === lastW) return;                     // 丸めた日数が同じなら再描画しない(ドラッグ中の重さを解消)
      lastW = w;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () { growRender(true); });
    });
  }
  /* ---- 界隈全体の推移（ステップ折れ線） ---- */
  var TREND_COLOR = { subs: '#33bb74', views: '#9b7bff', videos: '#eba864' };
  function renderTrend() {
    var host = document.getElementById('trend'); if (!host) return;
    var T = GROWTH.totals || { dates: [] };
    var dates = T.dates || [], vals = T[gmetric] || [];
    if (!dates.length || !vals.length) {
      host.innerHTML = '<div class="t-empty">推移データはまだありません（記録が増えると表示されます）。</div>';
      return;
    }
    // viewBox width = 実際のピクセル幅 → 文字・線が縮小されない（スマホでも読める）
    var W = Math.max(300, (host.clientWidth || 720) - 28), H = 240;
    var padL = 54, padR = 16, padT = 18, padB = 30;
    var innerW = W - padL - padR, innerH = H - padT - padB, n = dates.length;
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (min === max) { min = min * 0.98; max = max * 1.02 || 1; }
    var pad = (max - min) * 0.15 || 1; var yMin = min - pad, yMax = max + pad;
    function X(i) { return n === 1 ? padL + innerW / 2 : padL + innerW * i / (n - 1); }
    function Y(v) { return padT + innerH * (1 - (v - yMin) / (yMax - yMin)); }
    var col = TREND_COLOR[gmetric] || '#4db6e0';

    var d = '';   // 点を直線で結ぶ折れ線
    for (var i = 0; i < n; i++) { d += (i === 0 ? 'M' : ' L') + X(i) + ',' + Y(vals[i]); }
    var grid = '', yl = '';
    [yMax, (yMax + yMin) / 2, yMin].forEach(function (gv) {
      var gy = Y(gv);
      grid += '<line class="t-grid" x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>';
      yl += '<text class="t-axis" x="' + (padL - 8) + '" y="' + (gy + 4) + '" text-anchor="end">' + jp(Math.round(gv)) + '</text>';
    });
    var xl = '', step = Math.max(1, Math.ceil(n / 6));
    for (var j = 0; j < n; j++) {
      if (j % step === 0 || j === n - 1) xl += '<text class="t-axis" x="' + X(j) + '" y="' + (H - 10) + '" text-anchor="middle">' + shortDate(dates[j]) + '</text>';
    }
    var dots = '';
    for (var k = 0; k < n; k++) dots += '<circle class="t-dot" cx="' + X(k) + '" cy="' + Y(vals[k]) + '" r="3.5" fill="' + col + '"/>';
    var last = '<text class="t-val" x="' + X(n - 1) + '" y="' + (Y(vals[n - 1]) - 9) + '" text-anchor="end">' + jp(vals[n - 1]) + GUNIT[gmetric] + '</text>';
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
      grid + yl + xl + '<path class="t-line" d="' + d + '" stroke="' + col + '"/>' + dots + last + '</svg>';
  }

  function setupGrowthZoom() {
    var out = document.getElementById('gz-out'), inn = document.getElementById('gz-in'), val = document.getElementById('gz-val');
    function upd() { if (val) val.textContent = Math.round(growZoom * 100) + '%'; growRender(true); }
    if (out) out.addEventListener('click', function () { growZoom = Math.max(0.5, Math.round((growZoom - 0.25) * 100) / 100); upd(); });
    if (inn) inn.addEventListener('click', function () { growZoom = Math.min(2, Math.round((growZoom + 0.25) * 100) / 100); upd(); });
  }
  function setupGrowth() {
    var gtabs = [].slice.call(document.querySelectorAll('#growth-toggle .tg'));
    gtabs.forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.gm === gmetric) return;
        gmetric = b.dataset.gm;
        gtabs.forEach(function (x) { x.classList.toggle('on', x === b); });
        playGrowth(); renderTrend();     // playGrowth が赤インジケータ(#gtg-ind)を移動＋再描画
      });
    });
  }

  /* ---- 急上昇ランキング(伸び率%) — 成長ランキングと同じ見た目でオレンジ系。増減の代わりに増加率で並べる ---- */
  function riseSeries(metric, win) {
    if (GDAYS.length < 2) return [];
    var w = Math.max(1, Math.round(win));       // 途中位置は近い方の日数へスナップ
    var end = GDAYS.length - 1, start = Math.max(0, end - w), out = [];
    var floor = RISE_FLOOR[metric] || 0;
    GCHAN.filter(genreVisible).forEach(function (c) {
      var arr = c[metric] || [], a = null, b = null, cnt = 0;
      for (var i = start; i <= end; i++) {
        if (arr[i] != null) { if (a === null) a = arr[i]; b = arr[i]; cnt++; }
      }
      if (cnt < 2 || a == null || a <= 0 || a < floor) return;   // 2点未満/母数が小さすぎるものは除外
      out.push({ name: c.name, color: c.color, delta: (b - a) / a * 100, abs: b - a });
    });
    out.sort(function (p, q) { return q.delta - p.delta; });
    return out;
  }
  function setRiseCol(col, x, rank, L) {
    var bar = col.querySelector('.gbar'), val = col.querySelector('.gval'), head = col.querySelector('.ghead');
    var dir = x.delta > 0 ? 'up' : (x.delta < 0 ? 'down' : 'flat');
    var barPx = dir === 'flat' ? 0 : Math.abs(x.delta) * L.perPx;
    var sign = x.delta > 0 ? '+' : (x.delta < 0 ? '−' : '±');
    bar.className = 'gbar ' + (dir === 'down' ? 'down' : 'up');
    head.className = 'ghead ' + (dir === 'down' ? 'down' : 'up');
    if (dir === 'down') { bar.style.top = L.baseFromTop + 'px'; bar.style.bottom = ''; }
    else { bar.style.bottom = L.baseFromBottom + 'px'; bar.style.top = ''; }
    bar.style.transitionDelay = '0s';
    bar.style.height = barPx + 'px';
    val.className = 'gval ' + dir;
    val.textContent = sign + Math.abs(x.delta).toFixed(1) + '%';
    if (dir === 'down') { val.style.top = (L.baseFromTop + barPx + 6) + 'px'; val.style.bottom = ''; }
    else { val.style.bottom = (L.baseFromBottom + barPx + 6) + 'px'; val.style.top = ''; }
    col.querySelector('.grow-crank').textContent = rank;
  }
  function riseRender(animate) {
    var host = document.getElementById('rise-list'); if (!host) return;
    var note = document.getElementById('rising-span');
    var rangeBox = document.getElementById('rise-range');
    var hint = document.getElementById('rise-hint');
    if (GDAYS.length < 2) {
      if (rangeBox) rangeBox.hidden = true;
      if (hint) hint.style.display = 'none';
      if (note) note.textContent = '';
      host.innerHTML = '<div class="grow-empty">急上昇ランキングは履歴が2日分たまると表示されます（明日以降に自動反映）。</div>';
      return;
    }
    if (rangeBox) rangeBox.hidden = false;
    if (hint) hint.style.display = '';
    var list = riseSeries(riseMetric, riseWindow);
    var L = growLayout(list, riseZoom);
    var end = GDAYS.length - 1, wr = Math.max(1, Math.round(riseWindow)), start = Math.max(0, end - wr);
    if (note) note.textContent = '過去' + (end - start) + '日間（' + shortDate(GDAYS[start]) + '→' + shortDate(GDAYS[end]) + '）の増加率';
    host.style.gap = Math.round(12 * riseZoom) + 'px';
    var colBasis = Math.round(46 * riseZoom), colMax = Math.round(66 * riseZoom);

    var oldLeft = {}, existing = {};
    [].forEach.call(host.children, function (c) {
      if (c.dataset && c.dataset.key != null) { oldLeft[c.dataset.key] = c.getBoundingClientRect().left; existing[c.dataset.key] = c; }
    });
    var used = {}, fresh = [];
    list.forEach(function (x, i) {
      var col = existing[x.name];
      if (!col) { col = makeGrowCol(x.name); col.classList.add('rise'); fresh.push(col); }
      col.style.flex = '1 0 ' + colBasis + 'px'; col.style.maxWidth = colMax + 'px';
      col.querySelector('.grow-plot').style.height = L.H + 'px';
      col.querySelector('.gbaseline').style.bottom = L.baseFromBottom + 'px';
      col.querySelector('.grow-cname').textContent = x.name;
      col.dataset.slug = SLUG_BY_NAME[x.name] || '';
      setRiseCol(col, x, i + 1, L);
      host.appendChild(col);
      used[x.name] = true;
    });
    [].slice.call(host.children).forEach(function (c) {
      if (c.dataset && c.dataset.key != null && !used[c.dataset.key]) c.remove();
    });
    fresh.forEach(function (c, k) {
      var bar = c.querySelector('.gbar'), h = bar.style.height;
      bar.style.height = '0px'; bar.offsetHeight;
      bar.style.transitionDelay = animate ? (Math.min(k, 30) * 0.015) + 's' : '0s';
      bar.style.height = h;
    });
    if (animate) {
      [].forEach.call(host.children, function (c) {
        var key = c.dataset.key; if (oldLeft[key] == null) return;
        var dx = oldLeft[key] - c.getBoundingClientRect().left;
        if (dx) {
          c.style.transition = 'none'; c.style.transform = 'translateX(' + dx + 'px)';
          requestAnimationFrame(function () { c.style.transition = 'transform .55s cubic-bezier(.22,1,.36,1)'; c.style.transform = ''; });
        }
      });
    }
  }
  function playRise() {
    var tog = document.getElementById('rising-toggle'), on = tog && tog.querySelector('.tg.on');
    var rind = document.getElementById('rtg-ind');
    if (on && rind) { rind.style.left = on.offsetLeft + 'px'; rind.style.width = on.offsetWidth + 'px'; }
    riseRender(true);
  }
  function setupRiseSlider() {
    var s = document.getElementById('rise-slider'); if (!s) return;
    var maxW = Math.max(1, GDAYS.length - 1);
    s.min = 1; s.max = maxW; s.step = 'any';
    if (riseWindow > maxW) riseWindow = maxW;
    s.value = riseWindow;
    var lab = document.getElementById('rise-range-val');
    var lastW = Math.max(1, Math.round(riseWindow));
    if (lab) lab.textContent = lastW + '日';
    var raf = null;
    s.addEventListener('input', function () {
      riseWindow = parseFloat(s.value) || 1;
      var w = Math.max(1, Math.round(riseWindow));
      if (lab) lab.textContent = w + '日';
      if (w === lastW) return;
      lastW = w;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () { riseRender(true); });
    });
  }
  function setupRiseZoom() {
    var out = document.getElementById('rz-out'), inn = document.getElementById('rz-in'), val = document.getElementById('rz-val');
    function upd() { if (val) val.textContent = Math.round(riseZoom * 100) + '%'; riseRender(true); }
    if (out) out.addEventListener('click', function () { riseZoom = Math.max(0.5, Math.round((riseZoom - 0.25) * 100) / 100); upd(); });
    if (inn) inn.addEventListener('click', function () { riseZoom = Math.min(2, Math.round((riseZoom + 0.25) * 100) / 100); upd(); });
  }
  function setupRise() {
    var rtabs = [].slice.call(document.querySelectorAll('#rising-toggle .tg'));
    rtabs.forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.gm === riseMetric) return;
        riseMetric = b.dataset.gm;
        rtabs.forEach(function (x) { x.classList.toggle('on', x === b); });
        playRise();     // playRise がオレンジインジケータ(#rtg-ind)を移動＋再描画
      });
    });
  }
  // ダッシュボード: 今日の急上昇 TOP5(登録者の伸び率)。棒タブへの入口＋個別ページへ流す
  function renderDashRise() {
    var host = document.getElementById('dash-rise-list'), sec = document.getElementById('dash-rise');
    if (!host || !sec) return;
    var pos = function (x) { return x.delta > 0; };
    var list = riseSeries('subs', 1).filter(pos);                       // まず「今日(1日)」
    if (list.length < 5) list = riseSeries('subs', Math.min(7, Math.max(1, GDAYS.length - 1))).filter(pos);
    list = list.slice(0, 5);
    if (!list.length) { sec.hidden = true; return; }
    sec.hidden = false;
    host.innerHTML = list.map(function (x, i) {
      var slug = SLUG_BY_NAME[x.name] || '', av = AV_BY_NAME[x.name] || '';
      return '<a class="dr-item" href="' + GBASE + 'c/' + encodeURIComponent(slug) + '/">' +
        '<span class="dr-rank num">' + (i + 1) + '</span>' +
        (av ? '<img class="dr-av" loading="lazy" width="38" height="38" src="' + esc(avSize(av, 88)) + '" alt="" onerror="this.style.visibility=\'hidden\'">' : '<span class="dr-av"></span>') +
        '<span class="dr-name">' + esc(x.name) + '</span>' +
        '<span class="dr-rate num">+' + x.delta.toFixed(1) + '%</span></a>';
    }).join('');
  }
  // ダッシュボード: 掲示板の新着スレッド(公開中のみ表示)。掲示板への入口
  function openBoardThread(id) {
    history.pushState({ view: 'board' }, '', pathOf('board') + '?t=' + id);
    switchTab('board', true);
  }
  function renderDashBoard() {
    var sec = document.getElementById('dash-board'), host = document.getElementById('dash-board-list');
    if (!sec || !host) return;
    if (boardMaint || !boardEnabled || !BOARD_API) { sec.hidden = true; return; }   // 整備中は新着欄も隠す
    fetch(boardApi('/threads'), { headers: boardHeaders() }).then(function (r) { return r.json(); }).then(function (d) {
      var ths = (d.threads || []).slice(0, 5);
      if (!ths.length) { sec.hidden = true; return; }
      sec.hidden = false;
      host.innerHTML = ths.map(function (t) {
        return '<a class="db-item" data-id="' + t.id + '" href="' + pathOf('board') + '?t=' + t.id + '">' +
          '<span class="db-title">' + esc(t.title) + '</span>' +
          '<span class="db-meta"><span class="num">' + t.posts + '</span> レス ・ ' + bWhen(t.bumped) + '</span></a>';
      }).join('');
      host.querySelectorAll('.db-item').forEach(function (el) {
        el.addEventListener('click', function (e) { e.preventDefault(); openBoardThread(+el.dataset.id); });
      });
    }).catch(function () { sec.hidden = true; });
  }

  /* ---- news (milestones over the last 7 days) ---- */
  function renderNews() {
    var wrap = document.getElementById('news-list');
    if (!wrap) return;
    var NEWS = window.PBERS_NEWS || [];
    wrap.innerHTML = '';
    NEWS.forEach(function (day) {
      var el = document.createElement('div');
      el.className = 'news-day';
      var dayItems = (day.items || []).filter(genreVisible);
      var items = dayItems.length
        ? dayItems.map(function (n) {
            return '<div class="news-item">' +
              (n.icon ? '<span class="ico">' + n.icon + '</span>' : '<span class="dot" style="background:' + n.color + '"></span>') +
              '<span class="ml"><span class="nm" style="color:' + n.color + '">' + esc(n.name) + '</span> が ' + esc(n.label) + '</span>' +
            '</div>';
          }).join('')
        : '<span class="news-none">特になし</span>';
      el.innerHTML = '<div class="news-date">' + esc(day.label) + '</div><div class="news-items">' + items + '</div>';
      wrap.appendChild(el);
    });
  }

  /* ---- 掲示板(board): スレッド + レス形式 ---- */
  var boardThreadId = null;
  var TS_KEY = window.PBERS_TURNSTILE_SITEKEY || '';   // Turnstileサイトキー(公開・任意)
  function boardName() { try { return localStorage.getItem('pbers_board_name') || ''; } catch (e) { return ''; } }
  function saveBoardName(v) { try { localStorage.setItem('pbers_board_name', v == null ? '' : v); } catch (e) {} }
  function boardSort() { try { var v = localStorage.getItem('pbers_board_sort'); return (v === 'new' || v === 'posts') ? v : 'bump'; } catch (e) { return 'bump'; } }
  function saveBoardSort(v) { try { localStorage.setItem('pbers_board_sort', v); } catch (e) {} }
  // 自己削除キー: 投稿した端末だけが自分のレスを消せるよう、サーバ発行のキーを端末に保存
  function delKeys() { try { return JSON.parse(localStorage.getItem('pbers_delkeys') || '{}'); } catch (e) { return {}; } }
  function saveDelKey(thread, no, token) { if (!token) return; try { var m = delKeys(); m[thread + ':' + no] = token; localStorage.setItem('pbers_delkeys', JSON.stringify(m)); } catch (e) {} }
  function delKeyOf(thread, no) { return delKeys()[thread + ':' + no] || ''; }
  // Turnstileは「公開中」かつ「非管理者」の時だけ出す(管理者はサーバ側で免除)
  function tsNeeded() { return !!TS_KEY && boardPublic && !boardKey; }
  function tsLoad() {
    if (!tsNeeded() || document.getElementById('cf-ts-api')) return;
    var s = document.createElement('script'); s.id = 'cf-ts-api';
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true; s.defer = true;
    document.head.appendChild(s);
  }
  function tsMount(form) {
    if (!tsNeeded()) return { get: function () { return ''; }, reset: function () {} };
    var box = document.createElement('div'); box.className = 'ts-box';
    var actions = form.querySelector('.bf-actions'); form.insertBefore(box, actions);
    var wid = null;
    (function go() { if (window.turnstile) { try { wid = window.turnstile.render(box, { sitekey: TS_KEY, theme: 'dark' }); } catch (e) {} } else setTimeout(go, 250); })();
    return {
      get: function () { try { return (window.turnstile && wid != null) ? window.turnstile.getResponse(wid) : ''; } catch (e) { return ''; } },
      reset: function () { try { if (window.turnstile && wid != null) window.turnstile.reset(wid); } catch (e) {} }
    };
  }
  function boardErr(code) {
    return ({ too_fast: '投稿の間隔があいていません（少し待ってね）', captcha: '認証に失敗しました',
      private: '現在は非公開です', db_unconfigured: '掲示板は準備中です', empty: '本文を入力してください',
      no_title: 'タイトルを入力してください', not_found: 'スレッドが見つかりません', forbidden: '権限がありません',
      voted: 'すでに投票済みです', closed: 'このアンケートは終了しました', no_poll: 'アンケートが見つかりません',
      no_choice: '選択してください', single_only: '1つだけ選択してください' })[code]
      || '通信エラーが発生しました';
  }
  function boardHeaders(extra) { var h = extra || {}; if (boardKey) h['X-Board-Key'] = boardKey; return h; }
  function boardApi(p) { return BOARD_API + p; }
  function bWhen(ms) {
    var t = new Date(ms), p2 = function (x) { return (x < 10 ? '0' : '') + x; };
    return (t.getMonth() + 1) + '/' + t.getDate() + ' ' + p2(t.getHours()) + ':' + p2(t.getMinutes());
  }
  function boardHead() {
    var note = document.getElementById('board-note'), status = document.getElementById('board-status');
    if (note) note.textContent = boardPublic
      ? '誰でもスレッドを立てて書き込めます。荒らし・誹謗中傷・個人情報・宣伝はご遠慮ください。'
      : '非公開モード（管理者のみ表示・投稿）。公開すると誰でも書き込めます。';
    if (status) status.textContent = boardKey ? '管理モード' : '';
  }
  function boardSyncFromUrl() {
    var t = parseInt(new URLSearchParams(location.search).get('t'), 10);
    boardThreadId = t > 0 ? t : null;
  }
  function boardGo(threadId) {   // スレッドを開く/一覧へ戻る(URLに反映=戻る/共有に対応)
    boardThreadId = threadId || null;
    var u = pathOf('board') + (boardThreadId ? '?t=' + boardThreadId : '');
    if (location.pathname + location.search !== u) history.pushState({ view: 'board' }, '', u);
    renderBoard();
  }
  // 自分のスレ/レスに新着返信が付いたら知らせる(匿名なのでlocalStorageで「自分が関わったスレ」を記憶)
  var boardThreadsCache = [];
  function myThreads() { try { return JSON.parse(localStorage.getItem('pbers_my_threads') || '{}'); } catch (e) { return {}; } }
  function saveMyThreads(o) { try { localStorage.setItem('pbers_my_threads', JSON.stringify(o)); } catch (e) {} }
  function markMine(id, seenPosts) { var m = myThreads(); m[id] = { seen: seenPosts }; saveMyThreads(m); }
  function seenThread(id, posts) { var m = myThreads(); if (m[id]) { m[id].seen = posts; saveMyThreads(m); } }   // 閲覧=既読化
  function newFor(id, posts) { var m = myThreads(); return m[id] ? Math.max(0, (posts || 0) - (m[id].seen || 0)) : 0; }
  function countNew(threads) { var t = 0; (threads || []).forEach(function (x) { t += newFor(x.id, x.posts); }); return t; }
  function updateBoardBadge(n) {
    var tab = document.getElementById('tab-board'); if (!tab) return;
    var b = tab.querySelector('.tab-badge');
    if (n > 0) { if (!b) { b = document.createElement('span'); b.className = 'tab-badge'; tab.appendChild(b); } b.textContent = n > 99 ? '99+' : n; }
    else if (b) { b.remove(); }
  }
  function wireHide(scope) {
    scope.querySelectorAll('.bc-hide').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation(); b.disabled = true;
        var payload = b.dataset.k === 'post'
          ? { kind: 'post', thread: +b.dataset.t, no: +b.dataset.no, hide: b.dataset.h === '1' }
          : { kind: 'thread', id: +b.dataset.id, hide: b.dataset.h === '1' };
        fetch(boardApi('/hide'), { method: 'POST', headers: boardHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload) })
          .then(function (r) { return r.json(); }).then(function (d) { if (d.ok) renderBoard(); else b.disabled = false; })
          .catch(function () { b.disabled = false; });
      });
    });
  }
  function renderBoard() {
    var host = document.getElementById('board-body'); if (!host) return;
    if (boardMaint) {   // 整備中: APIを叩かず案内のみ
      var note = document.getElementById('board-note'), status = document.getElementById('board-status');
      if (note) note.textContent = ''; if (status) status.textContent = '';
      host.innerHTML = '<div class="board-maint"><div class="board-maint-ico">🛠</div>' +
        '<div class="board-maint-h">掲示板は整備中です</div>' +
        '<div class="board-maint-p">より使いやすくするため一時的に停止しています。もうしばらくお待ちください。</div></div>';
      return;
    }
    boardHead();
    if (!boardEnabled) { host.innerHTML = '<div class="board-empty">準備中です。</div>'; return; }
    boardSyncFromUrl();
    if (boardThreadId) renderThread(host, boardThreadId); else renderThreadList(host);
  }
  function renderThreadList(host) {
    host.innerHTML =
      '<form class="bt-new" id="bt-new" autocomplete="off">' +
        '<div class="bt-new-h">スレッドを立てる</div>' +
        '<input class="bf-in" id="bt-title" maxlength="60" placeholder="タイトル（60字まで）">' +
        '<input class="bf-in bf-name" id="bt-name" maxlength="24" placeholder="名前（任意）">' +
        '<textarea class="bf-in bf-body" id="bt-body" maxlength="2000" rows="3" placeholder="最初の書き込み…"></textarea>' +
        '<button type="button" class="bt-poll-toggle" id="bt-poll-toggle">＋ アンケートを作成</button>' +
        '<div class="bt-poll" id="bt-poll" hidden>' +
          '<input class="bf-in" id="bp-q" maxlength="140" placeholder="質問（例：一番好きなPBerは？）">' +
          '<div id="bp-opts">' +
            '<input class="bf-in bp-opt" maxlength="60" placeholder="選択肢1">' +
            '<input class="bf-in bp-opt" maxlength="60" placeholder="選択肢2">' +
          '</div>' +
          '<button type="button" class="bp-add" id="bp-add">＋ 選択肢を追加</button>' +
          '<div class="bp-opts-row">' +
            '<label class="bp-check"><input type="checkbox" id="bp-multi"> 複数回答を許可</label>' +
            '<label class="bp-check"><input type="checkbox" id="bp-hide"> 投票するまで結果を隠す</label>' +
          '</div>' +
          '<label class="bp-days">期間 <select id="bp-days">' +
            [1,2,3,5,7].map(function(n){return '<option value="'+n+'"'+(n===7?' selected':'')+'>'+n+'日</option>';}).join('') +
          '</select></label>' +
        '</div>' +
        '<div class="bf-actions"><span class="bf-msg" id="bt-msg"></span>' +
          '<button type="submit" class="bf-send" id="bt-send">スレッドを作成</button></div>' +
      '</form>' +
      '<div class="bd-search-wrap"><input class="bf-in bd-search" id="bd-search" maxlength="100" placeholder="🔍 スレ・書き込みを検索">' +
        '<button type="button" class="bd-sclear" id="bd-sclear" aria-label="クリア" hidden>×</button></div>' +
      '<div class="bd-sort" id="bd-sort" role="tablist">' +
        '<button type="button" class="bd-sort-b" data-sort="bump">最終レス順</button>' +
        '<button type="button" class="bd-sort-b" data-sort="new">新着順</button>' +
        '<button type="button" class="bd-sort-b" data-sort="posts">レス数順</button>' +
      '</div>' +
      (boardKey ? '<div class="bd-admin"><button type="button" class="bd-stats-btn" id="bd-stats-btn">📊 書き込み統計（管理者）</button><div class="bd-stats" id="bd-stats" hidden></div></div>' : '') +
      '<div class="board-list" id="board-threads"><div class="board-empty">読み込み中…</div></div>';
    document.getElementById('bt-name').value = boardName();
    var tsNew = tsMount(document.getElementById('bt-new'));
    // アンケート入力欄: 開閉・選択肢の追加(最大10)
    var pollWrap = document.getElementById('bt-poll'), pollToggle = document.getElementById('bt-poll-toggle');
    pollToggle.addEventListener('click', function () {
      pollWrap.hidden = !pollWrap.hidden;
      pollToggle.textContent = pollWrap.hidden ? '＋ アンケートを作成' : '－ アンケートを閉じる';
    });
    document.getElementById('bp-add').addEventListener('click', function () {
      var opts = document.getElementById('bp-opts'), n = opts.querySelectorAll('.bp-opt').length;
      if (n >= 10) { this.disabled = true; return; }
      var inp = document.createElement('input');
      inp.className = 'bf-in bp-opt'; inp.maxLength = 60; inp.placeholder = '選択肢' + (n + 1);
      opts.appendChild(inp); inp.focus();
      if (n + 1 >= 10) this.disabled = true;
    });
    function collectPoll() {   // 入力があれば poll オブジェクトを返す。無効なら null
      if (pollWrap.hidden) return null;
      var q = document.getElementById('bp-q').value.trim();
      var options = [].slice.call(pollWrap.querySelectorAll('.bp-opt'))
        .map(function (i) { return i.value.trim(); }).filter(Boolean).slice(0, 10);
      if (!q || options.length < 2) return null;
      return { question: q, options: options,
        multi: document.getElementById('bp-multi').checked,
        hide: document.getElementById('bp-hide').checked,
        days: parseInt(document.getElementById('bp-days').value, 10) || 7 };
    }
    document.getElementById('bt-new').addEventListener('submit', function (e) {
      e.preventDefault();
      var title = document.getElementById('bt-title').value.trim();
      var body = document.getElementById('bt-body').value.trim();
      var name = document.getElementById('bt-name').value;
      var msg = document.getElementById('bt-msg'), send = document.getElementById('bt-send');
      if (!title) { msg.textContent = 'タイトルを入力してください'; return; }
      if (!body) { msg.textContent = '本文を入力してください'; return; }
      var poll = collectPoll();
      if (!pollWrap.hidden && !poll) { msg.textContent = 'アンケートは質問と選択肢2つ以上が必要です'; return; }
      send.disabled = true; msg.textContent = '作成中…';
      var payload = { title: title, name: name, body: body, token: tsNew.get() };
      if (poll) payload.poll = poll;
      fetch(boardApi('/threads'), { method: 'POST', headers: boardHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload) })
        .then(function (r) { return r.json(); }).then(function (d) {
          send.disabled = false; tsNew.reset();
          if (d.ok) { saveBoardName(name); markMine(d.id, 1); saveDelKey(d.id, 1, d.del); boardGo(d.id); } else msg.textContent = boardErr(d.error);
        }).catch(function () { send.disabled = false; tsNew.reset(); msg.textContent = '送信に失敗しました'; });
    });
    var box = document.getElementById('board-threads');
    function paint(ths, isSearch, q) {
      if (!isSearch) { boardThreadsCache = ths; updateBoardBadge(countNew(ths)); }
      if (!ths.length) {
        box.innerHTML = '<div class="board-empty">' + (isSearch ? '「' + esc(q) + '」に一致するスレッドはありません。' : 'まだスレッドがありません。最初のスレッドを立ててみよう。') + '</div>';
        return;
      }
      var head = isSearch ? '<div class="bd-sresult">「' + esc(q) + '」の結果 ' + ths.length + '件</div>' : '';
      box.innerHTML = head + ths.map(function (t) {
        var nn = newFor(t.id, t.posts);
        var sn = (isSearch && t.snippet) ? '<div class="th-snip">' + esc(String(t.snippet).slice(0, 80)) + (String(t.snippet).length > 80 ? '…' : '') + '</div>' : '';
        return '<div class="th' + (t.hidden ? ' bc-off' : '') + '" data-id="' + t.id + '">' +
          '<div class="th-main"><div class="th-title">' + esc(t.title) +
            (t.admin ? ' <span class="th-badge">★管理人</span>' : '') +
            (nn > 0 ? ' <span class="th-new">新着' + nn + '</span>' : '') + '</div>' + sn +
            '<div class="th-meta"><span class="num">' + t.posts + '</span> レス ・ ' +
              (!isSearch && curSort === 'new' ? '作成 ' + bWhen(t.created) : '最終 ' + bWhen(t.bumped)) + '</div></div>' +
          (boardKey ? '<button type="button" class="bc-hide" data-k="thread" data-id="' + t.id + '" data-h="' + (t.hidden ? 0 : 1) + '">' + (t.hidden ? '表示' : '非表示') + '</button>' : '') +
        '</div>';
      }).join('');
      box.querySelectorAll('.th').forEach(function (el) {
        el.querySelector('.th-main').addEventListener('click', function () { boardGo(+el.dataset.id); });
      });
      if (boardKey) wireHide(box);
    }
    var sortBar = document.getElementById('bd-sort');
    var curSort = boardSort();
    function markSort() {
      sortBar.querySelectorAll('.bd-sort-b').forEach(function (b) { b.classList.toggle('on', b.dataset.sort === curSort); });
    }
    function loadAll() {
      box.innerHTML = '<div class="board-empty">読み込み中…</div>';
      var q = curSort && curSort !== 'bump' ? '?sort=' + encodeURIComponent(curSort) : '';
      fetch(boardApi('/threads') + q, { headers: boardHeaders() }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.error) { box.innerHTML = '<div class="board-empty">' + esc(boardErr(d.error)) + '</div>'; return; }
        paint(d.threads || [], false);
      }).catch(function () { box.innerHTML = '<div class="board-empty">読み込みに失敗しました。</div>'; });
    }
    markSort();
    sortBar.addEventListener('click', function (e) {
      var b = e.target.closest('.bd-sort-b'); if (!b || b.dataset.sort === curSort) return;
      curSort = b.dataset.sort; saveBoardSort(curSort); markSort(); loadAll();
    });
    // 管理者専用: 書き込み統計(24h/3日/7日, ip_hash別=同一人物の寡占チェック)
    var statsBtn = document.getElementById('bd-stats-btn');
    if (statsBtn) statsBtn.addEventListener('click', function () {
      var panel = document.getElementById('bd-stats');
      if (!panel.hidden) { panel.hidden = true; return; }   // トグル
      panel.hidden = false; panel.innerHTML = '<div class="board-empty">集計中…</div>';
      fetch(boardApi('/stats'), { headers: boardHeaders() }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) { panel.innerHTML = '<div class="board-empty">' + esc(boardErr(d.error)) + '</div>'; return; }
        var T = d.totals, rows = d.rows || [];
        var top7 = rows.length && T.d7 ? Math.round(rows[0].c7 / T.d7 * 100) : 0;
        var head = '<div class="bs-sum">7日 <b>' + T.d7 + '</b>件 / 3日 <b>' + T.d3 + '</b>件 / 24h <b>' + T.h24 + '</b>件 ・ 投稿者(IP) <b>' + d.uniq + '</b>人' +
          (top7 ? ' ・ 最多の1人が7日で <b>' + top7 + '%</b>' : '') + '</div>';
        var body = rows.slice(0, 50).map(function (r, i) {
          var sh = T.d7 ? Math.round(r.c7 / T.d7 * 100) : 0;
          return '<tr' + (sh >= 40 ? ' class="bs-hot"' : '') + '><td class="num">' + (i + 1) + '</td>' +
            '<td class="bs-ip">' + esc(r.ip) + (r.admin ? ' <span class="bs-adm">運営</span>' : '') + '</td>' +
            '<td class="num">' + r.c24 + '</td><td class="num">' + r.c3 + '</td><td class="num">' + r.c7 + '</td>' +
            '<td class="num">' + sh + '%</td>' +
            '<td class="bs-uids">' + r.uids.slice(0, 6).map(esc).join(' ') + (r.uids.length > 6 ? ' +' + (r.uids.length - 6) : '') + '</td></tr>';
        }).join('');
        panel.innerHTML = head +
          '<div class="bs-tablewrap"><table class="bs-table"><thead><tr><th>#</th><th>ID(IP)</th><th>24h</th><th>3日</th><th>7日</th><th>7日比</th><th>使用ID(uid)</th></tr></thead><tbody>' +
          body + '</tbody></table></div>' +
          '<div class="bs-note">※ IP由来のハッシュで同一人物を推定（日替りIDは別集計）。40%以上は色付き。</div>';
      }).catch(function () { panel.innerHTML = '<div class="board-empty">通信に失敗しました。</div>'; });
    });
    function doSearch(q) {
      box.innerHTML = '<div class="board-empty">検索中…</div>';
      fetch(boardApi('/search') + '?q=' + encodeURIComponent(q), { headers: boardHeaders() }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.error) { box.innerHTML = '<div class="board-empty">' + esc(boardErr(d.error)) + '</div>'; return; }
        paint(d.threads || [], true, q);
      }).catch(function () { box.innerHTML = '<div class="board-empty">検索に失敗しました。</div>'; });
    }
    var si = document.getElementById('bd-search'), sc = document.getElementById('bd-sclear'), sTimer = null;
    si.addEventListener('input', function () {
      var q = si.value.trim(); sc.hidden = !q; sortBar.hidden = !!q;   // 検索中は並び替えを隠す
      clearTimeout(sTimer); sTimer = setTimeout(function () { if (q) doSearch(q); else loadAll(); }, 300);
    });
    sc.addEventListener('click', function () { si.value = ''; sc.hidden = true; sortBar.hidden = false; loadAll(); si.focus(); });
    loadAll();
  }
  // 本文中の >>N (全角＞＞も) をアンカーリンク化。esc後の文字列に対して掛ける(> は &gt; になっている)
  function linkAnchors(s) {
    return s.replace(/(?:&gt;&gt;|＞＞)(\d+)/g, function (m, n) {
      return '<a class="anchor" data-no="' + n + '">&gt;&gt;' + n + '</a>';
    });
  }
  // 本文中の http(s):// URL を新規タブで開くリンクに変換する。
  // esc() 済みの文字列に掛ける前提(< が無いので [^\s<] で URL 端を判定)。
  // 末尾の句読点・閉じ括弧はリンクから除外する。ユーザー投稿なので rel に nofollow/noopener を付与。
  function linkUrls(s) {
    // URLに使える文字だけを食う(日本語や空白で止まる)。&amp; 等の実体参照は & や ; がクラス内なので拾える。
    return s.replace(/https?:\/\/[\w\-.~:/?#\[\]@!$&'()*+,;=%]+/gi, function (u) {
      // 末尾の句読点・閉じ括弧・実体参照(&gt;等)はリンクから除外する
      var tail = '', m = u.match(/(?:&gt;|&lt;|&quot;|&amp;|[)\]}.,!?;:'"]+)+$/);
      if (m) { tail = u.slice(u.length - m[0].length); u = u.slice(0, u.length - m[0].length); }
      if (!u) return tail;
      return '<a class="post-link" href="' + u + '" target="_blank" rel="noopener noreferrer nofollow">' + u + '</a>' + tail;
    });
  }
  function jumpToPost(no) {
    var el = document.getElementById('post-' + no); if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('post-hl'); void el.offsetWidth; el.classList.add('post-hl');   // 再クリックでも光る
  }
  // 本文からYouTubeの動画IDを抽出(最大3件)。ID(11文字)は英数-_のみなので埋め込みは安全
  function ytIds(text) {
    var ids = [], seen = {}, m;
    var re = /(?:youtube\.com\/(?:watch\?(?:[^\s"']*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/g;
    while ((m = re.exec(text)) && ids.length < 3) { if (!seen[m[1]]) { seen[m[1]] = 1; ids.push(m[1]); } }
    return ids;
  }
  // Discord風: サムネ+再生ボタン。クリックで初めてiframe読込(=軽い) / nocookieでプライバシー配慮
  function ytEmbeds(body) {
    var ids = ytIds(String(body || '')); if (!ids.length) return '';
    return '<div class="yt-embeds">' + ids.map(function (id) {
      return '<div class="yt-lite" data-id="' + id + '" style="background-image:url(https://i.ytimg.com/vi/' + id + '/hqdefault.jpg)">' +
        '<button type="button" class="yt-play" aria-label="再生"></button></div>';
    }).join('') + '</div>';
  }
  function pollRemain(closes) {   // 残り時間の短い表記
    var ms = closes - Date.now(); if (ms <= 0) return '';
    var d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
    if (d >= 1) return 'あと' + d + '日' + (h ? h + '時間' : '');
    if (h >= 1) return 'あと' + h + '時間';
    return 'まもなく終了';
  }
  // アンケート表示。canVote時は選択UI+投票ボタン、そうでなければ結果バー。合計投票数は常に表示。
  function pollHtml(poll) {
    if (!poll) return '';
    var opts = poll.options || [], total = poll.votes || 0;
    var canVote = !poll.voted && !poll.closed, showRes = poll.counts != null;
    var rows = opts.map(function (o, i) {
      var mine = poll.myChoices && poll.myChoices.indexOf(i) !== -1;
      var c = showRes ? ((poll.counts && poll.counts[i]) || 0) : 0;
      var pct = (showRes && total > 0) ? Math.round(c / total * 100) : 0;
      if (canVote) {
        return '<label class="poll-opt"><input type="' + (poll.multi ? 'checkbox' : 'radio') + '" name="poll-c" value="' + i + '">' +
          '<span class="poll-opt-t">' + esc(o) + '</span>' +
          (showRes ? '<span class="poll-opt-n num">' + c + '票 ' + pct + '%</span>' : '') + '</label>';
      }
      return '<div class="poll-res' + (mine ? ' mine' : '') + '">' +
        '<div class="poll-res-top"><span class="poll-opt-t">' + esc(o) + (mine ? ' ✓' : '') + '</span>' +
        '<span class="poll-res-n num">' + c + '票 (' + pct + '%)</span></div>' +
        '<div class="poll-bar"><span style="width:' + pct + '%"></span></div></div>';
    }).join('');
    var status = poll.closed ? '終了しました' : pollRemain(poll.closes);
    var foot = '<div class="poll-foot">' +
      (canVote ? '<button type="button" class="poll-vote" id="poll-vote">投票する</button>'
               : '<span class="poll-done">' + (poll.voted ? '✓ 投票済み' : '') + '</span>') +
      '<span class="poll-total num">計 ' + total + '票' + (status ? ' ・ ' + status : '') + '</span></div>';
    var note = (canVote && !showRes) ? '<div class="poll-note">投票すると結果が表示されます' + (poll.multi ? '（複数選択可）' : '') + '</div>'
             : (canVote && poll.multi ? '<div class="poll-note">複数選択できます</div>' : '');
    return '<div class="poll" id="poll" data-multi="' + (poll.multi ? 1 : 0) + '">' +
      '<div class="poll-q">📊 ' + esc(poll.question) + '</div>' +
      '<div class="poll-opts">' + rows + '</div>' + note + foot + '</div>';
  }
  function renderThread(host, id) {
    host.innerHTML = '<div class="board-empty">読み込み中…</div>';
    var back = function () {
      host.querySelectorAll('.th-back').forEach(function (b) { b.addEventListener('click', function () { boardGo(null); }); });
    };
    fetch(boardApi('/thread') + '?id=' + id, { headers: boardHeaders() }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.error) { host.innerHTML = '<button class="th-back">← スレ一覧</button><div class="board-empty">' + esc(boardErr(d.error)) + '</div>'; back(); return; }
      var posts = d.posts || [];
      seenThread(id, d.thread.posts);                         // 閲覧=このスレは既読に
      updateBoardBadge(countNew(boardThreadsCache));          // タブの新着バッジを更新
      host.innerHTML = '<button class="th-back">← スレ一覧</button>' +
        '<h3 class="th-h">' + esc(d.thread.title) + '</h3>' +
        pollHtml(d.poll) +
        '<div class="posts">' + posts.map(function (p) {
          var del = !p.body;                                   // 本文が空=削除済み
          var canDel = !del && !!delKeyOf(id, p.no);           // 自分の投稿(削除キーを持っている)なら削除可
          return '<div class="post' + (p.hidden ? ' bc-off' : '') + (p.admin ? ' post-adm' : '') + (del ? ' post-del' : '') + '" id="post-' + p.no + '">' +
            '<div class="post-head"><span class="post-no num">' + p.no + '</span>' +
              '<span class="post-name">' + esc(p.name) + '</span>' +
              (p.admin ? '<span class="post-badge">★管理人</span>' : '') +
              (p.uid ? '<span class="post-id num">ID:' + esc(p.uid) + '</span>' : '') +
              '<span class="post-time num">' + bWhen(p.created) + '</span>' +
              (del ? '' : '<button type="button" class="post-re" data-no="' + p.no + '">返信</button>') +
              (canDel ? '<button type="button" class="post-del-btn" data-no="' + p.no + '">削除</button>' : '') +
              (boardKey ? '<button type="button" class="bc-hide" data-k="post" data-t="' + id + '" data-no="' + p.no + '" data-h="' + (p.hidden ? 0 : 1) + '">' + (p.hidden ? '表示' : '非表示') + '</button>' : '') +
            '</div>' +
            (del ? '<div class="post-body post-del-body">削除されました</div>'
                 : '<div class="post-body">' + linkAnchors(linkUrls(esc(p.body))).replace(/\n/g, '<br>') + '</div>' +
                   ytEmbeds(p.body) + postMentions(p.body)) +
          '</div>';
        }).join('') + '</div>' +
        '<form class="bt-reply" id="bt-reply" autocomplete="off">' +
          '<input class="bf-in bf-name" id="rp-name" maxlength="24" placeholder="名前（任意）">' +
          '<textarea class="bf-in bf-body" id="rp-body" maxlength="2000" rows="3" placeholder="返信を書く…"></textarea>' +
          '<div class="bf-actions"><span class="bf-msg" id="rp-msg"></span>' +
            '<button type="submit" class="bf-send" id="rp-send">返信する</button></div>' +
        '</form>';
      back();
      if (d.admin) wireHide(host);
      host.querySelectorAll('.anchor').forEach(function (a) {
        a.addEventListener('click', function () { jumpToPost(a.dataset.no); });
      });
      host.querySelectorAll('.post-re').forEach(function (b) {   // 「返信」で >>N を返信欄に挿入
        b.addEventListener('click', function () {
          var rb = document.getElementById('rp-body'), cur = rb.value;
          rb.value = (cur && !/\n$/.test(cur) ? cur + '\n' : cur) + '>>' + b.dataset.no + '\n';
          document.getElementById('bt-reply').scrollIntoView({ block: 'center' });
          rb.focus();
        });
      });
      host.querySelectorAll('.post-del-btn').forEach(function (b) {   // 自分のレスの本文を削除(番号は残る)
        b.addEventListener('click', function () {
          var no = +b.dataset.no, token = delKeyOf(id, no);
          if (!token) return;
          if (!confirm('このレスの本文を削除しますか？（レス番号は残り、「削除されました」と表示されます。取り消せません）')) return;
          b.disabled = true;
          fetch(boardApi('/delete'), { method: 'POST', headers: boardHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ thread: id, no: no, token: token }) })
            .then(function (r) { return r.json(); }).then(function (dd) {
              if (dd.ok) renderThread(host, id); else { b.disabled = false; alert(boardErr(dd.error)); }
            }).catch(function () { b.disabled = false; alert('通信に失敗しました'); });
        });
      });
      host.querySelectorAll('.yt-lite').forEach(function (el) {   // クリックで初めてiframe読込→その場再生
        el.addEventListener('click', function () {
          var f = document.createElement('iframe');
          f.className = 'yt-frame';
          f.src = 'https://www.youtube-nocookie.com/embed/' + el.dataset.id + '?autoplay=1';
          f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
          f.setAttribute('allowfullscreen', '');
          el.replaceWith(f);
        });
      });
      var voteBtn = document.getElementById('poll-vote');   // アンケート投票
      if (voteBtn) voteBtn.addEventListener('click', function () {
        var checked = [].slice.call(host.querySelectorAll('input[name="poll-c"]:checked')).map(function (i) { return +i.value; });
        if (!checked.length) { voteBtn.textContent = '選択してください'; return; }
        voteBtn.disabled = true; voteBtn.textContent = '送信中…';
        fetch(boardApi('/poll/vote'), { method: 'POST', headers: boardHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ thread: id, choices: checked }) })
          .then(function (r) { return r.json(); }).then(function (d) {
            if (d.ok) { renderThread(host, id); }   // 再描画して結果を表示(投票済み状態に)
            else { voteBtn.disabled = false; voteBtn.textContent = '投票する'; alert(boardErr(d.error)); }
          }).catch(function () { voteBtn.disabled = false; voteBtn.textContent = '投票する'; alert('送信に失敗しました'); });
      });
      document.getElementById('rp-name').value = boardName();
      var tsRep = tsMount(document.getElementById('bt-reply'));
      document.getElementById('bt-reply').addEventListener('submit', function (e) {
        e.preventDefault();
        var body = document.getElementById('rp-body').value.trim();
        var name = document.getElementById('rp-name').value;
        var msg = document.getElementById('rp-msg'), send = document.getElementById('rp-send');
        if (!body) { msg.textContent = '本文を入力してください'; return; }
        send.disabled = true; msg.textContent = '送信中…';
        fetch(boardApi('/posts'), { method: 'POST', headers: boardHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ thread: id, name: name, body: body, token: tsRep.get() }) })
          .then(function (r) { return r.json(); }).then(function (d2) {
            send.disabled = false; tsRep.reset();
            if (d2.ok) { saveBoardName(name); if (!myThreads()[id]) markMine(id, 0); saveDelKey(id, d2.no, d2.del); renderThread(host, id); }   // 返信したスレも自分のスレとして追跡
            else msg.textContent = boardErr(d2.error);
          }).catch(function () { send.disabled = false; tsRep.reset(); msg.textContent = '送信に失敗しました'; });
      });
    }).catch(function () { host.innerHTML = '<button class="th-back">← スレ一覧</button><div class="board-empty">読み込みに失敗しました。</div>'; back(); });
  }
  // テーマ切替(ブラック標準/ホワイト)。headの先読みスクリプトが初期適用済み、ここは切替と表示更新。
  function currentTheme() { try { return localStorage.getItem('pbers_theme') === 'light' ? 'light' : 'dark'; } catch (e) { return 'dark'; } }
  function applyTheme(t) { if (t === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme'); }
  function setupTheme() {
    var btn = document.getElementById('theme-tg'); if (!btn) return;
    function refresh() {
      var t = currentTheme();
      btn.textContent = t === 'light' ? '🌙' : '☀';   // 切替先を示すアイコン
      var label = t === 'light' ? 'ブラックモードに切替' : 'ホワイトモードに切替';
      btn.setAttribute('aria-label', label); btn.title = label;
    }
    refresh();
    btn.addEventListener('click', function () {
      var t = currentTheme() === 'light' ? 'dark' : 'light';
      try { localStorage.setItem('pbers_theme', t); } catch (e) {}
      applyTheme(t); refresh();
    });
  }
  function setupBoard() {
    if (!VIEWS.board || GBASE !== '/') return;   // 海外版では無効
    if (boardMaint) {   // 整備中: タブは出す(クリックで案内表示)がAPIは一切叩かない
      boardEnabled = true;
      var tb = document.getElementById('tab-board'); if (tb) tb.hidden = false;
      window.addEventListener('popstate', function () { if (currentView === 'board' && viewOf() === 'board') renderBoard(); });
      if (viewOf() === 'board' && currentView !== 'board') switchTab('board', true);
      return;
    }
    if (!BOARD_API) return;   // API未設定では無効
    try {   // ?boardkey=... で管理解錠。localStorageに保存しURLからは消す
      var q = new URLSearchParams(location.search);
      if (q.get('boardkey')) {
        localStorage.setItem('pbers_board_key', q.get('boardkey'));
        q.delete('boardkey');
        history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q.toString() : '') + location.hash);
      }
      boardKey = localStorage.getItem('pbers_board_key') || '';
    } catch (e) { boardKey = ''; }
    var tabBtn = document.getElementById('tab-board');
    boardEnabled = !!boardKey;                          // 管理キー所持なら即有効(同期)
    if (boardEnabled && tabBtn) tabBtn.hidden = false;
    window.addEventListener('popstate', function () { if (currentView === 'board' && viewOf() === 'board') renderBoard(); });
    fetch(boardApi('/config')).then(function (r) { return r.json(); }).then(function (c) {
      boardPublic = !!(c && c.public);
      boardEnabled = boardPublic || !!boardKey;
      tsLoad();   // 公開・非管理者ならTurnstileスクリプトを読み込む
      if (boardEnabled && tabBtn) tabBtn.hidden = false;
      renderDashBoard();   // 公開中ならダッシュボードに新着スレッドを表示
      // 自分が関わったスレがあれば、読込時に新着返信を背後でチェックしてタブにバッジを出す
      if (boardEnabled && Object.keys(myThreads()).length) {
        fetch(boardApi('/threads'), { headers: boardHeaders() }).then(function (r) { return r.json(); })
          .then(function (d) { boardThreadsCache = d.threads || []; updateBoardBadge(countNew(boardThreadsCache)); }).catch(function () {});
      }
      if (boardEnabled && viewOf() === 'board' && currentView !== 'board') switchTab('board', true);
    }).catch(function () {});
  }

  /* ---- exclude-big filter ---- */
  var fbtn = document.getElementById('filter-big');
  if (fbtn) fbtn.addEventListener('click', function () {
    hideBig = !hideBig;
    fbtn.setAttribute('aria-pressed', hideBig ? 'true' : 'false');
    build();
    replay();
  });

  /* ---- top tabs (dashboard / growth / channels) ---- */
  var VIEWS = {
    dashboard: document.getElementById('view-dashboard'),
    growth:    document.getElementById('view-growth'),
    rising:    document.getElementById('view-rising'),
    news:      document.getElementById('view-news'),
    race:      document.getElementById('view-race'),
    game:      document.getElementById('view-game'),
    videos:    document.getElementById('view-videos'),
    channels:  document.getElementById('view-channels'),
    board:     document.getElementById('view-board')
  };
  var currentView = 'dashboard';
  function pathOf(v) { return v === 'dashboard' ? GBASE : GBASE + v + '/'; }   // dashboard=/ , 他は /growth/ (実体ディレクトリに一致)
  function viewOf() {
    var p = location.pathname;
    if (GBASE !== '/' && p.indexOf(GBASE) === 0) p = p.slice(GBASE.length);   // /global/ を剥がす
    var seg = p.replace(/^\/+|\/+$/g, '');   // '/growth/' -> 'growth'
    if (!seg && location.hash) seg = location.hash.replace(/^#/, '');   // 旧 #growth 形式の共有リンク互換
    if (seg === 'live') seg = 'race';   // 旧名の後方互換
    return VIEWS[seg] ? seg : 'dashboard';
  }
  function switchTab(v, noPush) {
    if (v === 'live') v = 'race';   // 旧リンクの後方互換
    if (!VIEWS[v]) v = 'dashboard';
    if (v === 'board' && !boardEnabled) v = 'dashboard';   // 非公開かつ管理キー無しは掲示板に入れない
    currentView = v;
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x.dataset.view === v); });
    Object.keys(VIEWS).forEach(function (k) { if (VIEWS[k]) VIEWS[k].hidden = (k !== v); });
    if (!noPush && location.pathname !== pathOf(v)) history.pushState({ view: v }, '', pathOf(v));   // 実URLに反映(戻る/共有/計測)
    if (window.pbersTrackView) window.pbersTrackView(pathOf(v));   // タブごとの表示回数を計上
    window.scrollTo(0, 0);
    // タブの見た目切替は上で完了。重い描画(SVG生成等)は「描画後」に回してINP(反応速度)を確保。
    // ダブル requestAnimationFrame = タブ強調＋ビュー切替が一度ペイントされた後に実行される。
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      if (currentView !== v) return;   // 連打時は最後に選ばれたタブだけ描画
      if (v === 'dashboard') { replay(); if (metric === 'predict') enterPredictUI(); }
      else if (v === 'growth') { renderTrend(); playGrowth(); }
      else if (v === 'rising') { playRise(); }
      else if (v === 'news') renderNewsFeed();
      else if (v === 'race') renderRace();
      else if (v === 'game') renderGame();
      else if (v === 'videos') renderVideos();
      else if (v === 'channels') moveTierInd();
      else if (v === 'board') renderBoard();
    }); });
  }
  function setupTabs() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchTab(t.dataset.view); });
    });
    // ダッシュボード内の「詳細を見る →」等、#view へのリンクもタブ遷移に変換
    document.querySelectorAll('a.more-link[href^="#"]').forEach(function (a) {
      var mv = a.getAttribute('href').slice(1);
      if (VIEWS[mv]) a.addEventListener('click', function (e) { e.preventDefault(); switchTab(mv); });
    });
    window.addEventListener('popstate', function () {   // 戻る/進む
      var v = viewOf();
      if (v !== currentView) switchTab(v, true);
    });
    var initial = viewOf();   // 直アクセス/旧ハッシュ共有リンクからの復元
    // URLをクリーンなパスに正規化(#growth → /growth)。掲示板の ?t=<id>(スレ直リンク)は保持する
    history.replaceState({ view: initial }, '', pathOf(initial) + (initial === 'board' ? location.search : ''));
    if (initial !== 'dashboard') switchTab(initial, true);
  }

  /* ---- news feed (animated: 3D milestone bars + crossing overtakes) ---- */
  var NF_OBS = null;
  var MWORD = { subs: '登録者数', views: '総再生数', videos: '投稿数' };
  var ZMAI_JS = { 2: '二枚抜き', 3: '三枚抜き', 4: '四枚抜き', 5: '五枚抜き', 6: '六枚抜き', 7: '七枚抜き', 8: '八枚抜き', 9: '九枚抜き', 10: '十枚抜き' };
  function zmai(n) { return ZMAI_JS[n] || (n + '枚抜き'); }
  // 二枚抜き・三枚抜き専用の演出: heroが下から最上位へ上昇し、被追越を一気に抜く
  function movHTML(n) {
    var opps = n.opps || [], N = opps.length, rowH = 44, gap = 6;
    var rows = '<div class="mov-row hero" style="--t0:' + (N * rowH) + 'px;--t1:0px;height:' + (rowH - gap) + 'px">' +
      '<img src="' + esc(n.avatar) + '" onerror="this.style.visibility=\'hidden\'">' +
      '<span class="rn" style="color:' + n.color + '">' + esc(n.name) + '</span>' +
      '<span class="mov-tag" style="color:' + n.color + '">▲ ' + N + '人抜き</span></div>';
    opps.forEach(function (o, i) {
      rows += '<div class="mov-row" style="--t0:' + (i * rowH) + 'px;--t1:' + ((i + 1) * rowH) + 'px;height:' + (rowH - gap) + 'px">' +
        '<img src="' + esc(o.avatar) + '" onerror="this.style.visibility=\'hidden\'">' +
        '<span class="rn">' + esc(o.name) + '</span></div>';
    });
    return '<div class="mov" style="--c:' + n.color + '">' +
      '<div class="mov-top"><span class="mov-badge">' + zmai(N) + '</span>' +
        '<span class="mov-metric">' + MWORD[n.kind] + '</span></div>' +
      '<div class="mov-stack" style="height:' + (rowH * (N + 1) - gap) + 'px">' + rows + '</div>' +
      '<div class="mov-cap"><b style="color:' + n.color + '">' + esc(n.name) + '</b> が ' + N + 'チャンネルを一気に追い越し</div>' +
    '</div>';
  }
  function shade(hex, amt) {
    var h = (hex || '#888888').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    function f(x) { return Math.max(0, Math.min(255, Math.round(amt >= 0 ? x + (255 - x) * amt : x * (1 + amt)))); }
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }
  function bigNum(kind, v) {
    if (kind === 'subs') return { n: (v / 1e4) + '', u: '万人' };
    if (kind === 'videos') return { n: v + '', u: '本' };
    if (v >= 1e8) return { n: (Math.round(v / 1e8 * 10) / 10) + '', u: '億回' };
    return { n: (v / 1e4) + '', u: '万回' };
  }
  function buildOvChart(el) {
    var W = Math.max(300, el.clientWidth || 620), H = 210, pad = 24, iconR = 24;
    var xL = pad + iconR, xR = W - pad - iconR, yT = pad + iconR, yB = H - pad - iconR;
    var cA = el.dataset.a, cB = el.dataset.b, ai = el.dataset.ai, bi = el.dataset.bi, id = el.dataset.clip;
    function cubic(x0, y0, x1, y1) { var dx = (x1 - x0) * 0.4; return 'M' + x0 + ',' + y0 + ' C' + (x0 + dx) + ',' + y0 + ' ' + (x1 - dx) + ',' + y1 + ' ' + x1 + ',' + y1; }
    var pA = cubic(xL, yB, xR, yT), pB = cubic(xL, yT, xR, yB);
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
      '<defs><clipPath id="ca' + id + '"><circle cx="' + xR + '" cy="' + yT + '" r="' + iconR + '"/></clipPath>' +
      '<clipPath id="cb' + id + '"><circle cx="' + xR + '" cy="' + yB + '" r="' + iconR + '"/></clipPath></defs>' +
      '<path class="ov-line" d="' + pB + '" stroke="' + cB + '"/>' +
      '<path class="ov-line" d="' + pA + '" stroke="' + cA + '"/>' +
      '<image href="' + bi + '" x="' + (xR - iconR) + '" y="' + (yB - iconR) + '" width="' + (iconR * 2) + '" height="' + (iconR * 2) + '" clip-path="url(#cb' + id + ')" preserveAspectRatio="xMidYMid slice"/>' +
      '<circle cx="' + xR + '" cy="' + yB + '" r="' + iconR + '" fill="none" stroke="' + cB + '" stroke-width="3"/>' +
      '<image href="' + ai + '" x="' + (xR - iconR) + '" y="' + (yT - iconR) + '" width="' + (iconR * 2) + '" height="' + (iconR * 2) + '" clip-path="url(#ca' + id + ')" preserveAspectRatio="xMidYMid slice"/>' +
      '<circle cx="' + xR + '" cy="' + yT + '" r="' + iconR + '" fill="none" stroke="' + cA + '" stroke-width="3"/>' +
      '</svg>';
    el.querySelectorAll('.ov-line').forEach(function (p) { var L = p.getTotalLength(); p.style.strokeDasharray = L; p.style.strokeDashoffset = L; });
  }
  /* ================= 予想ゲーム(localStorageで完結・自動採点) ================= */
  var GAME_KEY = 'pbers_game_v1', GAME_DAYS = 7, GAME_DMS = GAME_DAYS * 86400000;
  function gLoad() { try { return JSON.parse(localStorage.getItem(GAME_KEY)) || {}; } catch (e) { return {}; } }
  function gSave(s) { try { localStorage.setItem(GAME_KEY, JSON.stringify(s)); } catch (e) {} }
  function gCand(d) { return { id: chId(d), name: d.name, color: d.color, avatar: d.avatar, subs: d.subs || 0, views: d.views || 0 }; }
  function gCurrent(id) { for (var i = 0; i < ALL.length; i++) { if (chId(ALL[i]) === id) return ALL[i]; } return null; }
  var gDraft = null;   // 未確定の問題セット
  function gGenerate() {
    var pool = ALL.filter(genreVisible).filter(function (d) { return d.subs; });
    var bs = pool.slice().sort(function (a, b) { return (b.subs || 0) - (a.subs || 0); });
    var bv = pool.slice().sort(function (a, b) { return (b.views || 0) - (a.views || 0); });
    var q = [];
    q.push({ type: 'grow', metric: 'subs', title: '今後' + GAME_DAYS + '日で「登録者」が一番のびるのは?', candidates: bs.slice(0, 6).map(gCand) });
    q.push({ type: 'grow', metric: 'views', title: '今後' + GAME_DAYS + '日で「総再生数」が一番のびるのは?', candidates: bv.slice(0, 6).map(gCand) });
    var top = bs.slice(0, 15), best = null;   // 接戦の隣接ペアで追い越し問題
    for (var i = 1; i < top.length; i++) {
      var hi = top[i - 1].subs || 0, lo = top[i].subs || 0;
      if (hi > 0) { var gp = (hi - lo) / hi; if (gp > 0 && (!best || gp < best.gp)) best = { gp: gp, a: top[i - 1], b: top[i] }; }
    }
    if (best) q.push({ type: 'overtake', a: gCand(best.a), b: gCand(best.b) });
    return { id: 'c' + Date.now(), questions: q, sel: {} };
  }
  function gGrowLeader(cq) {   // 現在の暫定リーダー(基準値からの増加が最大)
    var win = null, bd = -Infinity;
    cq.candidates.forEach(function (c) {
      var cur = gCurrent(c.id); var now = cur ? (cur[cq.metric] || 0) : c[cq.metric];
      var d = now - (c[cq.metric] || 0); if (d > bd) { bd = d; win = c; }
    });
    return { winner: win, delta: bd };
  }
  function gOverStatus(cq) {   // B が A を上回っているか
    var a = gCurrent(cq.a.id), b = gCurrent(cq.b.id);
    return (b ? b.subs : cq.b.subs) > (a ? a.subs : cq.a.subs);
  }
  function gScore(active) {
    var correct = 0, total = 0, detail = [];
    active.questions.forEach(function (cq, i) {
      total++;
      if (cq.type === 'grow') {
        var L = gGrowLeader(cq); var ok = L.winner && active.sel[i] === L.winner.id;
        if (ok) correct++; detail.push({ i: i, winnerId: L.winner && L.winner.id, ok: ok });
      } else {
        var yes = gOverStatus(cq); var ans = yes ? 'yes' : 'no'; var ok = active.sel[i] === ans;
        if (ok) correct++; detail.push({ i: i, answer: ans, ok: ok });
      }
    });
    return { correct: correct, total: total, detail: detail };
  }
  function gCountdown(ms) {
    var s = Math.max(0, ms - Date.now()); var d = Math.floor(s / 86400000), h = Math.floor((s % 86400000) / 3600000);
    return d > 0 ? (d + '日' + h + '時間') : (h + '時間');
  }
  function gOptHTML(cq, i, selVal, mode) {
    // mode: 'pick'(選択可) / 'lock'(確定表示) / 'result'(採点表示)
    if (cq.type === 'grow') {
      var lead = (mode !== 'pick') ? gGrowLeader(cq) : null;
      return '<div class="gq"><div class="gq-title">' + esc(cq.title) + '</div><div class="gq-opts">' +
        cq.candidates.map(function (c) {
          var on = selVal === c.id;
          var cls = 'gopt' + (on ? ' sel' : '') + (mode === 'result' && lead && lead.winner && lead.winner.id === c.id ? ' win' : '');
          var badge = (mode !== 'pick' && on) ? '<span class="gopt-you">あなた</span>' : '';
          return '<button class="' + cls + '" data-q="' + i + '" data-opt="' + esc(c.id) + '"' + (mode !== 'pick' ? ' disabled' : '') + ' style="--c:' + c.color + '">' +
            badge + '<img src="' + c.avatar + '" alt="" onerror="this.style.visibility=\'hidden\'"><span class="nm">' + esc(c.name) + '</span></button>';
        }).join('') + '</div>' +
        (mode === 'lock' && lead && lead.winner ? '<div class="g-prov">暫定トップ: <b style="color:' + lead.winner.color + '">' + esc(lead.winner.name) + '</b>(+' + fmt(Math.max(0, lead.delta)) + (cq.metric === 'subs' ? '人' : '回') + ')</div>' : '') +
        (mode === 'result' && lead && lead.winner ? '<div class="g-prov">正解: <b style="color:' + lead.winner.color + '">' + esc(lead.winner.name) + '</b></div>' : '') +
        '</div>';
    }
    // overtake
    var title = '<b style="color:' + cq.b.color + '">' + esc(cq.b.name) + '</b> は <b style="color:' + cq.a.color + '">' + esc(cq.a.name) + '</b> を' + GAME_DAYS + '日以内に追い越す?';
    var yes = selVal === 'yes', no = selVal === 'no';
    var st = (mode !== 'pick') ? gOverStatus(cq) : null;
    return '<div class="gq"><div class="gq-title">' + title + '</div><div class="gq-yn">' +
      '<button class="gyn' + (yes ? ' sel' : '') + (mode === 'result' && st ? ' win' : '') + '" data-q="' + i + '" data-opt="yes"' + (mode !== 'pick' ? ' disabled' : '') + '>する</button>' +
      '<button class="gyn' + (no ? ' sel' : '') + (mode === 'result' && !st ? ' win' : '') + '" data-q="' + i + '" data-opt="no"' + (mode !== 'pick' ? ' disabled' : '') + '>しない</button>' +
      '</div>' +
      (mode === 'lock' ? '<div class="g-prov">現在: ' + (st ? '追い越し済み' : 'まだ') + '</div>' : '') +
      (mode === 'result' ? '<div class="g-prov">結果: ' + (st ? '追い越した' : '追い越さなかった') + '</div>' : '') +
      '</div>';
  }
  function gStatsBar(st) {
    if (!st || !st.played) return '';
    var rate = Math.round(st.correct / (st.played * 3) * 100);
    return '<div class="g-stats"><span>参加 ' + st.played + '回</span><span>的中率 ' + rate + '%</span><span>連続全問正解 ' + (st.streak || 0) + '</span></div>';
  }
  var gameMode = 'predict';   // 'predict'(7日予想) or 'quiz'(その場でわかるクイズ)
  function renderGame() {
    var host = document.getElementById('game-root'); if (!host) return;
    host.innerHTML =
      '<div class="toggle" id="game-mode" style="margin-bottom:20px">' +
        '<button class="tg' + (gameMode === 'predict' ? ' on' : '') + '" data-gmode="predict">予想</button>' +
        '<button class="tg' + (gameMode === 'quiz' ? ' on' : '') + '" data-gmode="quiz">クイズ</button>' +
        '<span class="tg-ind" id="game-mode-ind"></span>' +
      '</div><div id="game-body"></div>';
    var tabs = [].slice.call(host.querySelectorAll('#game-mode .tg'));
    function moveInd() { var on = host.querySelector('#game-mode .tg.on'), ind = document.getElementById('game-mode-ind'); if (on && ind) { ind.style.left = on.offsetLeft + 'px'; ind.style.width = on.offsetWidth + 'px'; } }
    tabs.forEach(function (b) { b.addEventListener('click', function () { if (b.dataset.gmode === gameMode) return; gameMode = b.dataset.gmode; renderGame(); }); });
    moveInd();
    if (gameMode === 'quiz') renderQuiz(); else renderPredict();
  }

  /* ---- 予想(7日後に自動採点) ---- */
  function renderPredict() {
    var host = document.getElementById('game-body'); if (!host) return;
    var s = gLoad();
    if (s.active && s.active.picked && Date.now() >= s.active.resolve && !s.active.scored) {
      var sc = gScore(s.active);
      s.stats = s.stats || { played: 0, correct: 0, streak: 0, best: 0 };
      s.stats.played++; s.stats.correct += sc.correct;
      if (sc.correct === sc.total) { s.stats.streak = (s.stats.streak || 0) + 1; if (s.stats.streak > (s.stats.best || 0)) s.stats.best = s.stats.streak; } else s.stats.streak = 0;
      s.active.scored = true; s.active.result = sc; s.last = s.active; s.active = null; gSave(s);
    }
    var html = '<div class="game-head"><h3 class="g-h3">🎯 7日予想 <span class="fc-en">Prediction</span></h3>' +
      '<div class="fc-lead">データを見て予想 → ' + GAME_DAYS + '日後に自動で答え合わせ。</div></div>' + gStatsBar(s.stats);
    if (s.active && s.active.picked) {
      html += '<div class="g-count">結果発表まで あと <b>' + gCountdown(s.active.resolve) + '</b></div>';
      html += s.active.questions.map(function (cq, i) { return gOptHTML(cq, i, s.active.sel[i], 'lock'); }).join('');
      html += '<div class="g-note">締切まで暫定トップが変わります。また見に来てね。</div>';
    } else if (s.last && s.last.result) {
      var r = s.last.result;
      html += '<div class="g-score"><b>' + r.correct + '</b> / ' + r.total + ' 的中!</div>';
      html += s.last.questions.map(function (cq, i) { return gOptHTML(cq, i, s.last.sel[i], 'result'); }).join('');
      html += '<div class="g-actions"><button class="g-btn" id="g-again">もう一度 予想する</button>' +
        '<button class="g-btn g-x" id="g-share">𝕏 で結果をシェア</button></div>';
    } else {
      if (!gDraft) gDraft = gGenerate();
      html += gDraft.questions.map(function (cq, i) { return gOptHTML(cq, i, gDraft.sel[i], 'pick'); }).join('');
      var done = gDraft.questions.every(function (cq, i) { return gDraft.sel[i] != null; });
      html += '<div class="g-actions"><button class="g-btn g-confirm" id="g-confirm"' + (done ? '' : ' disabled') + '>この予想で確定する</button></div>';
    }
    host.innerHTML = html;
    host.querySelectorAll('.gopt:not([disabled]),.gyn:not([disabled])').forEach(function (b) {
      b.addEventListener('click', function () { if (!gDraft) return; gDraft.sel[+b.dataset.q] = b.dataset.opt; renderPredict(); });
    });
    var conf = host.querySelector('#g-confirm');
    if (conf) conf.addEventListener('click', function () { var s2 = gLoad(); gDraft.picked = true; gDraft.resolve = Date.now() + GAME_DMS; gDraft.scored = false; s2.active = gDraft; gSave(s2); gDraft = null; renderPredict(); });
    var again = host.querySelector('#g-again');
    if (again) again.addEventListener('click', function () { var s2 = gLoad(); s2.last = null; gSave(s2); gDraft = null; renderPredict(); });
    var sh = host.querySelector('#g-share');
    if (sh) sh.addEventListener('click', function () {
      var s2 = gLoad(); var r2 = (s2.last && s2.last.result) || { correct: 0, total: 3 };
      var t = 'PBersの予想ゲームで ' + r2.correct + '/' + r2.total + ' 的中！ ポーランドボーラー界隈を予想しよう #ポーランドボール';
      window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(t) + '&url=' + encodeURIComponent(location.origin + location.pathname + '#game'), '_blank', 'noopener');
    });
  }

  /* ---- クイズ(その場でわかる) ---- */
  var QUIZ_N = 7;
  var quizQs = null, quizIdx = 0, quizScore = 0, quizAnswered = false, quizPick = null, quizBest = null;
  function qShuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function quizGen() {
    var pool = ALL.filter(genreVisible).filter(function (d) { return d.subs; });
    var byV = pool.filter(function (d) { return d.views; });
    var qs = [], guard = 0;
    while (qs.length < QUIZ_N && guard++ < 200) {
      var kind = Math.floor(Math.random() * 3);
      var m = Math.random() < 0.5 ? 'subs' : 'views';
      var src = m === 'views' ? byV : pool;
      if (src.length < 4) { m = 'subs'; src = pool; }
      var mw = m === 'subs' ? '登録者数' : '総再生数', unit = m === 'subs' ? '人' : '回';
      var pick = qShuffle(src.slice());
      if (kind === 0) {   // どっちが多い?
        var a = pick[0], b = pick[1]; if (!a || !b || (a[m] || 0) === (b[m] || 0)) continue;
        qs.push({ t: mw + 'が多いのは?', opts: qShuffle([a, b]).map(function (d) { return { label: d.name, avatar: d.avatar, color: d.color, correct: d === (a[m] > b[m] ? a : b) }; }) });
      } else if (kind === 1) {   // 4択で一番多いのは?
        var four = pick.slice(0, 4); if (four.length < 4) continue;
        var top = four.slice().sort(function (x, y) { return (y[m] || 0) - (x[m] || 0); })[0];
        qs.push({ t: 'この中で' + mw + 'が一番多いのは?', opts: four.map(function (d) { return { label: d.name, avatar: d.avatar, color: d.color, correct: d === top }; }) });
      } else {   // 数値当て
        var ch = pick[0]; var real = ch[m] || 0; if (real <= 0) continue;
        var facts = qShuffle([0.55, 0.7, 1.35, 1.7, 2.2]); var vals = [real];
        for (var f = 0; f < facts.length && vals.length < 4; f++) { var v = Math.round(real * facts[f]); if (v > 0 && vals.indexOf(v) < 0 && jp(v) !== jp(real)) vals.push(v); }
        if (vals.length < 4) continue;
        qs.push({ t: ch.name + ' の' + mw + 'は?', opts: qShuffle(vals).map(function (v) { return { label: jp(v) + unit, color: ch.color, correct: v === real }; }) });
      }
    }
    return qs;
  }
  function renderQuiz() {
    var host = document.getElementById('game-body'); if (!host) return;
    if (!quizQs) { quizQs = quizGen(); quizIdx = 0; quizScore = 0; quizAnswered = false; quizPick = null; }
    var html = '<div class="game-head"><h3 class="g-h3">⚡ その場でクイズ <span class="fc-en">Quiz</span></h3>' +
      '<div class="fc-lead">全' + quizQs.length + '問・答えたその場で正解が出ます。</div></div>';
    if (quizIdx >= quizQs.length) {
      if (quizBest == null || quizScore > quizBest) quizBest = quizScore;
      html += '<div class="g-score"><b>' + quizScore + '</b> / ' + quizQs.length + ' 正解!</div>' +
        (quizBest != null ? '<div class="g-stats" style="justify-content:center"><span>自己ベスト ' + quizBest + '/' + quizQs.length + '</span></div>' : '') +
        '<div class="g-actions"><button class="g-btn" id="q-again">もう一度</button>' +
        '<button class="g-btn g-x" id="q-share">𝕏 でスコアをシェア</button></div>';
      host.innerHTML = html;
      var qa = host.querySelector('#q-again'); if (qa) qa.addEventListener('click', function () { quizQs = null; renderQuiz(); });
      var qsh = host.querySelector('#q-share'); if (qsh) qsh.addEventListener('click', function () {
        var t = 'PBersのポーランドボーラー・クイズで ' + quizScore + '/' + quizQs.length + ' 正解！ あなたは何問わかる? #ポーランドボール';
        window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(t) + '&url=' + encodeURIComponent(location.origin + location.pathname + '#game'), '_blank', 'noopener');
      });
      return;
    }
    var q = quizQs[quizIdx];
    html += '<div class="q-prog"><span>第 ' + (quizIdx + 1) + ' / ' + quizQs.length + ' 問</span><span>正解 ' + quizScore + '</span></div>';
    html += '<div class="gq"><div class="gq-title">' + esc(q.t) + '</div><div class="' + (q.opts[0].avatar ? 'gq-opts' : 'gq-vals') + '">' +
      q.opts.map(function (o, i) {
        var cls = (q.opts[0].avatar ? 'gopt' : 'qval');
        if (quizAnswered) { if (o.correct) cls += ' win'; else if (i === quizPick) cls += ' bad'; }
        var inner = o.avatar
          ? '<img src="' + o.avatar + '" alt="" onerror="this.style.visibility=\'hidden\'" style="border-color:' + o.color + '"><span class="nm">' + esc(o.label) + '</span>'
          : esc(o.label);
        return '<button class="' + cls + '" data-i="' + i + '"' + (quizAnswered ? ' disabled' : '') + ' style="--c:' + (o.color || '#888') + '">' + inner + '</button>';
      }).join('') + '</div>' +
      (quizAnswered ? '<div class="g-actions" style="margin-top:14px"><button class="g-btn" id="q-next">' + (quizIdx + 1 >= quizQs.length ? '結果を見る' : '次の問題へ') + '</button></div>' : '') +
      '</div>';
    host.innerHTML = html;
    host.querySelectorAll('.gopt:not([disabled]),.qval:not([disabled])').forEach(function (b) {
      b.addEventListener('click', function () {
        if (quizAnswered) return;
        quizAnswered = true; quizPick = +b.dataset.i;
        if (q.opts[quizPick].correct) quizScore++;
        renderQuiz();
      });
    });
    var nx = host.querySelector('#q-next');
    if (nx) nx.addEventListener('click', function () { quizIdx++; quizAnswered = false; quizPick = null; renderQuiz(); });
  }

  // 投稿数追い越し: 積み上がる16:9の箱スタック(1列 = 1チャンネル)
  function vovStack(ch, count, isWinner) {
    var col = ch.color || '#888';
    var boxes = '';
    for (var k = 0; k < count; k++) {
      boxes += '<div class="vov-box" style="--i:' + k + ';background:' + col + '"></div>';
    }
    return '<div class="vov-stack' + (isWinner ? ' win' : '') + '">' +
      '<div class="vov-boxes">' + boxes + '</div>' +
      '<img class="vov-av" src="' + (ch.avatar || '') + '" alt="" onerror="this.style.visibility=\'hidden\'" style="border-color:' + col + '">' +
      '<div class="vov-nm" style="color:' + col + '">' + esc(ch.name || '') + '</div>' +
    '</div>';
  }
  // 突破(土/月): 左下→右上に伸びる矢印。根元に ||| の躍動線、先端にアイコン
  function buildArrow(el) {
    var W = Math.max(280, el.clientWidth || 620), H = 210, pad = 26, r = 30;
    var c = el.dataset.c, cl = el.dataset.cl, ai = el.dataset.ai, id = el.dataset.clip, lb = el.dataset.lb || '';
    var iconX = W - pad - r, iconY = pad + r;                    // アイコン中心(右上)
    var rootX = pad + 30, rootY = H - pad - 4;
    var ang = Math.atan2(iconY - rootY, iconX - rootX);         // 上向き(負)
    var ux = Math.cos(ang), uy = Math.sin(ang);                 // 矢印方向の単位ベクトル
    var px = -uy, py = ux;                                      // 直交ベクトル
    // 矢じりの先端はアイコンの手前で止める(被り防止)
    var gap = 14, tipX = iconX - (r + gap) * ux, tipY = iconY - (r + gap) * uy;
    var ah = 30;                                               // 矢じりの長さ
    function pt(x, y) { return x.toFixed(1) + ',' + y.toFixed(1); }
    var shaft = 'M' + pt(rootX, rootY) + ' L' + pt(tipX, tipY);
    var h1 = 'M' + pt(tipX - ah * Math.cos(ang - 0.5), tipY - ah * Math.sin(ang - 0.5)) + ' L' + pt(tipX, tipY);
    var h2 = 'M' + pt(tipX - ah * Math.cos(ang + 0.5), tipY - ah * Math.sin(ang + 0.5)) + ' L' + pt(tipX, tipY);
    // 躍動線 |||: 根元寄りに矢印と平行な短い線を3本、直交方向にずらして配置
    var speed = '';
    var offs = [-18, 0, 18], seg = 34, back = 6;
    var dx = (30 * ux).toFixed(1), dy = (30 * uy).toFixed(1);
    for (var i = 0; i < offs.length; i++) {
      var bx = rootX - ux * back + px * offs[i], by = rootY - uy * back + py * offs[i];
      speed += '<line class="ar-speed" x1="' + bx.toFixed(1) + '" y1="' + by.toFixed(1) +
        '" x2="' + (bx + ux * seg).toFixed(1) + '" y2="' + (by + uy * seg).toFixed(1) + '"' +
        ' stroke="' + cl + '" style="--dx:' + dx + 'px;--dy:' + dy + 'px;animation-delay:' + (i * 0.12) + 's"/>';
    }
    // 突破ライン: アイコンの高さに水平な薄い線＋値ラベル
    var mline = '<line class="ms-gline" x1="0" y1="' + iconY + '" x2="' + W + '" y2="' + iconY + '"/>' +
      (lb ? '<text class="ms-glabel" x="4" y="' + (iconY - 7) + '">' + lb + '</text>' : '');
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
      '<defs><clipPath id="' + id + '"><circle cx="' + iconX + '" cy="' + iconY + '" r="' + r + '"/></clipPath></defs>' +
      mline + speed +
      '<path class="ar-shaft" d="' + shaft + '" stroke="' + c + '"/>' +
      '<path class="ar-head" d="' + h1 + '" stroke="' + c + '"/>' +
      '<path class="ar-head" d="' + h2 + '" stroke="' + c + '"/>' +
      '<image class="ar-icon" href="' + ai + '" x="' + (iconX - r) + '" y="' + (iconY - r) + '" width="' + (r * 2) + '" height="' + (r * 2) + '" clip-path="url(#' + id + ')" preserveAspectRatio="xMidYMid slice"/>' +
      '<circle class="ar-icon" cx="' + iconX + '" cy="' + iconY + '" r="' + r + '" fill="none" stroke="' + c + '" stroke-width="3"/>' +
      '</svg>';
    var sh = el.querySelector('.ar-shaft'); var L = sh.getTotalLength(); sh.style.strokeDasharray = L; sh.style.strokeDashoffset = L;
  }
  function renderNewsFeed() {
    var host = document.getElementById('news-feed'); if (!host) return;
    var NEWS = window.PBERS_NEWS || [];
    host.className = 'news-feed'; host.innerHTML = '';
    var any = false, clip = 0;
    NEWS.forEach(function (day) {
      var items = (day.items || []).filter(genreVisible);
      if (!items.length) return;
      any = true;
      var sep = document.createElement('div'); sep.className = 'nf-daysep'; sep.textContent = day.label; host.appendChild(sep);
      // 曜日を求める（土=6 / 月=1 は突破を矢印演出にする）
      var wd = -1;
      if (day.date) { var dp = day.date.split('-'); wd = new Date(+dp[0], (+dp[1]) - 1, +dp[2]).getDay(); }
      var arrowDay = (wd === 6 || wd === 1);
      items.forEach(function (n) {
        var st = document.createElement('div'); st.className = 'nf-story ' + n.type;
        if (n.type === 'milestone') {
          var bn = bigNum(n.kind, n.value);
          var lb = bn.n + bn.u;   // 突破ラインのラベル(例 300万回)
          var stage = arrowDay
            ? '<div class="ms-arrow" data-c="' + n.color + '" data-cl="' + shade(n.color, .42) + '" data-ai="' + esc(n.avatar) + '" data-lb="' + esc(lb) + '" data-clip="ar' + (clip++) + '"></div>'
            : '<div class="mbar-stage" style="--c:' + n.color + ';--cl:' + shade(n.color, .42) + ';--h:210px">' +
                '<div class="ms-line" style="bottom:210px"><span class="ms-line-lb">' + esc(lb) + '</span></div>' +
                '<div class="mbar"></div>' +
                '<img class="mbar-icon" src="' + n.avatar + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
              '</div>';
          st.innerHTML =
            '<div class="ms">' +
              '<div class="ms-metric">' + MWORD[n.kind] + ' 突破</div>' +
              '<div class="ms-num" style="color:' + n.color + '">' + esc(bn.n) + '<small>' + bn.u + '</small></div>' +
              stage +
              '<div class="ms-name" style="color:' + n.color + '">' + esc(n.name) + '</div>' +
            '</div>';
        } else if (n.type === 'multi_overtake') {
          st.innerHTML = movHTML(n);
        } else {
          var opp = n.opp || { name: '', color: '#888', avatar: '' };
          var title = '<div class="ov-title"><b style="color:' + n.color + '">' + esc(n.name) + '</b> が <b style="color:' + opp.color + '">' + esc(opp.name) + '</b> を ' + MWORD[n.kind] + 'で追い越し</div>';
          if (n.kind === 'videos') {
            // 投稿数の追い越し: 16:9の箱を積み上げ、追い越した方が1つ多い（全曜日この演出）
            st.innerHTML = '<div class="ov">' + title +
              '<div class="vov">' + vovStack(n, 5, true) + vovStack(opp, 4, false) + '</div></div>';
          } else {
            st.innerHTML = '<div class="ov">' + title +
              '<div class="ov-chart" data-a="' + n.color + '" data-b="' + opp.color + '" data-ai="' + esc(n.avatar) + '" data-bi="' + esc(opp.avatar) + '" data-clip="' + (clip++) + '"></div>' +
            '</div>';
          }
        }
        host.appendChild(st);
      });
    });
    if (!any) { host.innerHTML = '<div class="nf-none">まだニュースがありません（記録が2日分たまると出はじめます）。</div>'; return; }
    host.querySelectorAll('.ov-chart').forEach(buildOvChart);
    host.querySelectorAll('.ms-arrow').forEach(buildArrow);
    if (NF_OBS) NF_OBS.disconnect();
    if ('IntersectionObserver' in window) {
      NF_OBS = new IntersectionObserver(function (es) { es.forEach(function (e) { e.target.classList.toggle('in', e.isIntersecting); }); }, { threshold: 0.3 });
      host.querySelectorAll('.nf-story').forEach(function (s) { NF_OBS.observe(s); });
    } else {
      host.querySelectorAll('.nf-story').forEach(function (s) { s.classList.add('in'); });
    }
  }

  /* ---- race: close-race subscriber trends ---- */
  function buildRaceChart(el) {
    var race = RACE[+el.dataset.gi]; if (!race) return;
    var m = race.members;
    var dset = {}; m.forEach(function (x) { (x.history || []).forEach(function (p) { dset[p.d] = 1; }); });
    var ds = Object.keys(dset).sort();
    if (ds.length < 1) { el.innerHTML = '<div class="race-empty">推移データがまだありません（記録が増えると表示されます）。</div>'; return; }
    var W = Math.max(300, el.clientWidth || 620), H = 200, padL = 54, padR = 34, padT = 16, padB = 28;
    var vals = []; m.forEach(function (x) { (x.history || []).forEach(function (p) { vals.push(p.s); }); });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (mn === mx) { mn = mn * 0.999; mx = mx * 1.001 || 1; }
    var pad = (mx - mn) * 0.2 || 1, yMin = mn - pad, yMax = mx + pad, n = ds.length;
    var di = {}; ds.forEach(function (d, i) { di[d] = i; });
    function X(i) { return n === 1 ? padL + (W - padL - padR) / 2 : padL + (W - padL - padR) * i / (n - 1); }
    function Y(v) { return padT + (H - padT - padB) * (1 - (v - yMin) / (yMax - yMin)); }
    var grid = '', yl = '';
    [yMax, (yMax + yMin) / 2, yMin].forEach(function (gv) { var gy = Y(gv); grid += '<line class="t-grid" x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>'; yl += '<text class="t-axis" x="' + (padL - 8) + '" y="' + (gy + 4) + '" text-anchor="end">' + jp(Math.round(gv)) + '</text>'; });
    var xl = '', step = Math.max(1, Math.ceil(n / 6));
    ds.forEach(function (d, i) { if (i % step === 0 || i === n - 1) xl += '<text class="t-axis" x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + shortDate(d) + '</text>'; });
    var lines = '', icons = '', clip = '', gi = el.dataset.gi;
    m.forEach(function (x, mi) {
      var dd = ''; (x.history || []).forEach(function (p) { dd += (dd === '' ? 'M' : ' L') + X(di[p.d]) + ',' + Y(p.s); });
      if (!dd) return;
      lines += '<path class="race-line" d="' + dd + '" stroke="' + x.color + '"/>';
      var last = x.history[x.history.length - 1], lx = X(di[last.d]), ly = Y(last.s);
      clip += '<clipPath id="lc' + gi + '_' + mi + '"><circle cx="' + lx + '" cy="' + ly + '" r="13"/></clipPath>';
      icons += '<image href="' + x.avatar + '" x="' + (lx - 13) + '" y="' + (ly - 13) + '" width="26" height="26" clip-path="url(#lc' + gi + '_' + mi + ')" preserveAspectRatio="xMidYMid slice"/>' +
               '<circle cx="' + lx + '" cy="' + ly + '" r="13" fill="none" stroke="' + x.color + '" stroke-width="2.5"/>';
    });
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet"><defs>' + clip + '</defs>' + grid + yl + xl + lines + icons + '</svg>';
  }
  function renderRace() {
    var host = document.getElementById('race-list'); if (!host) return;
    if (!RACE.length) { host.innerHTML = '<div class="race-empty">いま接戦中の組はありません（記録が増えると表示されます）。</div>'; return; }
    host.innerHTML = '';
    RACE.forEach(function (race, gi) {
      var m = race.members;
      var subs = m.map(function (x) { return x.subs || 0; });
      var gap = Math.max.apply(null, subs) - Math.min.apply(null, subs);
      var title = race.special ? '<div class="race-title">👑 ' + esc(race.title || '首位争い TOP3') + '</div>' : '';
      var head = '<div class="race-head">' + m.map(function (x, mi) {
        var rk = race.special ? '<span class="race-rank">' + (mi + 1) + '</span>' : '';
        return '<div class="race-ch" style="--c:' + x.color + '">' + rk + '<img src="' + x.avatar + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
          '<div><div class="ln" style="color:' + x.color + '">' + esc(x.name) + '</div><div class="ls">' + jp(x.subs) + '人</div></div></div>';
      }).join('') + '<span class="race-gap">差 ' + fmt(gap) + '人</span></div>';
      var card = document.createElement('div'); card.className = 'race-card' + (race.special ? ' race-special' : '');
      card.innerHTML = title + head + '<div class="race-chart" data-gi="' + gi + '"></div>';
      host.appendChild(card);
    });
    host.querySelectorAll('.race-chart').forEach(buildRaceChart);
  }

  /* ---- settings: genre visibility ---- */
  function applyGenre() { build(); renderTiers(); renderGrowth(); renderNews(); replay(); playGrowth(); riseRender(false); renderDashRise(); }
  function updateGenreCounts() {
    var counts = {}; ALL.forEach(function (d) { counts[d.genre] = (counts[d.genre] || 0) + 1; });
    document.querySelectorAll('.g-count').forEach(function (el) { el.textContent = (counts[el.dataset.genre] || 0) + ' ch'; });
  }
  function setupSettings() {
    var gear = document.getElementById('gear');
    var panel = document.getElementById('settings');
    var listEl = document.getElementById('genre-list');
    if (!gear || !panel || !listEl) return;
    GENRES.forEach(function (g) {
      var it = document.createElement('div');
      it.className = 'genre-item' + (genreOn[g.label] ? ' on' : '');
      it.innerHTML = '<span class="box"></span><span class="g-label">' + esc(g.label) + '</span>' +
        '<span class="g-count" data-genre="' + esc(g.label) + '"></span>';
      it.addEventListener('click', function () {
        genreOn[g.label] = !genreOn[g.label];
        it.classList.toggle('on', genreOn[g.label]);
        applyGenre();
      });
      listEl.appendChild(it);
    });
    updateGenreCounts();
    gear.addEventListener('click', function (e) {
      e.stopPropagation();
      var willOpen = panel.hidden; panel.hidden = !willOpen;
      gear.setAttribute('aria-expanded', String(willOpen));
    });
    document.addEventListener('click', function (e) {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== gear) {
        panel.hidden = true; gear.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---- share (X / copy) ---- */
  function shareText() {
    var vis = ALL.filter(genreVisible);
    var ss = vis.reduce(function (s, d) { return s + (d.subs || 0); }, 0);
    var vv = vis.reduce(function (s, d) { return s + (d.views || 0); }, 0);
    return '現在のポーランドボーラー界隈の合計登録者数は' + jp(ss) + '人、総再生数は' + jp(vv) + '回です！ #ポーランドボール';
  }
  function setupShare() {
    var url = location.origin + location.pathname;
    var x = document.querySelector('#share-home [data-share="x"]');
    var c = document.querySelector('#share-home [data-share="copy"]');
    if (x) x.addEventListener('click', function () { window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText()) + '&url=' + encodeURIComponent(url), '_blank', 'noopener'); });
    if (c) c.addEventListener('click', function () { if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { c.textContent = 'コピーしました'; setTimeout(function () { c.textContent = 'リンクをコピー'; }, 1500); }); });
  }

  /* ---- latest videos (WebSub) ---- */
  function timeAgo(iso) {
    var t = Date.parse(iso); if (!t) return '';
    var s = (Date.now() - t) / 1000;
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + '分前';
    if (s < 86400) return Math.floor(s / 3600) + '時間前';
    return Math.floor(s / 86400) + '日前';
  }
  function chById(cid) { for (var i = 0; i < ALL.length; i++) { if (chId(ALL[i]) === cid) return ALL[i]; } return null; }
  var VIDEOS_CACHE = null, VIDEOS_TS = 0;
  function loadVideos(force) {
    var api = window.PBERS_VIDEOS_API; if (!api) return Promise.resolve([]);
    if (!force && VIDEOS_CACHE && (Date.now() - VIDEOS_TS < 45000)) return Promise.resolve(VIDEOS_CACHE);
    return fetch(api).then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
      list = (list || []).filter(function (v) { return v.title && v.title !== 'YouTube video feed'; })
                         .sort(function (a, b) { return (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0); });
      VIDEOS_CACHE = list; VIDEOS_TS = Date.now(); return list;
    }).catch(function () { return VIDEOS_CACHE || []; });
  }
  function vidCard(v) {
    var ch = chById(v.cid), name = ch ? ch.name : '', color = ch ? ch.color : '#8d8986', av = ch ? ch.avatar : '';
    return '<a class="vid' + (v.short ? ' short' : '') + '" href="' + v.url + '" target="_blank" rel="noopener">' +
      '<div class="vid-thumb"><img loading="lazy" src="' + v.thumb + '" alt="" onerror="this.style.visibility=\'hidden\'"></div>' +
      '<div class="vid-meta"><div class="vid-title">' + esc(v.title) + '</div>' +
      '<div class="vid-ch">' + (av ? '<img src="' + av + '" alt="" onerror="this.style.display=\'none\'">' : '') +
      '<span class="vid-nm" style="color:' + color + '">' + esc(name) + '</span>' +
      '<span class="vid-ago">' + timeAgo(v.published) + '</span></div></div></a>';
  }
  function renderVideos() {   // 最新動画タブ: 横動画/ショートを分けて全件
    var host = document.getElementById('videos-root'); if (!host) return;
    if (!window.PBERS_VIDEOS_API) { host.innerHTML = '<div class="fc-empty">最新動画は準備中です。</div>'; return; }
    loadVideos().then(function (list) {
      if (!list.length) { host.innerHTML = '<div class="fc-empty">まだ新着がありません。</div>'; return; }
      var longs = list.filter(function (v) { return !v.short; });
      var shorts = list.filter(function (v) { return v.short; });
      host.innerHTML =
        '<div class="fc-h3">横動画 <span class="fc-en">Videos</span> <span class="v-count">' + longs.length + '</span></div>' +
        '<div class="vid-grid">' + (longs.length ? longs.map(vidCard).join('') : '<div class="fc-empty">なし</div>') + '</div>' +
        '<div class="fc-h3" style="margin-top:34px">ショート <span class="fc-en">Shorts</span> <span class="v-count">' + shorts.length + '</span></div>' +
        '<div class="vid-grid short">' + (shorts.length ? shorts.map(vidCard).join('') : '<div class="fc-empty">なし</div>') + '</div>';
    });
  }

  /* ---- init ---- */
  // 日本/海外の切替トグル: 現在のエディションをハイライト
  document.querySelectorAll('.edsw-opt').forEach(function (a) {
    a.classList.toggle('on', a.getAttribute('data-ed') === GBASE);
  });
  if (!ALL.length) {
    // 空ロスター(海外向けの準備中など): データ描画はスキップし、ページを壊さない。タブ操作は有効。
    var _cap = document.getElementById('total-cap'); if (_cap) _cap.textContent = '準備中 / Coming soon';
    var _tot = document.getElementById('total'); if (_tot) _tot.textContent = '—';
    var _sub = document.getElementById('total-sub'); if (_sub) _sub.textContent = 'まもなくチャンネルが追加されます';
    setupTabs();
    setupSettings();
    return;
  }
  build();
  renderNews();
  // 最新動画タブを定期的に自動更新(開きっぱなしでもライブ反映)
  if (window.PBERS_VIDEOS_API) {
    setInterval(function () {
      loadVideos(true).then(function () {
        if (VIEWS.videos && !VIEWS.videos.hidden) renderVideos();
      });
    }, 60000);
  }
  setupShare();
  renderTiers();
  setupTierToggle();
  setupSettings();
  renderGrowth();
  renderTrend();
  setupGrowth();
  setupGrowthZoom();
  setupGrowthSlider();
  riseRender(false);
  setupRise();
  setupRiseZoom();
  setupRiseSlider();
  renderDashRise();
  setupBoard();
  setupTheme();
  setupTabs();
  setupDonutHover();
  setupColScroll();
  moveInd(document.querySelector('#toggle .tg.on'));
  var _rz;
  window.addEventListener('resize', function () {
    moveInd(document.querySelector('#toggle .tg.on')); showTotal();
    clearTimeout(_rz); _rz = setTimeout(function () {
      if (!VIEWS.growth.hidden) renderTrend();
      if (VIEWS.news && !VIEWS.news.hidden) document.querySelectorAll('#news-feed .ov-chart').forEach(buildOvChart);
      if (VIEWS.race && !VIEWS.race.hidden) document.querySelectorAll('#race-list .race-chart').forEach(buildRaceChart);
    }, 200);
  });
  observe(document.querySelector('.donut-stage'), playDonut);
  observe(document.getElementById('col-scroll'), playCols);   // observe the viewport-width container, not the wide flex
})();
