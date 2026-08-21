/* PBers — subscribers / total-views modes, giant donut + vertical columns,
   per-channel colors, hover overlay, scroll-triggered (replaying) animations */
(function () {
  var ALL = (window.PBERS_DATA || []).slice();
  var UPDATED = window.PBERS_UPDATED || '';

  var METRICS = {
    subs:  { key: 'subs',  unit: '人', word: '登録者',   cap: '合計登録者数 / Total Subscribers', ccap: 'Subscribers' },
    views: { key: 'views', unit: '回', word: '総再生数', cap: '合計総再生数 / Total Views',        ccap: 'Total Views' }
  };
  var metric = 'subs';
  var hideBig = false;         // 登録者10万人以上を除外
  var BIG = 100000;
  var gmetric = 'subs';        // 成長タブの指標
  var GROWTH = window.PBERS_GROWTH || { span: { days: 0 }, subs: [], views: [], videos: [] };
  var GUNIT = { subs: '人', views: '回', videos: '本' };
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
  function val(d) { return d[metric] || 0; }
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
    fitNum(dcNum, jp(total) + METRICS[metric].unit);
    dcNum.style.color = 'var(--text)';
    dcCap.textContent = 'Total ・ ' + DATA.length + 'ch';
    dcPct.textContent = '';
  }
  function showChannel(i) {
    var d = DATA[i];
    dcName.textContent = d.name;
    fitNum(dcNum, (val(d) ? fmt(val(d)) : '非公開'));
    dcNum.style.color = d.color;
    dcCap.textContent = METRICS[metric].ccap;
    dcPct.textContent = total ? (val(d) / total * 100).toFixed(1) + '%' : '';
  }
  function showOther() {
    if (!otherSeg) return;
    dcName.textContent = 'その他';
    fitNum(dcNum, jp(otherSeg.value) + METRICS[metric].unit);
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
    var base = hideBig ? ALL.filter(function (d) { return (d.subs || 0) < BIG; }) : ALL;
    DATA = base.slice().sort(function (a, b) { return val(b) - val(a); });
    total = DATA.reduce(function (s, d) { return s + val(d); }, 0);
    var max = val(DATA[0]) || 1;

    setText('total-cap', METRICS[metric].cap);
    setText('rank-title', METRICS[metric].word + 'ランキング');
    document.getElementById('total').innerHTML = fmt(total) + '<span class="u">' + METRICS[metric].unit + '</span>';
    document.getElementById('total-man').textContent = jp(total) + METRICS[metric].unit;

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
  function inView(el) { var r = el.getBoundingClientRect(); return r.top < innerHeight * 0.65 && r.bottom > innerHeight * 0.2; }
  function replay() {
    playDonut(false); playCols(false);
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      if (inView(document.querySelector('.donut-stage'))) playDonut(true);
      if (inView(cols)) playCols(true);
    }); });
  }
  function observe(el, play) {
    if (!el || !('IntersectionObserver' in window)) { play(true); return; }
    new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) requestAnimationFrame(function () { play(true); }); else play(false); });
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
    function at(e) {
      var r = stage.getBoundingClientRect();
      var scale = r.width / 200;
      var dx = e.clientX - (r.left + r.width / 2);
      var dy = e.clientY - (r.top + r.height / 2);
      var dist = Math.sqrt(dx * dx + dy * dy);
      var inner = (R - SW / 2) * scale - TOL, outer = (R + SW / 2) * scale + TOL;
      if (dist < inner || dist > outer) { if (cur !== -1) { cur = -1; unfocus(); } return; }
      var ang = Math.atan2(dx, -dy); if (ang < 0) ang += TAU;   // 0 at top, clockwise
      var frac = ang / TAU, hit = -1;
      for (var i = 0; i < sliceFrac.length; i++) {
        if (sliceFrac[i] > 0 && frac >= sliceStart[i] && frac < sliceStart[i] + sliceFrac[i]) { hit = i; break; }
      }
      if (hit !== cur) {
        cur = hit;
        if (hit === -1) unfocus();
        else if (donutSegs[hit].type === 'other') focusOther();
        else focus(donutSegs[hit].idx);
      }
    }
    stage.addEventListener('mousemove', at);
    stage.addEventListener('mouseleave', function () { cur = -1; unfocus(); });
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
  function cardEl(d, rankNum) {
    var a = document.createElement('a');
    a.className = 'card'; a.href = d.url; a.target = '_blank'; a.rel = 'noopener';
    a.style.borderColor = 'var(--line)';
    a.addEventListener('mouseenter', function () { a.style.borderColor = d.color; });
    a.addEventListener('mouseleave', function () { a.style.borderColor = 'var(--line)'; });
    a.innerHTML =
      '<span class="rk num">' + rankNum + '</span>' +
      '<img class="av" loading="lazy" src="' + d.avatar + '" alt="" style="border-color:' + d.color + '" onerror="this.style.visibility=\'hidden\'">' +
      '<span class="meta"><span class="cn">' + esc(d.name) + '</span>' +
      '<span class="cstats">' +
        '<span class="cstat"><i>登録者</i>' + (d.subs != null ? jp(d.subs) + '人' : '非公開') + '</span>' +
        '<span class="cstat"><i>総再生</i>' + (d.views != null ? jp(d.views) + '回' : '非公開') + '</span>' +
        '<span class="cstat"><i>投稿数</i>' + (d.videos != null ? fmt(d.videos) + '本' : '—') + '</span>' +
      '</span></span>' +
      '<span class="go">↗</span>';
    return a;
  }

  /* ---- channels-by-tier view (subscriber bands) ---- */
  function renderTiers() {
    var host = document.getElementById('tiers');
    if (!host) return;
    var list = ALL.slice().sort(function (a, b) { return (b.subs || 0) - (a.subs || 0); });
    var rankOf = {}; list.forEach(function (d, i) { rankOf[d.url] = i + 1; });
    var bands = [
      { title: '10万人以上',   min: 100000 },
      { title: '5万〜10万人',  min: 50000, max: 100000 },
      { title: '3万〜5万人',   min: 30000, max: 50000 },
      { title: '2万〜3万人',   min: 20000, max: 30000 },
      { title: '1万〜2万人',   min: 10000, max: 20000 },
      { title: '5000〜1万人',  min: 5000,  max: 10000 },
      { title: '5000人未満',   min: 0,     max: 5000 }
    ];
    host.innerHTML = '';
    bands.forEach(function (b) {
      var inb = list.filter(function (d) { var s = d.subs || 0; return s >= b.min && (b.max == null || s < b.max); });
      if (!inb.length) return;
      var band = document.createElement('div'); band.className = 'tier-band';
      var h = document.createElement('h3');
      h.innerHTML = '<span class="bar"></span>' + b.title + '<span class="cnt">' + inb.length + ' ch</span>';
      var g = document.createElement('div'); g.className = 'grid';
      inb.forEach(function (d) { g.appendChild(cardEl(d, rankOf[d.url])); });
      band.appendChild(h); band.appendChild(g); host.appendChild(band);
    });
  }

  /* ---- growth ranking (increase over the available window) ---- */
  function shortDate(s) { if (!s) return ''; var p = s.split('-'); return (+p[1]) + '/' + (+p[2]); }
  var GROW_H = 270;   // px, plot height (shared up+down range)
  function renderGrowth() {
    var host = document.getElementById('grow-list'); if (!host) return;
    var note = document.getElementById('growth-span');
    var hint = document.getElementById('grow-hint');
    var span = GROWTH.span || { days: 0 };
    var list = GROWTH[gmetric] || [];
    if (!span.days || !list.length) {
      if (note) note.textContent = '';
      if (hint) hint.style.display = 'none';
      host.innerHTML = '<div class="grow-empty">成長ランキングは履歴が2日分たまると表示されます（明日以降に自動反映）。</div>';
      return;
    }
    if (hint) hint.style.display = '';
    if (note) note.textContent = '過去' + span.days + '日間（' + shortDate(span.from) + '→' + shortDate(span.to) + '）の増減';

    var maxUp = 0, maxDown = 0;
    list.forEach(function (x) { if (x.delta > maxUp) maxUp = x.delta; if (-x.delta > maxDown) maxDown = -x.delta; });
    var range = (maxUp + maxDown) || 1;
    var perPx = GROW_H / range;
    var baseFromBottom = maxDown * perPx;     // zero-line height from the plot bottom
    var baseFromTop = GROW_H - baseFromBottom;

    host.innerHTML = '';
    list.forEach(function (x, i) {
      var dir = x.delta > 0 ? 'up' : (x.delta < 0 ? 'down' : 'flat');
      var barPx = Math.abs(x.delta) * perPx;
      var sign = x.delta > 0 ? '+' : (x.delta < 0 ? '−' : '±');
      var col = document.createElement('div'); col.className = 'grow-col';

      var bar = '';
      if (dir === 'up') {
        bar = '<div class="gbar up" data-h="' + barPx + '" style="bottom:' + baseFromBottom + 'px">' +
                '<div class="ghead up"></div><div class="gshaft"></div></div>' +
              '<div class="gval up" style="bottom:' + (baseFromBottom + barPx + 6) + 'px">' + sign + fmt(x.delta) + GUNIT[gmetric] + '</div>';
      } else if (dir === 'down') {
        bar = '<div class="gbar down" data-h="' + barPx + '" style="top:' + baseFromTop + 'px">' +
                '<div class="gshaft"></div><div class="ghead down"></div></div>' +
              '<div class="gval down" style="top:' + (baseFromTop + barPx + 6) + 'px">' + sign + fmt(Math.abs(x.delta)) + GUNIT[gmetric] + '</div>';
      } else {
        bar = '<div class="gval flat" style="bottom:' + (baseFromBottom + 6) + 'px">±0' + GUNIT[gmetric] + '</div>';
      }

      col.innerHTML =
        '<div class="grow-plot">' +
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
  function setupGrowth() {
    var gtabs = [].slice.call(document.querySelectorAll('#growth-toggle .tg'));
    gtabs.forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.gm === gmetric) return;
        gmetric = b.dataset.gm;
        gtabs.forEach(function (x) { x.classList.toggle('on', x === b); });
        renderGrowth(); playGrowth();
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
      var items = day.items && day.items.length
        ? day.items.map(function (n) {
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
    channels:  document.getElementById('view-channels')
  };
  function switchTab(v) {
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x.dataset.view === v); });
    Object.keys(VIEWS).forEach(function (k) { if (VIEWS[k]) VIEWS[k].hidden = (k !== v); });
    window.scrollTo(0, 0);
    if (v === 'dashboard') replay();
    if (v === 'growth') playGrowth();
  }
  function setupTabs() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchTab(t.dataset.view); });
    });
  }

  /* ---- init ---- */
  build();
  renderNews();
  renderTiers();
  renderGrowth();
  setupGrowth();
  setupTabs();
  setupDonutHover();
  setupColScroll();
  moveInd(document.querySelector('#toggle .tg.on'));
  window.addEventListener('resize', function () { moveInd(document.querySelector('#toggle .tg.on')); showTotal(); });
  observe(document.querySelector('.donut-stage'), playDonut);
  observe(document.getElementById('col-scroll'), playCols);   // observe the viewport-width container, not the wide flex
})();
