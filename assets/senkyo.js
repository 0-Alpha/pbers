/* PBers参院選。選挙区(東日本・中日本・西日本)の候補者と、比例の党に1票ずつ入れる。
   比例は非拘束名簿で、候補者名か党名に入れる。候補者名の票はその党の票にも数え、党の中は候補者名の票が多い順に当選する。
   データは assets/senkyo.json(gen_data.py が生成)と assets/senkyo_geo.json(地図)。投票は Worker の /api/senkyo。
   途中経過は見せず、締切の後にサーバーが返す得票で当選者を計算して地図に出す。 */
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var DONE_KEY = 'pbers_senkyo_vote', adminKey = '';
  var host = null, cfg = null, geo = null, status = null, api = '', pick = { block: null, cand: null, prop: null }, order = {}, base = '/', sending = false;
  var lastTap = null, view = null, moved = false, ZOOM_MAX = 6, SPREAD_AT = 2, AV_R = 9;   // SPREAD_AT 倍から、アイコンが都道府県へ分かれる
  var cavs = [], prefNames = [], centers = {}, spread = false;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function make(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function block(id) { return cfg.blocks.filter(function (b) { return b.id === id; })[0]; }
  function cand(id) { return cfg.candidates.filter(function (c) { return c.id === id; })[0]; }
  function inBlock(id) { return cfg.candidates.filter(function (c) { return c.block === id; }); }
  function party(k) { return cfg.parties[k]; }
  function dateText(ms) { var d = new Date(ms + 9 * 3600e3); return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日'; }
  function saved() {   // 候補者から外れた人に入れた票は、投票していない扱いにする
    try {
      var v = JSON.parse(localStorage.getItem(DONE_KEY) || 'null');
      return v && cand(v.cand) && (!v.pcand || cand(v.pcand)) ? v : null;
    } catch (e) { return null; }
  }
  function save(v) { try { localStorage.setItem(DONE_KEY, JSON.stringify(v)); } catch (e) {} }
  function avatarTag(c) { return '<img src="' + esc(c.avatar) + '" alt="" loading="lazy" style="border-color:' + party(c.party).color + '">'; }
  function partyTag(k) { return '<span class="sk-ptag" style="--c:' + party(k).color + '">' + party(k).name + '</span>'; }

  /* ---- 地図の拡大。ボタン、ホイール、ドラッグ、スマホはピンチとダブルタップ ---- */
  function viewOf() { if (!view) { var b = geo.viewBox; view = { x: b[0], y: b[1], w: b[2], h: b[3] }; } return view; }
  function zoomLevel() { return geo.viewBox[2] / viewOf().w; }
  function applyView(svg) {
    var v = viewOf(), z = zoomLevel(), px = svg.getBoundingClientRect().width || 600;
    svg.setAttribute('viewBox', [v.x, v.y, v.w, v.h].join(' '));
    svg.classList.toggle('zoomed', z > 1.01);
    svg.classList.toggle('names', z >= SPREAD_AT);   // 拡大したら県名を出す。文字の大きさは画面上で一定にする
    svg.style.setProperty('--sk-name', (12 * v.w / px).toFixed(2) + 'px');
    var s = Math.pow(z, -0.7);   // 拡大してもアイコンが地図を隠さないよう、控えめに大きくする
    [].slice.call(svg.querySelectorAll('.sk-lab')).forEach(function (g) {
      var ax = +g.dataset.x, ay = +g.dataset.y;
      g.setAttribute('transform', 'translate(' + ax + ' ' + ay + ') scale(' + s.toFixed(3) + ') translate(' + -ax + ' ' + -ay + ')');
    });
    var nowSpread = z >= SPREAD_AT;
    if (nowSpread !== spread) {   // 切り替わるときだけ動かす。拡大やドラッグの最中は遅れないようにする
      spread = nowSpread;
      svg.classList.add('moving');
      clearTimeout(svg.skTimer);
      svg.skTimer = setTimeout(function () { svg.classList.remove('moving'); }, 480);
    }
    svg.classList.toggle('spread', nowSpread);
    placeAvatars(px / v.w, s, nowSpread);
  }
  /* アイコンの位置。分かれる前は地方のまとまり、分かれた後は都道府県の中心。同じ県や近い県は重ならないよう押し広げる */
  function placeAvatars(unit, s, on) {
    var z = zoomLevel(), rpx = Math.min(16, 9.5 + (z - SPREAD_AT) * 2.4), r = rpx / unit, S = r / AV_R;
    if (on) {
      var byPref = {};
      cavs.forEach(function (a) { (byPref[a.c.pref] = byPref[a.c.pref] || []).push(a); });
      Object.keys(byPref).forEach(function (name) {
        var list = byPref[name], c = centers[name] || [0, 0];
        list.forEach(function (a, i) { a.x = c[0] + (i - (list.length - 1) / 2) * r * 2.1; a.y = c[1]; });
      });
      for (var it = 0; it < 8; it++) {
        cavs.forEach(function (a, i) {
          cavs.slice(i + 1).forEach(function (b) {
            var dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, need = r * 2.1;
            if (d >= need) return;
            var push = (need - d) / 2 / d;
            a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
          });
        });
      }
    }
    cavs.forEach(function (a) {
      var x = on ? a.x : a.ax + (a.tx - a.ax) * s, y = on ? a.y : a.ay + (a.ty - a.ay) * s, k = on ? S : s;
      a.g.style.transform = 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px) scale(' + k.toFixed(3) + ')';
    });
    prefNames.forEach(function (n) {   // 候補者がいる県は、県名をアイコンの下に出す
      var mine = on ? cavs.filter(function (a) { return a.c.pref === n.name; }) : [];
      var y = mine.length ? Math.max.apply(null, mine.map(function (a) { return a.y; })) + r + 13 / unit : n.y;
      var x = mine.length ? mine.reduce(function (t, a) { return t + a.x; }, 0) / mine.length : n.x;
      n.el.setAttribute('x', x.toFixed(1)); n.el.setAttribute('y', y.toFixed(1));
      n.mine = mine.length > 0; n.cx = x; n.cy = y;
    });
    var fs = 12 / unit, shown = prefNames.filter(function (n) { return n.mine; });   // 候補者のいない県名は、ほかの県名やアイコンに重なるときは隠す
    prefNames.forEach(function (n) {
      if (n.mine) { n.el.style.visibility = ''; return; }
      var w = n.name.length * fs / 2, hide = on && (shown.some(function (o) {
        return Math.abs(o.cx - n.cx) < w + o.name.length * fs / 2 && Math.abs(o.cy - n.cy) < fs * 1.15;
      }) || cavs.some(function (a) {
        return Math.abs(a.x - n.cx) < w + r && Math.abs(a.y - (n.cy - fs * 0.35)) < r + fs / 2;
      }));
      n.el.style.visibility = hide ? 'hidden' : '';
      if (!hide) shown.push(n);
    });
  }
  function zoomTo(svg, z, cx, cy) {   // (cx, cy) の位置が画面上で動かないように拡大する
    var b = geo.viewBox, v = viewOf();
    z = Math.max(1, Math.min(ZOOM_MAX, z));
    var w = b[2] / z, h = b[3] / z;
    if (cx == null) { cx = v.x + v.w / 2; cy = v.y + v.h / 2; }
    v.x = cx - (cx - v.x) * w / v.w; v.y = cy - (cy - v.y) * h / v.h; v.w = w; v.h = h;
    clampView(); applyView(svg);
  }
  function clampView() {
    var b = geo.viewBox, v = viewOf();
    v.x = Math.max(b[0], Math.min(b[0] + b[2] - v.w, v.x));
    v.y = Math.max(b[1], Math.min(b[1] + b[3] - v.h, v.y));
  }
  function svgPoint(svg, x, y) {
    var p = svg.createSVGPoint(); p.x = x; p.y = y;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }
  function wireZoom(svg) {
    var startDist = 0, startZoom = 1, anchor = null, pinching = false, last = null;
    moved = false;
    host.querySelector('.sk-zoom').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.z === 'in') zoomTo(svg, zoomLevel() * 2);
      if (b.dataset.z === 'out') zoomTo(svg, zoomLevel() / 2);
      if (b.dataset.z === 'reset') zoomTo(svg, 1);
    });
    svg.addEventListener('wheel', function (e) {
      var z = zoomLevel();
      if ((e.deltaY > 0 && z <= 1.001) || (e.deltaY < 0 && z >= ZOOM_MAX)) return;   // これ以上変わらないときはページをスクロールする
      e.preventDefault();
      var p = svgPoint(svg, e.clientX, e.clientY);   // トラックパッドのピンチは ctrlKey 付きで細かい値が来る
      zoomTo(svg, z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), p.x, p.y);
    }, { passive: false });
    svg.addEventListener('pointerdown', function (e) {
      if (pinching) return;
      moved = false;
      last = { x: e.clientX, y: e.clientY };
    });
    svg.addEventListener('pointermove', function (e) {
      if (pinching || zoomLevel() <= 1.01 || !last) return;
      if (!moved && Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) < 5) return;
      if (!moved) { try { svg.setPointerCapture(e.pointerId); } catch (x) {} }
      moved = true;
      var p0 = svgPoint(svg, last.x, last.y), p1 = svgPoint(svg, e.clientX, e.clientY), v = viewOf();
      v.x -= p1.x - p0.x; v.y -= p1.y - p0.y;
      clampView(); applyView(svg);
      last = { x: e.clientX, y: e.clientY };
    });
    var up = function () { last = null; };
    svg.addEventListener('pointerup', function (e) {
      up();
      if (e.pointerType !== 'touch' || moved || pinching) return;
      var now = Date.now(), t = lastTap;
      lastTap = { t: now, x: e.clientX, y: e.clientY };   // 1回目のタップで地図が描き直されても続けて数える
      if (!t || now - t.t > 350 || dist(t, lastTap) > 40) return;
      lastTap = null;
      moved = true;   // 続く click で地方を選ばない
      var p = svgPoint(svg, e.clientX, e.clientY), z = zoomLevel();
      zoomTo(svg, z >= ZOOM_MAX ? 1 : z * 2, p.x, p.y);
    });
    svg.addEventListener('pointercancel', up);
    // ピンチは touch で受ける。pointer のままだと、全体表示のときにブラウザの操作へ取られて途中で切れる
    var touchMid = function (e) { return { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 }; };
    var touchDist = function (e) { return Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); };
    svg.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      var m = touchMid(e);
      pinching = true; moved = true; last = null; lastTap = null;
      startDist = touchDist(e); startZoom = zoomLevel(); anchor = svgPoint(svg, m.x, m.y);
    }, { passive: false });
    svg.addEventListener('touchmove', function (e) {
      if (!pinching || e.touches.length !== 2) return;
      e.preventDefault();
      var r = svg.getBoundingClientRect(), m = touchMid(e), b = geo.viewBox, v = viewOf();
      var z = Math.max(1, Math.min(ZOOM_MAX, startZoom * touchDist(e) / (startDist || 1)));
      v.w = b[2] / z; v.h = b[3] / z;   // 指の間の地点が、指の真ん中についてくるように動かす
      v.x = anchor.x - (m.x - r.left) / r.width * v.w;
      v.y = anchor.y - (m.y - r.top) / r.height * v.h;
      clampView(); applyView(svg);
    }, { passive: false });
    var touchDone = function (e) { if (e.touches.length < 2) pinching = false; };
    svg.addEventListener('touchend', touchDone);
    svg.addEventListener('touchcancel', touchDone);
    svg.addEventListener('gesturestart', function (e) { e.preventDefault(); });   // iPhone のページ拡大を止める
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function prefCenter(d) {   // 県名の位置。島ではなく、いちばん大きい形の中心に置く
    var best = null, ba = -1;
    d.split('M').forEach(function (part) {
      var nums = part.replace('Z', ' ').trim().split(/\s+/).filter(Boolean).map(function (v) { return v.split(',').map(Number); });
      if (nums.length < 3) return;
      var xs = nums.map(function (q) { return q[0]; }), ys = nums.map(function (q) { return q[1]; });
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys), a = (x1 - x0) * (y1 - y0);
      if (a > ba) { ba = a; best = [(x0 + x1) / 2, (y0 + y1) / 2]; }
    });
    return best;
  }

  /* ---- 地図 ---- */
  function fillFor(prefName, winners) {   // 県の色は候補者の党。同数ならしま模様。結果が出たら当選者だけ塗る
    var list = cfg.candidates.filter(function (c) { return c.pref === prefName && (!winners || winners[c.id]); });
    if (!list.length) return '';
    var n = { s: 0, m: 0, l: 0 };
    list.forEach(function (c) { n[c.party]++; });
    var top = Math.max(n.s, n.m, n.l), lead = ['s', 'm', 'l'].filter(function (k) { return n[k] === top; });
    return lead.length > 1 ? 'url(#sk-tie-' + lead[0] + lead[1] + ')' : party(lead[0]).color;
  }
  function drawMap(svg, winners) {
    svg.innerHTML = '';
    svg.classList.toggle('picked', !!pick.block);
    var defs = make('defs', {}, svg);
    [['s', 'm'], ['s', 'l'], ['m', 'l']].forEach(function (p) {
      var pt = make('pattern', { id: 'sk-tie-' + p[0] + p[1], width: 10, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
      make('rect', { width: 5, height: 10, style: 'fill:' + party(p[0]).color }, pt);
      make('rect', { x: 5, width: 5, height: 10, style: 'fill:' + party(p[1]).color }, pt);
    });
    cfg.blocks.forEach(function (b) {
      var g = make('g', { 'class': 'sk-b' + (pick.block === b.id ? ' on' : ''), 'data-block': b.id }, svg);
      geo.prefs.filter(function (p) { return p.region === b.id; }).forEach(function (p) {
        var el = make('path', { 'class': 'sk-pref', d: p.d }, g), f = fillFor(p.name, winners);
        if (f) el.style.fill = f;
        var names = cfg.candidates.filter(function (c) { return c.pref === p.name; }).map(function (c) { return c.name; });
        make('title', {}, el).textContent = p.name + (names.length ? ': ' + names.join('、') : '');
      });
    });
    var lines = make('g', { 'class': 'sk-lines' }, svg);
    make('path', { 'class': 'sk-line-pref', d: geo.prefLines }, lines);
    make('path', { 'class': 'sk-line-block', d: geo.regionLines }, lines);
    var ib = geo.okiBox;
    make('rect', { 'class': 'sk-inset', x: ib[0], y: ib[1], width: ib[2], height: ib[3], rx: 4 }, svg);
    make('text', { 'class': 'sk-oki', x: ib[0] + 6, y: ib[1] + 16 }, svg).textContent = '奄美・沖縄';
    if (pick.block) make('path', { 'class': 'sk-outline', d: geo.outlines[pick.block] }, svg);
    cavs = []; prefNames = [];
    make('circle', { r: AV_R }, make('clipPath', { id: 'sk-avclip' }, defs));
    geo.prefs.forEach(function (p) {
      var c = centers[p.name] || (centers[p.name] = prefCenter(p.d));
      if (!c) return;
      var el = make('text', { 'class': 'sk-prefname', x: c[0], y: c[1] }, svg);
      el.textContent = p.name;
      prefNames.push({ el: el, name: p.name, x: c[0], y: c[1] });
    });
    cfg.blocks.forEach(function (b) {
      var list = inBlock(b.id).filter(function (c) { return !winners || winners[c.id]; });
      var lab = make('g', { 'class': 'sk-lab' + (pick.block && pick.block !== b.id ? ' dim' : ''), 'data-x': b.x, 'data-y': b.y + 8 }, svg);
      make('text', { 'class': 'sk-name', x: b.x, y: b.y }, lab).textContent = b.name;
      var P = 22, cols = 4, rows = Math.ceil(list.length / cols), wide = Math.min(cols, list.length);
      if (!list.length) return;
      make('rect', { 'class': 'sk-tray', x: b.x - wide * P / 2 - 2, y: b.y + 5, width: wide * P + 4, height: rows * P + 4, rx: 10 }, lab);
      list.forEach(function (c, i) {
        var col = i % cols, row = Math.floor(i / cols), n = Math.min(cols, list.length - row * cols);
        var cx = b.x + (col - (n - 1) / 2) * P, cy = b.y + 7 + P / 2 + row * P, R = AV_R;
        var av = make('g', { 'class': 'sk-cav' + (pick.block && pick.block !== b.id ? ' dim' : '') }, svg);
        make('title', {}, av).textContent = c.name + '(' + c.pref + ')';
        make('image', { href: c.avatar, x: -R, y: -R, width: R * 2, height: R * 2, 'clip-path': 'url(#sk-avclip)', preserveAspectRatio: 'xMidYMid slice' }, av);
        make('circle', { r: R, 'class': 'sk-ring', style: 'stroke:' + party(c.party).color }, av);
        cavs.push({ g: av, c: c, tx: cx, ty: cy, ax: b.x, ay: b.y + 8, x: cx, y: cy });
      });
    });
    applyView(svg);
  }

  /* ---- 結果の計算 ---- */
  function computeResult(r) {
    var votes = {}, winners = {}, rows = {};
    (r.cands || []).forEach(function (x) { votes[x.cand] = x.n; });
    // 同数はチャンネルIDの順で決める。開き直しても結果が変わらないようにするため
    var rank = function (a, b) { return (votes[b.id] || 0) - (votes[a.id] || 0) || (a.id < b.id ? -1 : 1); };
    cfg.blocks.forEach(function (b) {
      var list = inBlock(b.id).sort(rank);
      rows[b.id] = list;
      list.slice(0, b.seats).forEach(function (c) { if (votes[c.id]) winners[c.id] = '選挙区'; });   // 0票では当選しない
    });
    var pv = { s: 0, m: 0, l: 0 }, named = { s: 0, m: 0, l: 0 }, pcv = {};   // 党の票 = 党名の票 + 候補者名の票
    (r.parties || []).forEach(function (x) { pv[x.party] = (pv[x.party] || 0) + x.n; });
    (r.pcands || []).forEach(function (x) { pcv[x.cand] = x.n; var c = cand(x.cand); if (c) { pv[c.party] += x.n; named[c.party] += x.n; } });
    var prank = function (a, b) { return (pcv[b.id] || 0) - (pcv[a.id] || 0) || rank(a, b); };   // 比例は候補者名の票が多い順
    var seats = { s: 0, m: 0, l: 0 }, prop = [];
    for (var i = 0; i < cfg.proportional; i++) {   // ドント式。各党の候補者が残っている間だけ議席を配る
      var best = null, bv = -1;
      ['s', 'm', 'l'].forEach(function (k) {
        var left = cfg.candidates.filter(function (c) { return c.party === k && !winners[c.id]; });
        var q = pv[k] / (seats[k] + 1);
        if (left.length && pv[k] > 0 && q > bv) { bv = q; best = k; }
      });
      if (!best) break;
      seats[best]++;
      var who = cfg.candidates.filter(function (c) { return c.party === best && !winners[c.id]; }).sort(prank)[0];
      winners[who.id] = '比例';
      prop.push(who);
    }
    return { votes: votes, winners: winners, rows: rows, partyVotes: pv, named: named, pcv: pcv, prop: prop, seats: seats, total: r.total || 0 };
  }

  /* ---- 画面 ---- */
  function head(text) {
    return '<p class="sk-status">' + text + '</p>';
  }
  function renderVote() {
    var open = status && status.open, closes = status ? status.closes : cfg.closes;
    var bl = pick.block ? block(pick.block) : null;
    var cands = pick.block ? order[pick.block] : [];
    var ready = pick.block && pick.cand && pick.prop;
    host.innerHTML =
      '<div class="sk-wrap"><div class="sk-form">' +
        (status && status.revote ? head('候補者が変わったので、もう一度投票できます。前の票は数えません。') : '') +
        head(status ? '投票受付中・' + dateText(closes - 1) + 'まで。1人1回で、やり直せません。' : '投票の受付を準備中です。候補者は見られます。') +
        '<h3 class="sk-h"><b>1</b>住んでいる地方を選ぶ</h3>' +
        '<div class="sk-blocks">' + cfg.blocks.map(function (b) {
          return '<label class="sk-opt sk-blockopt' + (pick.block === b.id ? ' on' : '') + '"><input type="radio" name="sk-block" value="' + b.id + '"' + (pick.block === b.id ? ' checked' : '') + '>' +
            '<span class="sk-opt-n">' + b.name + '</span><span class="sk-opt-d">' + esc(b.area) + '</span><span class="sk-opt-s num">定数' + b.seats + '</span></label>';
        }).join('') + '</div>' +
        '<h3 class="sk-h"><b>2</b>選挙区の候補者に1票' + (bl ? '<small>' + bl.name + '</small>' : '') + '</h3>' +
        (bl ? '<div class="sk-cands">' + cands.map(function (c) {
          return '<label class="sk-opt sk-cand' + (pick.cand === c.id ? ' on' : '') + '"><input type="radio" name="sk-cand" value="' + c.id + '"' + (pick.cand === c.id ? ' checked' : '') + '>' + avatarTag(c) +
            '<span class="sk-opt-n">' + esc(c.name) + '</span><span class="sk-opt-d">' + esc(c.pref) + '</span>' + partyTag(c.party) + '</label>';
        }).join('') + '</div>' : '<p class="sk-empty">先に地方を選んでください。</p>') +
        '<h3 class="sk-h"><b>3</b>比例は候補者か党に1票<small>全国で' + cfg.proportional + '議席</small></h3>' +
        '<p class="sk-rule">候補者に入れた票は、その党の票にもなります。党の中は、候補者名の票が多い人から当選します(非拘束名簿式)。</p>' +
        propList() +
        '<div class="sk-go"><button type="button" class="g-btn sk-send"' + (ready && open && !sending ? '' : ' disabled') + '>この内容で投票する</button><span class="sk-msg" aria-live="polite"></span></div>' +
        foot() +
      '</div>' + mapBox() + '</div>';
    wire();
    drawMap(host.querySelector('.sk-map'));
  }
  function propList() {
    return ['s', 'm', 'l'].map(function (k) {
      var v = 'p:' + k, list = order['prop' + k] || (order['prop' + k] = shuffle(cfg.candidates.filter(function (c) { return c.party === k; })));
      return '<div class="sk-pgroup" style="--c:' + party(k).color + '">' +
        '<label class="sk-opt sk-party' + (pick.prop === v ? ' on' : '') + '"><input type="radio" name="sk-prop" value="' + v + '"' + (pick.prop === v ? ' checked' : '') + '>' +
          '<span class="sk-opt-n">' + party(k).name + '</span><span class="sk-opt-d">党名で入れる・' + party(k).rule + '</span></label>' +
        '<div class="sk-pcands">' + list.map(function (c) {
          var cv = 'c:' + c.id;
          return '<label class="sk-opt sk-pcand' + (pick.prop === cv ? ' on' : '') + '"><input type="radio" name="sk-prop" value="' + cv + '"' + (pick.prop === cv ? ' checked' : '') + '>' + avatarTag(c) +
            '<span class="sk-opt-n">' + esc(c.name) + '</span></label>';
        }).join('') + '</div></div>';
    }).join('');
  }
  function mapBox() { return '<div class="sk-mapbox"><div class="sk-zoom" role="group" aria-label="地図の拡大"><button type="button" data-z="in" aria-label="拡大">+</button><button type="button" data-z="out" aria-label="縮小">−</button><button type="button" data-z="reset">全体</button></div><svg class="sk-map" role="img" aria-label="選挙区と候補者の地図"></svg><p class="sk-touchhint">ダブルタップか2本指で拡大</p><p class="sk-legend">' + ['s', 'm', 'l'].map(function (k) { return partyTag(k); }).join('') + '</p></div>'; }
  function foot() { return '<p class="sk-note">自分の地方は自己申告です。候補者は出身を公表しているチャンネルです。サイト内の遊びの企画で、実際の選挙とは関係ありません。</p>'; }
  function renderVoted() {
    var v = saved(), c = v && cand(v.cand), until = dateText(status.closes - 1);
    host.innerHTML =
      '<div class="sk-wrap"><div class="sk-form">' +
        '<h3 class="sk-done">' + (status.open ? '投票しました' : '投票は終了しました') + '</h3>' +
        head((status.open ? '投票は' + until + 'まで受け付けます。' : '受付は' + until + 'まででした。') + '途中経過も結果も、このサイトでは公開しません。') +
        (c ? '<div class="sk-mine"><div class="sk-mine-r"><span>選挙区</span>' + avatarTag(c) + '<b>' + esc(c.name) + '</b></div>' +
          '<div class="sk-mine-r"><span>比例</span>' + propMine(v) + '</div></div>' : '') +
        '<h3 class="sk-h">候補者</h3>' + candidateList() + foot() +
      '</div>' + mapBox() + '</div>';
    wireMap();
    drawMap(host.querySelector('.sk-map'));
  }
  function propMine(v) {
    if (v.pcand && cand(v.pcand)) { var c = cand(v.pcand); return avatarTag(c) + '<b>' + esc(c.name) + '</b>' + partyTag(c.party); }
    return v.party ? partyTag(v.party) : '';
  }
  function candidateList() {
    return cfg.blocks.map(function (b) {
      return '<div class="sk-rblock"><h4>' + b.name + ' <small>定数' + b.seats + '</small></h4>' + inBlock(b.id).map(function (c) {
        return '<div class="sk-rrow">' + avatarTag(c) + '<span class="sk-opt-n">' + esc(c.name) + '</span><span class="sk-opt-d">' + esc(c.pref) + '</span>' + partyTag(c.party) + '</div>';
      }).join('') + '</div>';
    }).join('');
  }
  function renderResult() {
    var R = computeResult(status.results), n = Object.keys(R.winners).length;
    var seatOf = { s: 0, m: 0, l: 0 };
    Object.keys(R.winners).forEach(function (id) { seatOf[cand(id).party]++; });
    host.innerHTML =
      '<div class="sk-wrap"><div class="sk-form">' +
        '<h3 class="sk-done">開票結果</h3>' + head('投票総数 ' + R.total + '票。' + n + '議席が決まりました。管理者にだけ表示しています。') +
        '<div class="sk-seats">' + ['s', 'm', 'l'].map(function (k) {
          return '<div class="sk-seat" style="--c:' + party(k).color + '"><b class="num">' + seatOf[k] + '</b><span>' + party(k).name + '</span><small class="num">比例 ' + R.partyVotes[k] + '票</small></div>';
        }).join('') + '</div>' +
        '<div class="sk-rblock"><h4>比例 <small>定数' + cfg.proportional + '・候補者名の票が多い順</small></h4>' + ['s', 'm', 'l'].map(function (k) {
          var list = cfg.candidates.filter(function (c) { return c.party === k && (R.pcv[c.id] || R.winners[c.id] === '比例'); }).sort(function (a, b) { return (R.pcv[b.id] || 0) - (R.pcv[a.id] || 0); });
          return '<div class="sk-pres"><div class="sk-pres-h">' + partyTag(k) + '<span class="num">候補者名 ' + R.named[k] + '票・党名 ' + (R.partyVotes[k] - R.named[k]) + '票</span></div>' + list.map(function (c) {
            var w = R.winners[c.id];
            return '<div class="sk-rrow' + (w === '比例' ? ' win' : '') + '">' + avatarTag(c) + '<span class="sk-opt-n">' + esc(c.name) + '</span><span class="sk-rv num">' + (R.pcv[c.id] || 0) + '票</span>' + (w === '比例' ? '<span class="sk-won">比例当選</span>' : w ? '<span class="sk-rs">選挙区で当選</span>' : '') + '</div>';
          }).join('') + '</div>';
        }).join('') + '</div>' +
        cfg.blocks.map(function (b) {
          return '<div class="sk-rblock"><h4>' + b.name + ' <small>定数' + b.seats + '</small></h4>' + R.rows[b.id].map(function (c) {
            var w = R.winners[c.id];
            return '<div class="sk-rrow' + (w ? ' win' : '') + '">' + avatarTag(c) + '<span class="sk-opt-n">' + esc(c.name) + '</span><span class="sk-rv num">' + (R.votes[c.id] || 0) + '票</span>' + (w ? '<span class="sk-won">' + w + '当選</span>' : partyTag(c.party)) + '</div>';
          }).join('') + '</div>';
        }).join('') + foot() +
      '</div>' + mapBox() + '</div>';
    wireMap();
    drawMap(host.querySelector('.sk-map'), R.winners);
  }
  function setBlock(id) {
    if (pick.block !== id) pick.cand = null;
    pick.block = id;
    if (!order[id]) order[id] = shuffle(inBlock(id));   // 表示順で得票が偏らないよう、人ごとに順番を変える
    render();
  }
  function wireMap() {
    var svg = host.querySelector('.sk-map');
    wireZoom(svg);
    svg.addEventListener('click', function (e) {
      if (moved) { moved = false; return; }   // 地図を動かしただけのときは選ばない
      var g = e.target.closest('.sk-b');
      if (g && status && status.open && !saved() && !status.voted) setBlock(g.dataset.block);
    });
  }
  function wire() {
    wireMap();
    host.querySelector('.sk-form').addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'sk-block') setBlock(t.value);
      if (t.name === 'sk-cand') pick.cand = t.value;
      if (t.name === 'sk-prop') pick.prop = t.value;
      if (t.name !== 'sk-cand' && t.name !== 'sk-prop') return;
      [].slice.call(host.querySelectorAll('input[name=' + t.name + ']')).forEach(function (r) { r.closest('.sk-opt').classList.toggle('on', r.checked); });
      host.querySelector('.sk-send').disabled = !(pick.block && pick.cand && pick.prop && status && status.open);
    });
    host.querySelector('.sk-send').addEventListener('click', send);
  }
  function send() {
    if (sending || !pick.block || !pick.cand || !pick.prop) return;
    sending = true;
    var btn = host.querySelector('.sk-send'), msg = host.querySelector('.sk-msg');
    btn.disabled = true;
    msg.textContent = '送信中…';
    var ballot = { block: pick.block, cand: pick.cand };
    if (pick.prop.charAt(0) === 'p') ballot.party = pick.prop.slice(2); else ballot.pcand = pick.prop.slice(2);
    fetch(api + '/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ballot) })
      .then(function (r) { return r.json().then(function (d) { return { code: r.status, d: d }; }); })
      .then(function (x) {
        sending = false;
        if (x.d.ok || x.code === 409) {
          if (x.d.ok) save(ballot);
          status.voted = true;
          return render();
        }
        btn.disabled = false;
        msg.textContent = x.d.error === 'closed' ? '投票は締め切られました。' : '送信できませんでした。少し待ってからもう一度お試しください。';
      })
      .catch(function () { sending = false; btn.disabled = false; msg.textContent = '送信できませんでした。通信を確認してもう一度お試しください。'; });
  }
  function render() {
    if (status && status.results) return renderResult();
    if (status && (status.voted || !status.open)) return renderVoted();
    var y = window.scrollY;
    renderVote();
    window.scrollTo(0, y);
  }
  function load() {
    Promise.all([
      fetch(base + 'assets/senkyo.json?v=' + encodeURIComponent(window.PBERS_UPDATED || '')).then(function (r) { return r.json(); }),
      fetch(base + 'assets/senkyo_geo.json').then(function (r) { return r.json(); }),
      fetch(api + '/status', adminKey ? { headers: { 'X-Board-Key': adminKey } } : {}).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (a) {
      cfg = a[0]; geo = a[1]; status = a[2];
      render();
    }).catch(function () { host.innerHTML = '<p class="sk-empty">読み込めませんでした。時間をおいて開き直してください。</p>'; });
  }
  function retryImg(e) {   // 画像サーバーの回数制限(429)などで失敗したら、間隔を空けて読み直す
    var el = e.target, tag = el.tagName && el.tagName.toLowerCase();
    if (tag !== 'img' && tag !== 'image') return;
    var n = +(el.dataset.retry || 0), src = el.getAttribute(tag === 'img' ? 'src' : 'href');
    el.style.visibility = 'hidden';
    if (n >= 4 || !src) return;
    el.dataset.retry = n + 1;
    el.onload = function () { el.style.visibility = ''; };
    setTimeout(function () { el.setAttribute(tag === 'img' ? 'src' : 'href', src); }, 1500 * Math.pow(2, n) + Math.random() * 1000);
  }
  window.PBERS_SENKYO = {
    mount: function (el, boardApi, gbase, boardKey) {
      base = gbase || '/';
      adminKey = boardKey || '';
      api = String(boardApi || '').replace(/\/api\/board$/, '/api/senkyo');
      if (host === el && cfg) return;
      host = el;
      el.addEventListener('error', retryImg, true);   // error はバブリングしないのでキャプチャで拾う
      el.innerHTML = '<p class="sk-empty">読み込み中…</p>';
      load();
    }
  };
})();
