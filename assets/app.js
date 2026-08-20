/* PBers — subscribers / total-views modes, giant donut + vertical columns,
   per-channel colors, hover overlay, scroll-triggered (replaying) animations */
(function () {
  var ALL = (window.PBERS_DATA || []).slice();
  var UPDATED = window.PBERS_UPDATED || '';

  var METRICS = {
    subs:  { key: 'subs',  unit: '人', cap: '合計登録者数 / Total Subscribers', ccap: 'Subscribers' },
    views: { key: 'views', unit: '回', cap: '合計総再生数 / Total Views',        ccap: 'Total Views' }
  };
  var metric = 'subs';
  var DATA = [];               // current sorted view
  var total = 0;

  /* ---- formatting ---- */
  function fmt(n) { return n.toLocaleString('en-US'); }
  function jp(n) {
    if (n == null) return '—';
    if (n >= 1e8) { var o = n / 1e8; return (o >= 100 ? Math.round(o) : o.toFixed(o % 1 ? 1 : 0)) + '億'; }
    if (n >= 1e4) { var m = n / 1e4; return (m >= 100 ? Math.round(m) : m.toFixed(m % 1 ? 1 : 0)) + '万'; }
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
  var circles = [], chips = [], colEls = [], colBars = [];
  var sliceStart = [], sliceFrac = [];   // cumulative fractions for angle hit-testing

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

  /* ---- shared hover focus ---- */
  function focus(i) {
    circles.forEach(function (c, j) { c.style.opacity = j === i ? '1' : '0.25'; c.setAttribute('stroke-width', j === i ? SW + 8 : SW); });
    chips.forEach(function (ch, j) { ch.classList.toggle('dim', j !== i); });
    colEls.forEach(function (co, j) { co.style.opacity = j === i ? '1' : '0.4'; });
    showChannel(i);
  }
  function unfocus() {
    circles.forEach(function (c) { c.style.opacity = '1'; c.setAttribute('stroke-width', SW); });
    chips.forEach(function (ch) { ch.classList.remove('dim'); });
    colEls.forEach(function (co) { co.style.opacity = '1'; });
    showTotal();
  }

  /* ---- (re)build everything for current metric ---- */
  function build() {
    DATA = ALL.slice().sort(function (a, b) { return val(b) - val(a); });
    total = DATA.reduce(function (s, d) { return s + val(d); }, 0);
    var max = val(DATA[0]) || 1;

    setText('total-cap', METRICS[metric].cap);
    document.getElementById('total').innerHTML = fmt(total) + '<span class="u">' + METRICS[metric].unit + '</span>';
    document.getElementById('total-man').textContent = jp(total) + METRICS[metric].unit;

    /* donut (hover is handled at stage level by angle — see setupDonutHover) */
    svg.innerHTML = ''; circles = []; sliceStart = []; sliceFrac = []; var acc = 0;
    DATA.forEach(function (d, i) {
      var frac = total ? val(d) / total : 0;
      var len = Math.max(frac * C - GAP, 0);
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', 100); c.setAttribute('cy', 100); c.setAttribute('r', R);
      c.setAttribute('fill', 'none'); c.setAttribute('stroke', d.color); c.setAttribute('stroke-width', SW);
      c.setAttribute('stroke-dasharray', '0 ' + C); c.setAttribute('stroke-dashoffset', -acc * C);
      c.style.transition = 'stroke-dasharray .9s cubic-bezier(.22,1,.36,1), opacity .2s ease, stroke-width .2s ease';
      c.style.pointerEvents = 'none';
      c.dataset.len = len;
      svg.appendChild(c); circles.push(c);
      sliceStart.push(acc); sliceFrac.push(frac); acc += frac;
    });

    /* legend */
    legend.innerHTML = ''; chips = [];
    DATA.forEach(function (d, i) {
      var el = document.createElement('span');
      el.className = 'chip';
      el.innerHTML = '<span class="sw" style="background:' + d.color + '"></span>' +
        '<span class="cn">' + esc(d.name) + '</span>' +
        '<span class="cv">' + (val(d) ? jp(val(d)) : '—') + '</span>';
      el.addEventListener('mouseenter', function () { focus(i); });
      el.addEventListener('mouseleave', unfocus);
      legend.appendChild(el); chips.push(el);
    });

    /* columns */
    cols.innerHTML = ''; colEls = []; colBars = [];
    DATA.forEach(function (d, i) {
      var col = document.createElement('div');
      col.className = 'col' + (i < 3 ? ' top' : '');
      col.innerHTML =
        '<div class="col-bararea">' +
          '<div class="col-val" style="color:' + d.color + '">' + (val(d) ? jp(val(d)) : '—') + '</div>' +
          '<div class="col-bar" style="background:' + d.color + '" data-h="' + (val(d) / max * MAXBAR) + '"></div>' +
        '</div>' +
        '<div class="col-foot"><div class="col-rank num">' + (i + 1) + '</div>' +
        '<div class="col-name">' + esc(d.name) + '</div></div>';
      col.addEventListener('mouseenter', function () { focus(i); });
      col.addEventListener('mouseleave', unfocus);
      cols.appendChild(col); colEls.push(col); colBars.push(col.querySelector('.col-bar'));
    });

    /* directory */
    grid.innerHTML = '';
    DATA.forEach(function (d, i) {
      var a = document.createElement('a');
      a.className = 'card'; a.href = d.url; a.target = '_blank'; a.rel = 'noopener';
      a.style.borderColor = 'var(--line)';
      a.addEventListener('mouseenter', function () { a.style.borderColor = d.color; });
      a.addEventListener('mouseleave', function () { a.style.borderColor = 'var(--line)'; });
      a.innerHTML =
        '<span class="rk num">' + (i + 1) + '</span>' +
        '<img class="av" loading="lazy" src="' + d.avatar + '" alt="" style="border-color:' + d.color + '" onerror="this.style.visibility=\'hidden\'">' +
        '<span class="meta"><span class="cn">' + esc(d.name) + '</span>' +
        '<span class="cstats">' +
          '<span class="cstat"><i>登録者</i>' + (d.subs != null ? jp(d.subs) + '人' : '非公開') + '</span>' +
          '<span class="cstat"><i>総再生</i>' + (d.views != null ? jp(d.views) + '回' : '非公開') + '</span>' +
        '</span></span>' +
        '<span class="go">↗</span>';
      grid.appendChild(a);
    });

    showTotal();
  }

  /* ---- animations (replay on view + on metric change) ---- */
  function playDonut(on) {
    circles.forEach(function (c) { c.setAttribute('stroke-dasharray', on ? (c.dataset.len + ' ' + (C - c.dataset.len)) : ('0 ' + C)); });
  }
  function playCols(on) {
    colBars.forEach(function (b, k) { b.style.transitionDelay = on ? (k * 0.03) + 's' : '0s'; b.style.height = on ? (b.dataset.h + 'px') : '0px'; });
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
    if (!('IntersectionObserver' in window)) { play(true); return; }
    new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) requestAnimationFrame(function () { play(true); }); else play(false); });
    }, { threshold: 0.35 }).observe(el);
  }

  /* ---- toggle wiring ---- */
  var tgBtns = Array.prototype.slice.call(document.querySelectorAll('.tg'));
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
      if (hit !== cur) { cur = hit; hit === -1 ? unfocus() : focus(hit); }
    }
    stage.addEventListener('mousemove', at);
    stage.addEventListener('mouseleave', function () { cur = -1; unfocus(); });
  }

  /* ---- easier horizontal scroll for the column chart (wheel + drag) ---- */
  function setupColScroll() {
    var sc = document.getElementById('col-scroll');
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

  /* ---- init ---- */
  build();
  setupDonutHover();
  setupColScroll();
  moveInd(document.querySelector('.tg.on'));
  window.addEventListener('resize', function () { moveInd(document.querySelector('.tg.on')); showTotal(); });
  observe(document.querySelector('.donut-stage'), playDonut);
  observe(cols, playCols);
})();
