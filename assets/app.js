/* PBers — subscribers / total-views modes, giant donut + vertical columns,
   per-channel colors, hover overlay, scroll-triggered (replaying) animations */
(function () {
  var ALL = (window.PBERS_DATA || []).slice();
  var UPDATED = window.PBERS_UPDATED || '';

  var METRICS = {
    subs:   { key: 'subs',   unit: '人', word: '登録者',   cap: '合計登録者数 / Total Subscribers', ccap: 'Subscribers' },
    views:  { key: 'views',  unit: '回', word: '総再生数', cap: '合計総再生数 / Total Views',        ccap: 'Total Views' },
    videos: { key: 'videos', unit: '本', word: '投稿数',   cap: '合計投稿数 / Total Videos',         ccap: 'Videos' }
  };
  var metric = 'subs';
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
  var GUNIT = { subs: '人', views: '回', videos: '本' };
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
  function val(d) { return d[bm()] || 0; }
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

    setText('total-cap', METRICS[bm()].cap);
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
      col.addEventListener('click', function () { location.href = 'c/' + encodeURIComponent(d.slug || chId(d)) + '/'; });
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
      build();
      replay();
    });
  });

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
      if (d) { location.href = 'c/' + encodeURIComponent(d.slug || chId(d)) + '/'; return true; }
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
  function setupColScroll() { ['col-scroll', 'grow-scroll'].forEach(function (id) { var el = document.getElementById(id); if (el) setupScroll(el); }); }
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
  function cardEl(d, rankNum) {
    var wrap = document.createElement('div');
    wrap.className = 'card';
    wrap.style.borderColor = 'var(--line)';
    wrap.addEventListener('mouseenter', function () { wrap.style.borderColor = d.color; });
    wrap.addEventListener('mouseleave', function () { wrap.style.borderColor = 'var(--line)'; });
    wrap.innerHTML =
      '<a class="card-main" href="c/' + encodeURIComponent(d.slug || chId(d)) + '/">' +
        '<span class="rk num">' + rankNum + '</span>' +
        '<img class="av" loading="lazy" src="' + d.avatar + '" alt="" style="border-color:' + d.color + '" onerror="this.style.visibility=\'hidden\'">' +
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

  function renderGrowth() {
    var host = document.getElementById('grow-list'); if (!host) return;
    var note = document.getElementById('growth-span');
    var hint = document.getElementById('grow-hint');
    var span = GROWTH.span || { days: 0 };
    var list = (GROWTH[gmetric] || []).filter(genreVisible);
    if (!span.days || !list.length) {
      if (note) note.textContent = '';
      if (hint) hint.style.display = 'none';
      host.innerHTML = '<div class="grow-empty">成長ランキングは履歴が2日分たまると表示されます（明日以降に自動反映）。</div>';
      return;
    }
    if (hint) hint.style.display = '';
    if (note) note.textContent = '過去' + span.days + '日間（' + shortDate(span.from) + '→' + shortDate(span.to) + '）の増減';

    /* zoomed dimensions */
    var H = Math.round(BASE_GROW_H * growZoom);
    var PADV = Math.round(30 * growZoom);                 // reserve at top & bottom for labels/heads
    var usable = Math.max(40, H - 2 * PADV);
    var colBasis = Math.round(46 * growZoom), colMax = Math.round(66 * growZoom), gap = Math.round(12 * growZoom);
    host.style.gap = gap + 'px';

    var maxUp = 0, maxDown = 0;
    list.forEach(function (x) { if (x.delta > maxUp) maxUp = x.delta; if (-x.delta > maxDown) maxDown = -x.delta; });
    var range = (maxUp + maxDown) || 1;
    var perPx = usable / range;
    var baseFromBottom = PADV + maxDown * perPx;          // zero-line height from the plot bottom
    var baseFromTop = H - baseFromBottom;

    /* deviation (z-score) → arrow thickness & head size */
    var absv = list.map(function (x) { return Math.abs(x.delta); });
    var mu = _mean(absv), sd = _std(absv);
    function sizeFor(v) {
      var z = sd ? (v - mu) / sd : 0;
      var t = Math.max(0, Math.min(1, (z + 1.2) / 3.2));
      var shaftW = Math.round((8 + t * 22) * growZoom);          // 8〜30 * zoom
      var headHalf = Math.round((shaftW * 0.6 + 8));             // head always wider than shaft
      var headH = Math.round(headHalf * 0.9);
      return { shaftW: shaftW, headHalf: headHalf, headH: headH };
    }

    host.innerHTML = '';
    list.forEach(function (x, i) {
      var dir = x.delta > 0 ? 'up' : (x.delta < 0 ? 'down' : 'flat');
      var barPx = Math.abs(x.delta) * perPx;
      var sign = x.delta > 0 ? '+' : (x.delta < 0 ? '−' : '±');
      var s = sizeFor(Math.abs(x.delta));
      var headH = Math.max(4, Math.min(s.headH, barPx));         // never let the head exceed the bar length
      var col = document.createElement('div'); col.className = 'grow-col';
      col.style.flex = '1 0 ' + colBasis + 'px'; col.style.maxWidth = colMax + 'px';

      var shaftCss = 'width:' + s.shaftW + 'px;';
      var bar = '';
      if (dir === 'up') {
        var headCssU = 'border-left:' + s.headHalf + 'px solid transparent;border-right:' + s.headHalf + 'px solid transparent;border-bottom:' + headH + 'px solid ' + GC.UP + ';';
        bar = '<div class="gbar up" data-h="' + barPx + '" style="bottom:' + baseFromBottom + 'px">' +
                '<div class="ghead" style="' + headCssU + '"></div><div class="gshaft" style="' + shaftCss + 'background:' + GC.UP + '"></div></div>' +
              '<div class="gval up" style="bottom:' + (baseFromBottom + barPx + 6) + 'px">' + sign + fmt(x.delta) + GUNIT[gmetric] + '</div>';
      } else if (dir === 'down') {
        var headCssD = 'border-left:' + s.headHalf + 'px solid transparent;border-right:' + s.headHalf + 'px solid transparent;border-top:' + headH + 'px solid ' + GC.DOWN + ';';
        bar = '<div class="gbar down" data-h="' + barPx + '" style="top:' + baseFromTop + 'px">' +
                '<div class="gshaft" style="' + shaftCss + 'background:' + GC.DOWN + '"></div><div class="ghead" style="' + headCssD + '"></div></div>' +
              '<div class="gval down" style="top:' + (baseFromTop + barPx + 6) + 'px">' + sign + fmt(Math.abs(x.delta)) + GUNIT[gmetric] + '</div>';
      } else {
        bar = '<div class="gval flat" style="bottom:' + (baseFromBottom + 6) + 'px">±0' + GUNIT[gmetric] + '</div>';
      }

      col.innerHTML =
        '<div class="grow-plot" style="height:' + H + 'px">' +
          '<div class="gbaseline" style="bottom:' + baseFromBottom + 'px"></div>' + bar +
        '</div>' +
        '<div class="grow-foot"><div class="grow-crank num">' + (i + 1) + '</div>' +
        '<div class="grow-cname">' + esc(x.name) + '</div></div>';
      host.appendChild(col);
    });
  }
  function playGrowth() {
    var tog = document.getElementById('growth-toggle');
    var on = tog && tog.querySelector('.tg.on');
    var gind = document.getElementById('gtg-ind');
    if (on && gind) { gind.style.left = on.offsetLeft + 'px'; gind.style.width = on.offsetWidth + 'px'; }
    var cols = document.querySelectorAll('#grow-list .grow-col');
    document.querySelectorAll('#grow-list .gbar').forEach(function (b, k) {
      b.style.transitionDelay = (k * 0.02) + 's'; b.style.height = (b.dataset.h || 0) + 'px';
    });
    cols.forEach(function (c) { c.classList.add('shown'); });
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
    function upd() { if (val) val.textContent = Math.round(growZoom * 100) + '%'; renderGrowth(); playGrowth(); }
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
        renderGrowth(); playGrowth(); renderTrend();
      });
    });
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
    news:      document.getElementById('view-news'),
    race:      document.getElementById('view-race'),
    game:      document.getElementById('view-game'),
    videos:    document.getElementById('view-videos'),
    channels:  document.getElementById('view-channels')
  };
  var currentView = 'dashboard';
  function switchTab(v) {
    if (v === 'live') v = 'race';   // 旧ハッシュ #live / 旧リンクの後方互換
    if (!VIEWS[v]) v = 'dashboard';
    currentView = v;
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x.dataset.view === v); });
    Object.keys(VIEWS).forEach(function (k) { if (VIEWS[k]) VIEWS[k].hidden = (k !== v); });
    if (location.hash.slice(1) !== v) location.hash = v;   // reflect in the URL (#dashboard / #growth / #channels)
    window.scrollTo(0, 0);
    if (v === 'dashboard') { replay(); if (metric === 'predict') enterPredictUI(); }
    if (v === 'growth') { renderTrend(); playGrowth(); }
    if (v === 'news') renderNewsFeed();
    if (v === 'race') renderRace();
    if (v === 'game') renderGame();
    if (v === 'videos') renderVideos();
    if (v === 'channels') moveTierInd();
  }
  function hashView(h) { var v = (h || '').replace('#', ''); return v === 'live' ? 'race' : v; }   // 'live' は旧名の後方互換
  function setupTabs() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchTab(t.dataset.view); });
    });
    window.addEventListener('hashchange', function () {
      var v = hashView(location.hash);
      if (VIEWS[v] && v !== currentView) switchTab(v);
    });
    var initial = hashView(location.hash);   // deep-link on load
    if (VIEWS[initial] && initial !== 'dashboard') switchTab(initial);
  }

  /* ---- news feed (animated: 3D milestone bars + crossing overtakes) ---- */
  var NF_OBS = null;
  var MWORD = { subs: '登録者数', views: '総再生数', videos: '投稿数' };
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
  function applyGenre() { build(); renderTiers(); renderGrowth(); renderNews(); replay(); playGrowth(); }
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
