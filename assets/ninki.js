/* PBers人気投票。日本版と海外版の全チャンネルから好きな人を選んで入れる。
   候補は assets/ninki.json(gen_data.py が生成)。投票と開票は Worker の /api/ninki。
   票は投票から少し時間をおいて順に開票され、結果は誰でもいつでも見られる。 */
(function () {
  var DONE_KEY = 'pbers_ninki_vote', SEEN_KEY = 'pbers_ninki_seen';
  var PIN_THREAD = 646;   // 開票速報の一番下に固定する掲示板のスレ
  var JUMP_MIN_VOTES = 3, JUMP_SHOWN = 8;   // 躍進ランキングに載せる最低票数と行数
  var VER = ((document.currentScript && document.currentScript.src) || '').split('v=')[1] || '';
  var WANT = new URLSearchParams(location.search).get('c');   // 画面の切り替えでURLから消えるので、読み込みの時点で覚える
  var WANT_RESULT = location.hash === '#kaihyo';
  var root = null, host = null, cfg = null, status = null, api = '', boardBase = '', mode = 'vote';
  var picks = [], query = '', filter = 'all', sending = false, edView = 'all';
  var tiles = {}, shuffled = null;
  var result = null, resultError = false, rows = {}, showAll = false, timer = null, fetching = false, nextAt = 0;
  var ICON_SEARCH = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="M13.2 13.2 17 17"/></svg>';
  var ICON_CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>';
  var ICON_X = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4 12 12M12 4 4 12"/></svg>';

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cand(id) { return cfg.candidates.filter(function (c) { return c.id === id; })[0]; }
  function dateText(ms) { var d = new Date(ms + 9 * 3600e3); return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日'; }
  function clockText(ms) { var d = new Date(ms + 9 * 3600e3); return d.getUTCHours() + ':' + ('0' + d.getUTCMinutes()).slice(-2); }
  function subsText(n) { return !n ? '' : n >= 10000 ? (Math.round(n / 1000) / 10) + '万人' : n.toLocaleString('ja-JP') + '人'; }
  function closed() { return Date.now() >= (status ? status.closes : cfg.closes); }
  /* 探しやすくする。全角半角、大文字小文字、カタカナとひらがな、記号の違いを無視する */
  function norm(s) {
    return String(s).normalize('NFKC').toLowerCase()
      .replace(/[À-ɏ]/g, function (c) { return c.normalize('NFD').charAt(0); })
      .replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); })
      .replace(/[^\p{L}\p{N}ー]/gu, '');
  }
  function readJson(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function writeJson(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
  function saved() { var v = readJson(DONE_KEY); return Array.isArray(v) ? v : null; }
  function avatar(c, size) {
    return c.avatar ? '<img src="' + esc(c.avatar) + '" alt="" width="' + size + '" height="' + size + '" referrerpolicy="no-referrer" decoding="async">' : '';
  }

  /* ---- 投票画面 ---- */
  function count(ed) { return cfg.candidates.filter(function (c) { return !ed || c.ed === ed; }).length; }
  function renderVote() {
    host.innerHTML =
      '<p class="nk-lead">好きなPBerを<b>' + cfg.max + '組まで</b>選んでください。日本も海外も選べます。</p>' +
      '<p class="nk-sub">' + (status ? dateText(status.closes - 1) + 'まで。同じ回線からは1回だけ投票できます。並びは見るたびに変わります。' : '投票の受付を準備中です。候補は見られます。') + '</p>' +
      '<div class="nk-search"><span class="nk-search-i">' + ICON_SEARCH + '</span>' +
        '<input type="search" id="nk-q" placeholder="チャンネル名で探す(ひらがなでも)" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="チャンネル名で探す"></div>' +
      '<div class="nk-tools">' +
        '<div class="nk-seg" role="group" aria-label="絞り込み">' + [['all', 'すべて', ''], ['jp', '日本', 'jp'], ['global', '海外', 'global']].map(function (f) {
          return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (filter === f[0]) + '">' + f[1] + ' <span class="num">' + count(f[2]) + '</span></button>';
        }).join('') + '</div>' +
      '</div>' +
      '<p class="nk-count" id="nk-count" aria-live="polite"></p>' +
      '<div class="nk-grid" id="nk-grid"></div>' +
      '<div class="nk-tray" id="nk-tray"></div>' +
      foot();
    var grid = host.querySelector('#nk-grid');
    tiles = {};
    grid.innerHTML = randomOrder().map(function (c) {
      return '<button type="button" class="nk-t" data-id="' + esc(c.id) + '" aria-pressed="false">' +
        '<span class="nk-av">' + (c.avatar ? '<img data-src="' + esc(c.avatar) + '" alt="" width="64" height="64" decoding="async">' : '') + '<span class="nk-ck">' + ICON_CHECK + '</span></span>' +
        '<span class="nk-n">' + esc(c.name) + '</span><span class="nk-s num">' + subsText(c.subs) + '</span></button>';
    }).join('');
    [].slice.call(grid.children).forEach(function (el) { tiles[el.dataset.id] = el; });
    watchImages(grid);
    wireVote();
    applyFilter();
    syncPicks();
  }
  function foot() {
    return '<p class="nk-note">投票で記録するのは、回線から作った照合用の値と選んだチャンネルだけです。IPアドレスそのものや出身は使いません。票は投票から時間をおいて順に開票するので、誰がどこに入れたかは結果からも分かりません。</p>';
  }
  function randomOrder() {   // 表示順で票が偏らないよう、開くたびに順番を変える
    var list = cfg.candidates.slice();
    if (!shuffled) {
      shuffled = {};
      list.forEach(function (c) { shuffled[c.id] = Math.random(); });
    }
    return list.sort(function (a, b) { return shuffled[a.id] - shuffled[b.id]; });
  }
  function hits() {
    var q = norm(query);
    return randomOrder().filter(function (c) {
      return (filter === 'all' || c.ed === filter) && (!q || c.key.indexOf(q) >= 0);
    });
  }
  function applyFilter() {
    var list = hits(), on = {};
    list.forEach(function (c) { on[c.id] = true; });
    Object.keys(tiles).forEach(function (id) { tiles[id].hidden = !on[id]; });
    var el = host.querySelector('#nk-count');
    el.textContent = list.length ? (query ? list.length + '組' : '') : (query ? '「' + query + '」は見つかりませんでした。短い言葉で探すか、絞り込みを「すべて」にしてみてください。' : '該当するチャンネルはありません。');
    el.classList.toggle('none', !list.length);
  }
  function syncPicks(note) {
    Object.keys(tiles).forEach(function (id) {
      var on = picks.indexOf(id) >= 0;
      tiles[id].classList.toggle('on', on);
      tiles[id].setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var open = status && status.open, slots = '';
    for (var i = 0; i < cfg.max; i++) {
      var c = picks[i] && cand(picks[i]);
      slots += c
        ? '<button type="button" class="nk-slot" data-rm="' + esc(c.id) + '" aria-label="' + esc(c.name) + 'を外す"><span class="nk-slot-av">' + avatar(c, 40) + '<span class="nk-slot-x">' + ICON_X + '</span></span><span class="nk-slot-n">' + esc(c.name) + '</span></button>'
        : '<span class="nk-slot empty" aria-hidden="true"><span class="nk-slot-av"></span></span>';
    }
    var tray = host.querySelector('#nk-tray');
    tray.innerHTML = '<div class="nk-slots">' + slots + '</div>' +
      '<div class="nk-go"><button type="button" class="g-btn nk-send"' + (picks.length && open && !sending ? '' : ' disabled') + '>' +
        (sending ? '送信中…' : picks.length ? picks.length + '組に投票する' : '投票する') + '</button>' +
      '<span class="nk-msg' + (note || picks.length ? '' : ' hint') + '" id="nk-msg" aria-live="polite">' + esc(note || (picks.length ? '' : '上から選んでください')) + '</span></div>';
  }
  function toggle(id) {
    var i = picks.indexOf(id);
    if (i >= 0) { picks.splice(i, 1); return syncPicks(); }
    if (picks.length >= cfg.max) return syncPicks(cfg.max + '組まで選べます。下のアイコンで外してから選び直してください。');
    picks.push(id);
    syncPicks();
  }
  function wireVote() {
    var input = host.querySelector('#nk-q'), search = host.querySelector('.nk-search');
    input.addEventListener('input', function () {
      query = input.value;
      applyFilter();
      // 下まで見ていても、探した結果がすぐ見えるように一覧の先頭へ戻す
      var top = search.getBoundingClientRect().top + window.scrollY - stickyTop();
      if (window.scrollY > top + 1) window.scrollTo(0, top);
    });
    input.addEventListener('keydown', function (e) {
      if (e.isComposing) return;
      if (e.key === 'Escape') { input.value = query = ''; applyFilter(); }
      if (e.key === 'Enter') {
        e.preventDefault();
        var list = hits();
        if (list.length === 1) { toggle(list[0].id); input.value = query = ''; applyFilter(); }   // 1組に絞れたらEnterで選ぶ
      }
    });
    host.querySelector('.nk-seg').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      filter = b.dataset.f;
      [].slice.call(host.querySelectorAll('.nk-seg button')).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      applyFilter();
    });
    host.querySelector('#nk-grid').addEventListener('click', function (e) {
      var t = e.target.closest('.nk-t');
      if (t) toggle(t.dataset.id);
    });
    host.querySelector('#nk-tray').addEventListener('click', function (e) {
      var rm = e.target.closest('[data-rm]');
      if (rm) return toggle(rm.dataset.rm);
      if (e.target.closest('.nk-send')) send();
    });
  }
  function stickyTop() { return parseFloat(getComputedStyle(host.querySelector('.nk-search')).top) || 0; }
  function send() {
    if (sending || !picks.length || !status || !status.open) return;
    sending = true;
    syncPicks();
    fetch(api + '/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ picks: picks }) })
      .then(function (r) { return r.json().then(function (d) { return { code: r.status, d: d }; }); })
      .then(function (x) {
        sending = false;
        if (x.d.ok) { writeJson(DONE_KEY, picks.slice()); status.voted = true; window.scrollTo(0, 0); return render(); }
        if (x.code === 409) { status.voted = true; window.scrollTo(0, 0); return render(); }
        syncPicks(x.d.error === 'closed' ? '投票は締め切られました。' : x.d.error === 'banned' ? 'この回線からは投票できません。' : '送信できませんでした。少し待ってからもう一度お試しください。');
      })
      .catch(function () { sending = false; syncPicks('送信できませんでした。通信を確認してもう一度お試しください。'); });
  }
  function renderDone() {
    var mine = (saved() || []).map(cand).filter(Boolean);
    host.innerHTML =
      '<h3 class="nk-done">' + (mine.length ? '投票しました' : 'この回線からは投票済みです') + '</h3>' +
      '<p class="nk-sub">' + (mine.length ? 'あなたの票は、5分から30分ほどで開票されます。' : '同じ回線では1回だけ投票できます。') + '</p>' +
      (mine.length ? '<ul class="nk-mine">' + mine.map(function (c) { return '<li>' + avatar(c, 40) + '<b>' + esc(c.name) + '</b></li>'; }).join('') + '</ul>' : '') +
      '<button type="button" class="g-btn nk-toresult" data-mode="kaihyo">開票速報を見る</button>' +
      foot();
  }

  /* ---- 開票速報 ---- */
  /* サーバーの集計に同じ人のまとめを当て、順位を付ける。同数は同じ順位で、並びはIDの順にして誰が見ても同じにする */
  function ranking(r, everyone) {   // 順位は選んでいる区分(総合、国内向け、海外向け)の中で付ける
    var n = {};
    (r.cands || []).forEach(function (x) {
      var id = (cfg.alias && cfg.alias[x.cand]) || x.cand;
      n[id] = (n[id] || 0) + x.n;
    });
    var list = cfg.candidates.filter(function (c) { return n[c.id] && (everyone || edView === 'all' || c.ed === edView); }).map(function (c) { return { c: c, n: n[c.id] }; })
      .sort(function (a, b) { return b.n - a.n || (a.c.id < b.c.id ? -1 : 1); });
    var last = -1, rank = 0;
    list.forEach(function (x, i) {
      if (x.n !== last) { rank = i + 1; last = x.n; }
      x.rank = rank;
    });
    return list;
  }
  function resultState(r) {
    if (r.open) return '開票中・投票受付中';
    return r.total > r.counted ? '投票終了・開票中' : '開票終了';
  }
  function renderResult() {
    rows = {};
    host.innerHTML = '<div class="kh" id="kh"></div>';
    var box = host.querySelector('#kh');
    if (!result) {
      box.innerHTML = '<p class="kh-empty">' + (resultError ? '開票速報を読み込めませんでした。時間をおいて開き直してください。' : '読み込んでいます…') + '</p>';
      return;
    }
    box.innerHTML =
      '<div class="controls kh-controls"><div class="toggle" id="kh-edview" role="group" aria-label="順位の区分">' + [['all', '総合'], ['jp', '国内向け'], ['global', '海外向け']].map(function (v) {
        return '<button type="button" class="tg' + (edView === v[0] ? ' on' : '') + '" data-ed="' + v[0] + '" aria-pressed="' + (edView === v[0]) + '">' + v[1] + '</button>';
      }).join('') + '<span class="tg-ind"></span></div></div>' +
      '<div class="kh-cols"><div class="kh-left"><header class="kh-board">' +
        '<div class="kh-title"><h3>開票速報</h3><p class="kh-state" id="kh-state"></p></div>' +
        '<div class="kh-rate"><span class="kh-rate-v num"><b id="kh-rate">0</b>%</span><span class="kh-rate-k">開票率</span></div>' +
        '<div class="kh-meter" aria-hidden="true"><i id="kh-meter"></i></div>' +
        '<p class="kh-nums num" id="kh-nums"></p>' +
      '</header>' +
      '<ol class="kh-list" id="kh-list"></ol>' +
      '<button type="button" class="kh-more" id="kh-more" hidden></button></div>' +
      '<aside class="kh-side"><h3>躍進ランキング</h3><p class="kh-side-d">登録者1万人あたりの票が多い順です。票が' + JUMP_MIN_VOTES + '票以上の人だけを、開票済みの票で比べています。</p><ol class="kh-jump" id="kh-jump"></ol></aside></div>' +
      '<section class="kh-trend"><div class="sec-head"><h2>投票数の推移 <span class="en">History</span></h2><span class="note" id="kh-trend-note"></span></div>' +
        '<div class="controls kh-controls"><div class="toggle" id="kh-chartview" role="group" aria-label="グラフの切り替え"><button type="button" class="tg' + (chartView === 'top' ? ' on' : '') + '" data-v="top">上位10組</button><button type="button" class="tg' + (chartView === 'total' ? ' on' : '') + '" data-v="total">全体</button><span class="tg-ind"></span></div></div>' +
        '<div class="trend"><div class="t-empty" id="kh-trend-empty" hidden>開票が始まると、ここにグラフが出ます。</div>' +
        '<div id="kh-trend-body"><div class="kh-legend" id="kh-legend"></div>' +
        '<div class="kh-plot" id="kh-plot" role="img" tabindex="0"><div id="kh-svgbox"></div><div class="kh-tip" id="kh-tip" hidden></div></div></div></div>' +
        '<div class="ch-nums-wrap" id="kh-numswrap"><button type="button" class="ch-nums-btn" id="kh-numsbtn">' + (numsOpen ? '数値を隠す ▴' : '数値で見る ▾') + '</button><div class="ch-nums" id="kh-table"' + (numsOpen ? '' : ' hidden') + '></div></div></section>' +
      '<p class="nk-note">投票から5分〜30分ほどで順に開票し、結果は5分ごとに更新します。国内向けは日本版、海外向けは海外版に載っているチャンネルです。開票率と投票した人の数は全体の数字です。</p>' +
      '<section class="kh-pin" id="kh-pin" hidden><h4>掲示板</h4><div id="kh-pin-body"></div></section>';
    box.querySelector('#kh-more').addEventListener('click', function () {
      showAll = !showAll;
      drawResult(false);
    });
    box.querySelector('#kh-edview').addEventListener('click', function (e) {
      var b = e.target.closest('.tg');
      if (!b || b.dataset.ed === edView) return;
      edView = b.dataset.ed;
      [].slice.call(box.querySelectorAll('#kh-edview .tg')).forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      showAll = false;
      rows = {};
      chartIdx = -1;
      box.querySelector('#kh-list').innerHTML = '';
      drawResult(true, true);
    });
    wireChart();
    drawResult(true);
    drawPin();
  }
  function drawPin() {   // スレの題名とレス数は掲示板から読む。スレが消えていたら出さない。掲示板は日本版にだけあるので、海外版からも日本版へ飛ばす
    if (!boardBase) return;
    fetch(boardBase + '/threads?ids=' + PIN_THREAD).then(function (r) { return r.json(); }).then(function (d) {
      var t = (d.threads || [])[0], sec = host.querySelector('#kh-pin');
      if (!t || !sec) return;
      sec.querySelector('#kh-pin-body').innerHTML = '<a class="db-item" href="/board/?t=' + t.id + '"><span class="db-title">' + esc(t.title) + '</span><span class="db-meta"><span class="num">' + t.posts + '</span> レス</span></a>';
      sec.hidden = false;
    }).catch(function () {});
  }
  function drawResult(first, switched) {   // switched は区分を切り替えたとき。上の開票率は動かさない
    var r = result, box = host.querySelector('#kh');
    if (!box || !r || !host.querySelector('#kh-list')) return;
    var list = ranking(r), rate = r.total ? Math.floor(r.counted / r.total * 1000) / 10 : 0;
    var seen = readJson(SEEN_KEY) || {}, olist = host.querySelector('#kh-list'), shown = cfg.top;
    host.querySelector('#kh-state').textContent = resultState(r);
    tween(host.querySelector('#kh-rate'), first && !switched ? 0 : +host.querySelector('#kh-rate').textContent, rate, first ? 900 : 500, 1);
    host.querySelector('#kh-meter').style.width = rate + '%';
    host.querySelector('#kh-nums').innerHTML = '<span>投票した人 <b>' + r.total + '</b>人</span><span>開票済み <b>' + r.counted + '</b>人</span><span id="kh-next"></span>';
    tick();

    // 順位が変わった行を動かすため、書き換える前の位置を覚える
    var before = {};
    Object.keys(rows).forEach(function (id) { before[id] = rows[id].el.getBoundingClientRect().top; });
    var keep = {};
    if (!list.length) {
      olist.innerHTML = '<li class="kh-none">' + (r.counted ? 'この区分には、まだ開票された票がありません。' : 'まだ開票された票はありません。投票から5分ほどで最初の票が開きます。') + '</li>';
      rows = {};
    } else {
      var empty = olist.querySelector('.kh-none');
      if (empty) empty.remove();
      var top = list[0].n;
      list.forEach(function (x, i) {
        var id = x.c.id, row = rows[id];
        if (!row) {
          var li = document.createElement('li');
          li.className = 'kh-row';
          li.innerHTML = '<span class="kh-r num"></span><span class="kh-av">' + avatar(x.c, 48) + '</span>' +
            '<span class="kh-main"><span class="kh-n">' + esc(x.c.name) + '</span><span class="kh-bar"><i></i></span></span>' +
            '<span class="kh-v"><b class="num">0</b><small>票</small><span class="kh-d num"></span></span>';
          row = rows[id] = { el: li, n: 0 };
        }
        keep[id] = true;
        var el = row.el;
        el.hidden = i >= shown && !showAll;   // 同数が多くても、先に見せる行数は増やさない
        el.classList.toggle('lead', x.rank === 1);
        olist.appendChild(el);
        el.querySelector('.kh-r').textContent = x.rank;
        el.querySelector('.kh-bar i').style.width = Math.max(2, x.n / top * 100) + '%';
        tween(el.querySelector('.kh-v b'), first ? 0 : row.n, x.n, first ? 800 + Math.min(i, 12) * 40 : 700, 0);
        var diff = switched ? 0 : first ? (seen[id] === undefined || !seen.at ? 0 : x.n - seen[id]) : x.n - row.n;
        var d = el.querySelector('.kh-d');
        if (diff > 0) { d.textContent = '+' + diff; d.classList.remove('pop'); void d.offsetWidth; d.classList.add('pop'); }
        else if (first) d.textContent = '';
        row.n = x.n;
      });
      Object.keys(rows).forEach(function (id) {
        if (!keep[id]) { rows[id].el.remove(); delete rows[id]; }
      });
      if (!first) flip(before);
    }
    var hiddenCount = Math.max(0, list.length - shown), more = host.querySelector('#kh-more');
    more.hidden = !hiddenCount;
    more.textContent = showAll ? '上位だけ見る' : 'ほかの' + hiddenCount + '組も見る';
    var snap = { at: r.at };
    ranking(r, true).forEach(function (x) { snap[x.c.id] = x.n; });   // 前回との差は区分に関係なく覚える
    writeJson(SEEN_KEY, snap);
    drawJump(list);
    drawChart(first);
  }

  /* ---- 投票数の推移。開票した時刻で積み上げた折れ線 ---- */
  var chartView = 'top', chartModel = null, chartIdx = -1, chartRO = null, numsOpen = false;
  var CHART_TOP = 10;
  function cumulative(xs, pairs, step, at) {   // pairs は時刻の順。区切りが終わった分までを足し上げる
    var i = 0, sum = 0;
    return xs.map(function (x) {
      while (i < pairs.length && (x === at || pairs[i][0] + step <= x)) { sum += pairs[i][1]; i++; }
      return sum;
    });
  }
  function buildChart(r) {
    var t = r.trend;
    if (!t || !t.people || !t.people.length) return null;
    var step = t.step, first = t.people[0][0], at = r.at, xs = [first];
    for (var x = first + step; x < at; x += step) xs.push(x);
    if (at > first) xs.push(at); else xs.unshift(first - step);
    if (chartView === 'total') {
      return { xs: xs, unit: '人', series: [{ id: 'all', name: '開票済みの人数', color: 'var(--sall)', ys: cumulative(xs, t.people, step, at) }] };
    }
    var top = ranking(r).slice(0, CHART_TOP), by = {};
    if (!top.length) return null;
    (t.cands || []).forEach(function (row) {
      var id = (cfg.alias && cfg.alias[row[1]]) || row[1];
      (by[id] = by[id] || []).push([row[0], row[2]]);
    });
    var done = cumulative(xs, t.people, step, at), all = done[done.length - 1] || 1;
    return { xs: xs, unit: '票', small: true, progress: done.map(function (v) { return v / all; }), series: top.map(function (x) {
      return { id: x.c.id, name: x.c.name, rank: x.rank, color: x.c.color || 'var(--sall)', ys: cumulative(xs, by[x.c.id] || [], step, at) };
    }) };
  }
  function niceHalf(top) {   // 0、真ん中、上の3本の線が整数になるように、真ん中の値を選ぶ
    var half = Math.max(1, top / 2), base = Math.pow(10, Math.floor(Math.log10(half)));
    return [1, 2, 5, 10].map(function (m) { return m * base; }).filter(function (v) { return v >= 1 && v >= half; })[0];
  }
  function xLabel(v, days) {
    var d = new Date(v + 9 * 3600e3), H = d.getUTCHours(), M = d.getUTCMinutes();
    if (days || (!H && !M)) return (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
    return H + ':' + ('0' + M).slice(-2);
  }
  function fullTime(v) { var d = new Date(v + 9 * 3600e3); return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日 ' + clockText(v); }
  function moveToggle() {
    ['#kh-edview', '#kh-chartview'].forEach(function (sel) {
      var on = host.querySelector(sel + ' .tg.on'), ind = host.querySelector(sel + ' .tg-ind');
      if (on && ind) { ind.style.left = on.offsetLeft + 'px'; ind.style.width = on.offsetWidth + 'px'; }
    });
  }
  function drawChart(animate) {
    var box = host.querySelector('#kh-plot');
    if (!box || !result) return;
    moveToggle();
    chartModel = buildChart(result);
    host.querySelector('#kh-trend-note').textContent = chartView === 'total' ? '開票した時刻で集計' : '開票が進む順に表示';
    var legend = host.querySelector('#kh-legend'), wrap = host.querySelector('#kh-trend-body'), m = chartModel;
    wrap.hidden = !m;
    host.querySelector('#kh-trend-empty').hidden = !!m;
    host.querySelector('#kh-numswrap').hidden = !m;
    if (!m) return;
    var w = box.clientWidth;
    if (!w) return;
    if (m.small) return drawSmall(m, box, legend, w, animate);
    legend.classList.remove('kh-rangebox');
    var Hh = 240, L = 54, R = 16, T = 18, B = 30, pw = w - L - R, ph = Hh - T - B;
    var xs = m.xs, n = xs.length, x0 = xs[0], x1 = xs[n - 1], top = 0, lead = m.series[0];
    m.series.forEach(function (s) { s.ys.forEach(function (v) { if (v > top) top = v; }); if (s.ys[n - 1] > lead.ys[n - 1]) lead = s; });
    var half = niceHalf(top), yMax = half * 2;
    var sx = function (v) { return L + (x1 === x0 ? 0 : (v - x0) / (x1 - x0)) * pw; }, sy = function (v) { return T + ph * (1 - v / yMax); };
    m.sx = sx; m.sy = sy; m.T = T; m.ph = ph; m.w = w;
    var grid = '', labels = '';
    [yMax, half, 0].forEach(function (v) {
      grid += '<line class="t-grid" x1="' + L + '" y1="' + sy(v) + '" x2="' + (w - R) + '" y2="' + sy(v) + '"/>';
      labels += '<text class="t-axis" x="' + (L - 8) + '" y="' + (sy(v) + 4) + '" text-anchor="end">' + v + '</text>';
    });
    // 横軸は最初と最後を必ず出す。最後の直前の目盛りは重なるので省く
    var room = w < 520 ? 3 : 6, every = Math.max(1, Math.ceil((n - 1) / room)), days = x1 - x0 >= 48 * 3600e3;
    for (var k = 0; k < n; k++) {
      if (k !== n - 1 && (k % every !== 0 || (n - 1 - k < every * 0.6 && k !== 0))) continue;
      var a = k === 0 ? 'start' : k === n - 1 ? 'end' : 'middle';
      labels += '<text class="t-axis" x="' + sx(xs[k]) + '" y="' + (Hh - 10) + '" text-anchor="' + a + '">' + xLabel(xs[k], days) + '</text>';
    }
    var lines = '', dots = '', showAll = pw / Math.max(1, n - 1) >= 8;   // 点が詰まるときは最後だけ打つ
    m.series.forEach(function (s) {
      var d = s.ys.map(function (v, i) { return (i ? ' L' : 'M') + sx(xs[i]).toFixed(1) + ',' + sy(v).toFixed(1); }).join('');
      lines += '<path class="t-line kh-line' + (animate ? ' draw' : '') + '" style="stroke:' + s.color + '" pathLength="1" d="' + d + '"/>';
      s.ys.forEach(function (v, i) {
        if (showAll || i === n - 1) dots += '<circle class="t-dot" style="fill:' + s.color + '" r="3.5" cx="' + sx(xs[i]).toFixed(1) + '" cy="' + sy(v).toFixed(1) + '"/>';
      });
    });
    var last = '<text class="t-val" x="' + sx(x1) + '" y="' + (sy(lead.ys[n - 1]) - 9) + '" text-anchor="end">' + lead.ys[n - 1] + m.unit + '</text>';
    box.querySelector('#kh-svgbox').innerHTML = '<svg width="' + w + '" height="' + Hh + '" viewBox="0 0 ' + w + ' ' + Hh + '" aria-hidden="true">' + grid + labels + lines + dots + last +
      '<g class="kh-hover" id="kh-hover" visibility="hidden"><line class="kh-cross" y1="' + T + '" y2="' + (T + ph) + '"/>' +
      m.series.map(function (s) { return '<circle class="t-dot kh-pt" style="fill:' + s.color + '" r="4.5"/>'; }).join('') + '</g></svg>';
    legend.hidden = m.series.length < 2;
    legend.innerHTML = m.series.map(function (s) { return '<span class="kh-key"><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>'; }).join('');
    box.setAttribute('aria-label', '投票数の推移。' + m.series.map(function (s) { return s.name + ' ' + s.ys[n - 1] + m.unit; }).join('、'));
    if (numsOpen) drawTable(m);
    if (chartIdx >= 0) showPoint(Math.min(chartIdx, n - 1)); else hidePoint();
  }
  /* 上位の組を1組ずつの小さなグラフに分ける。重ならず、目盛りは全員同じなので高さをそのまま比べられる */
  function toneClass(hex) {   // 背景に溶ける色のチャンネルは、溶けるテーマのときだけ線を濃くする
    if (hex.charAt(0) !== '#') return '';
    var c = function (i) { return parseInt(hex.substr(i, 2), 16) / 255; };
    var lum = 0.2126 * c(1) + 0.7152 * c(3) + 0.0722 * c(5);
    return lum > 0.8 ? ' pale' : lum < 0.12 ? ' deep' : '';
  }
  function drawSmall(m, box, legend, w, animate) {
    var cols = w >= 640 ? 2 : 1, gap = 28, cw = Math.floor((w - gap * (cols - 1)) / cols), H = 66, T = 6, B = 3;
    var xs = m.xs, n = xs.length, x0 = xs[0], x1 = xs[n - 1], top = 1;
    m.series.forEach(function (s) { s.ys.forEach(function (v) { if (v > top) top = v; }); });
    var ph = H - T - B;
    m.top = top;
    // 横は時刻ではなく開票の進み。票が少ない時間帯で線が平らに伸びず、開票のどの辺りで伸びたかが見える
    var px = {};
    xs.forEach(function (v, i) { px[v] = 4 + m.progress[i] * (cw - 10); });
    m.sx = function (v) { return px[v]; };
    m.sy = function (v) { return T + ph * (1 - v / top); };
    box.querySelector('#kh-svgbox').innerHTML = '<div class="kh-sms" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr));column-gap:' + gap + 'px">' + m.series.map(function (s) {
      var pts = [];
      s.ys.forEach(function (v, i) { if (!i || m.progress[i] !== m.progress[i - 1]) pts.push(m.sx(xs[i]).toFixed(1) + ',' + m.sy(v).toFixed(1)); });   // 開票が進まなかった区切りは省く
      var area = 'M' + m.sx(x0).toFixed(1) + ',' + m.sy(0).toFixed(1) + ' L' + pts.join(' L') + ' L' + m.sx(x1).toFixed(1) + ',' + m.sy(0).toFixed(1) + ' Z';
      return '<div class="kh-sm' + toneClass(s.color) + '"><div class="kh-sm-h"><span class="kh-sm-r num">' + s.rank + '</span><span class="kh-sm-n">' + esc(s.name) + '</span><span class="kh-sm-v"><b class="num">' + s.ys[n - 1] + '</b><small>票</small></span></div>' +
        '<svg width="' + cw + '" height="' + H + '" viewBox="0 0 ' + cw + ' ' + H + '" aria-hidden="true">' +
        '<line class="t-grid" x1="0" x2="' + cw + '" y1="' + m.sy(top / 2) + '" y2="' + m.sy(top / 2) + '"/><line class="t-grid" x1="0" x2="' + cw + '" y1="' + m.sy(0) + '" y2="' + m.sy(0) + '"/>' +
        '<path class="kh-area' + (animate ? ' fade' : '') + '" style="fill:' + s.color + '" d="' + area + '"/>' +
        '<path class="t-line kh-line' + (animate ? ' draw' : '') + '" style="stroke:' + s.color + '" pathLength="1" d="M' + pts.join(' L') + '"/>' +
        '<circle class="t-dot" style="fill:' + s.color + '" r="3.5" cx="' + m.sx(x1).toFixed(1) + '" cy="' + m.sy(s.ys[n - 1]).toFixed(1) + '"/>' +
        '<g class="kh-sm-hover" visibility="hidden"><line class="kh-cross" y1="' + T + '" y2="' + (T + ph) + '"/><circle class="t-dot kh-pt" style="fill:' + s.color + '" r="4.5"/></g></svg></div>';
    }).join('') + '</div>';
    legend.hidden = false;
    legend.classList.add('kh-rangebox');
    legend.innerHTML = '<span class="kh-range num" id="kh-range"></span>';
    host.querySelector('#kh-tip').hidden = true;
    box.setAttribute('aria-label', '投票数の推移。' + m.series.map(function (s) { return s.rank + '位 ' + s.name + ' ' + s.ys[n - 1] + '票'; }).join('、'));
    if (numsOpen) drawTable(m);
    if (chartIdx >= 0) showPoint(Math.min(chartIdx, n - 1)); else hidePoint();
  }
  function drawTable(m) {   // チャンネルページと同じ、新しい順の表
    var rows = m.xs.map(function (x, i) { return i; }).reverse().slice(0, 96);
    host.querySelector('#kh-table').innerHTML = '<table class="ch-table"><thead><tr><th>時刻</th>' + m.series.map(function (s) { return '<th>' + esc(s.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (i) { return '<tr><td>' + fullTime(m.xs[i]) + '</td>' + m.series.map(function (s) { return '<td class="num">' + s.ys[i] + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }
  function showPoint(i) {
    var m = chartModel, g = host.querySelector('#kh-hover'), tip = host.querySelector('#kh-tip');
    if (m && m.small) {   // どのグラフに触れても、全員の同じ時刻を出す
      chartIdx = i;
      [].slice.call(host.querySelectorAll('.kh-sm')).forEach(function (el, k) {
        var s = m.series[k], x = m.sx(m.xs[i]), h = el.querySelector('.kh-sm-hover'), c = el.querySelector('.kh-cross'), pt = el.querySelector('.kh-pt');
        c.setAttribute('x1', x); c.setAttribute('x2', x);
        pt.setAttribute('cx', x); pt.setAttribute('cy', m.sy(s.ys[i]));
        h.setAttribute('visibility', 'visible');
        el.querySelector('.kh-sm-v b').textContent = s.ys[i];
      });
      host.querySelector('#kh-range').textContent = fullTime(m.xs[i]) + ' 時点の票数(開票の' + Math.round(m.progress[i] * 100) + '%まで)';
      return;
    }
    if (!m || !g || !tip) return;
    chartIdx = i;
    var x = m.sx(m.xs[i]), cross = g.querySelector('.kh-cross');
    cross.setAttribute('x1', x); cross.setAttribute('x2', x);
    [].slice.call(g.querySelectorAll('.kh-pt')).forEach(function (c, k) { c.setAttribute('cx', x); c.setAttribute('cy', m.sy(m.series[k].ys[i])); });
    g.setAttribute('visibility', 'visible');
    var order = m.series.slice().sort(function (a, b) { return b.ys[i] - a.ys[i]; });
    tip.innerHTML = '<div class="kh-tip-t num">' + fullTime(m.xs[i]) + '</div>' + order.map(function (s) {
      return '<div class="kh-tip-r"><i style="background:' + s.color + '"></i><span>' + esc(s.name) + '</span><b class="num">' + s.ys[i] + m.unit + '</b></div>';
    }).join('');
    tip.hidden = false;
    var tw = tip.offsetWidth, left = x + 12;
    if (left + tw > m.w) left = x - tw - 12;
    tip.style.left = Math.max(0, left) + 'px';
  }
  function hidePoint() {
    chartIdx = -1;
    var mm = chartModel, range = host.querySelector('#kh-range');
    if (mm && mm.small && range) {
      var end = mm.xs.length - 1;
      [].slice.call(host.querySelectorAll('.kh-sm')).forEach(function (el, k) {
        el.querySelector('.kh-sm-hover').setAttribute('visibility', 'hidden');
        el.querySelector('.kh-sm-v b').textContent = mm.series[k].ys[end];
      });
      range.textContent = '左が開票の始め、右が今です。線が急なところほど、そのときの開票で票を集めています。全員同じ目盛りで、グラフの上が' + mm.top + '票です。';
      return;
    }
    var g = host.querySelector('#kh-hover'), tip = host.querySelector('#kh-tip');
    if (g) g.setAttribute('visibility', 'hidden');
    if (tip) tip.hidden = true;
  }
  function wireChart() {
    var plot = host.querySelector('#kh-plot');
    var near = function (e) {
      var m = chartModel;
      if (!m || !m.sx) return;
      var area = plot;
      if (m.small) {   // 小さなグラフは、触れている1枚を基準に時刻を選ぶ
        var one = e.target.closest && e.target.closest('.kh-sm');
        if (!one) return;
        area = one.querySelector('svg');
      }
      var px = e.clientX - area.getBoundingClientRect().left, best = 0, gap = Infinity;
      m.xs.forEach(function (v, i) { var d = Math.abs(m.sx(v) - px); if (d < gap) { gap = d; best = i; } });
      showPoint(best);
    };
    plot.addEventListener('pointermove', near);
    plot.addEventListener('pointerdown', near);
    plot.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') hidePoint(); });
    plot.addEventListener('blur', hidePoint);
    plot.addEventListener('keydown', function (e) {
      if (!chartModel) return;
      var n = chartModel.xs.length - 1, i = chartIdx < 0 ? n : chartIdx;
      if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
      else if (e.key === 'ArrowRight') i = Math.min(n, i + 1);
      else if (e.key === 'Escape') return hidePoint();
      else return;
      e.preventDefault();
      showPoint(i);
    });
    host.querySelector('#kh-chartview').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.dataset.v === chartView) return;
      chartView = b.dataset.v;
      [].slice.call(host.querySelectorAll('#kh-chartview .tg')).forEach(function (x) { x.classList.toggle('on', x === b); });
      chartIdx = -1;
      drawChart(true);
    });
    host.querySelector('#kh-numsbtn').addEventListener('click', function () {
      numsOpen = !numsOpen;
      this.textContent = numsOpen ? '数値を隠す ▴' : '数値で見る ▾';
      host.querySelector('#kh-table').hidden = !numsOpen;
      if (numsOpen && chartModel) drawTable(chartModel);
    });
    if (chartRO) chartRO.disconnect();
    if (window.ResizeObserver) {
      var lastW = plot.clientWidth;
      chartRO = new ResizeObserver(function () {
        if (plot.clientWidth === lastW) return;
        lastW = plot.clientWidth;
        drawChart(false);
      });
      chartRO.observe(plot);
    }
  }
  /* 躍進: 登録者1万人あたりの票。票が少ない人は1票で大きく動くので、一定の票が入った人だけを比べる */
  function drawJump(list) {
    var el = host.querySelector('#kh-jump');
    if (!el) return;
    var up = list.filter(function (x) { return x.n >= JUMP_MIN_VOTES && x.c.subs > 0; }).map(function (x) {
      return { c: x.c, n: x.n, rank: x.rank, per: x.n / (x.c.subs / 10000) };
    }).sort(function (a, b) { return b.per - a.per || b.n - a.n || (a.c.id < b.c.id ? -1 : 1); }).slice(0, JUMP_SHOWN);
    if (!up.length) { el.innerHTML = '<li class="kh-jump-none">開票が進むと、ここに出ます。</li>'; return; }
    el.innerHTML = up.map(function (x) {
      var per = x.per >= 100 ? Math.round(x.per) : Math.round(x.per * 10) / 10;
      return '<li class="kh-j"><span class="kh-av">' + avatar(x.c, 40) + '</span><span class="kh-j-main"><span class="kh-j-n">' + esc(x.c.name) + '</span>' +
        '<span class="kh-j-s num">投票' + x.rank + '位・' + x.n + '票</span><span class="kh-j-s num">登録者' + subsText(x.c.subs) + '</span></span><span class="kh-j-v"><b class="kh-j-up num">' + per + '</b><small>票</small></span></li>';
    }).join('');
  }
  function flip(before) {
    if (!document.documentElement.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    Object.keys(rows).forEach(function (id) {
      var el = rows[id].el;
      if (before[id] === undefined || el.hidden) return;
      var dy = before[id] - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 2) return;
      el.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.16,1,.3,1)' });
    });
  }
  function tween(el, from, to, ms, digits) {
    var fix = function (v) { return digits ? v.toFixed(digits) : String(Math.round(v)); };
    if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fix(to); return; }
    var t0 = performance.now();
    (function step(t) {
      var p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 4);
      el.textContent = fix(from + (to - from) * e);
      if (p < 1 && el.isConnected) requestAnimationFrame(step);
    })(t0);
  }
  function isFinal(r) { return r && !r.open && r.counted >= r.total && Date.now() >= r.closes; }
  function tick() {
    var el = host && host.querySelector('#kh-next');
    if (el && result) {
      if (isFinal(result)) el.textContent = '確定';
      else {
        var s = Math.max(0, Math.ceil((result.next - Date.now()) / 1000));
        el.innerHTML = clockText(result.at) + ' 更新・次の開票まで <b>' + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2) + '</b>';
      }
    }
    if (mode !== 'kaihyo' || !root || !root.offsetParent || document.hidden || !result || isFinal(result)) return;
    if (Date.now() >= nextAt) fetchResult();
  }
  function fetchResult() {
    if (fetching) return;
    fetching = true;
    return fetch(api + '/results').then(function (r) { if (!r.ok) throw new Error('results'); return r.json(); }).then(function (d) {
      fetching = false;
      resultError = false;
      var changed = !result || d.at !== result.at;
      var firstLoad = !result;
      result = d;
      nextAt = d.next + 2000 + Math.random() * 15000;   // 全員が同じ瞬間に取りに行かないよう、少しずらす
      if (mode !== 'kaihyo') return;
      if (firstLoad) renderResult();
      else if (changed) drawResult(false);
    }).catch(function () {
      fetching = false;
      resultError = true;
      nextAt = Date.now() + 60000;
      if (mode === 'kaihyo' && !result) renderResult();
    });
  }

  /* ---- 画面の切り替え ---- */
  function renderModes() {
    var bar = root.querySelector('.nk-modes');
    bar.hidden = closed();
    [].slice.call(bar.querySelectorAll('button')).forEach(function (b) {
      var on = b.dataset.mode === mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function setMode(m) {
    mode = m;
    try { history.replaceState(history.state, '', location.pathname + (m === 'kaihyo' ? '#kaihyo' : '')); } catch (e) {}
    render();
    if (m === 'kaihyo') { window.scrollTo(0, 0); fetchResult(); }
  }
  function render() {
    renderModes();
    if (mode === 'kaihyo') return renderResult();
    if (status && status.voted) return renderDone();
    renderVote();
  }

  /* 一覧のアイコンは、見えている分から少しずつ読む。一度に頼むと画像サーバーの回数制限で弾かれる */
  var imgQueue = [], imgActive = 0, IMG_MAX = 3;
  function pumpImages() {
    while (imgActive < IMG_MAX && imgQueue.length) startImage(imgQueue.shift());
  }
  function startImage(el) {
    imgActive++;
    var finish = function (ok) {
      el.onload = el.onerror = null;
      imgActive--;
      var n = +(el.dataset.retry || 0);
      if (!ok && n < 5) {
        el.dataset.retry = n + 1;
        setTimeout(function () { imgQueue.push(el); pumpImages(); }, 2000 * Math.pow(2, n) + Math.random() * 1000);
      }
      setTimeout(pumpImages, 60);
    };
    el.onload = function () { finish(true); };
    el.onerror = function () { finish(false); };
    el.referrerPolicy = 'no-referrer';
    el.setAttribute('src', el.dataset.src);
  }
  function watchImages(grid) {
    var list = [].slice.call(grid.querySelectorAll('.nk-t'));
    if (!('IntersectionObserver' in window)) { list.forEach(function (t) { var i = t.querySelector('img'); if (i) imgQueue.push(i); }); return pumpImages(); }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (x) {
        if (!x.isIntersecting) return;
        io.unobserve(x.target);
        var i = x.target.querySelector('img');
        if (i) imgQueue.push(i);
      });
      pumpImages();
    }, { rootMargin: '200px 0px' });
    list.forEach(function (t) { io.observe(t); });
  }
  function retryImg(e) {   // 画像サーバーの回数制限(429)などで失敗したら、間隔を空けて読み直す
    var el = e.target;
    if (!el.tagName || el.tagName.toLowerCase() !== 'img' || el.dataset.src) return;
    var n = +(el.dataset.retry || 0), src = el.getAttribute('src');
    el.style.visibility = 'hidden';
    if (n >= 4 || !src) return;
    el.dataset.retry = n + 1;
    el.onload = function () { el.style.visibility = ''; };
    setTimeout(function () { el.setAttribute('src', src); }, 1500 * Math.pow(2, n) + Math.random() * 1000);
  }
  function load() {
    Promise.all([
      fetch('/assets/ninki.json?v=' + encodeURIComponent(VER + '-' + (window.PBERS_UPDATED || ''))).then(function (r) { if (!r.ok) throw new Error('cfg'); return r.json(); }),
      fetch(api + '/status').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (a) {
      cfg = a[0]; status = a[1];
      cfg.candidates.forEach(function (c) { c.key = norm(c.name + ' ' + (c.alt || '')); });
      // チャンネルページから来たときは、その人を選んだ状態で開く(?c=チャンネルID)
      if (WANT) {
        var want = (cfg.alias && cfg.alias[WANT]) || WANT;
        if (cand(want) && picks.indexOf(want) < 0) picks.push(want);
      }
      // 受付が終わったら開票速報だけ。投票済みの人も開票速報から見せる
      mode = closed() || WANT_RESULT || (status && status.voted && !WANT) ? 'kaihyo' : 'vote';
      render();
      if (mode === 'kaihyo') {
        if (WANT_RESULT) try { history.replaceState(history.state, '', location.pathname + '#kaihyo'); } catch (e) {}   // 共有やリロードでも開票速報を開けるように残す
        fetchResult();
      }
      timer = setInterval(tick, 1000);
    }).catch(function () { host.innerHTML = '<p class="nk-sub">読み込めませんでした。時間をおいて開き直してください。</p>'; });
  }
  window.PBERS_NINKI = {
    mount: function (el, boardApi) {
      boardBase = String(boardApi || '');
      api = boardBase.replace(/\/api\/board$/, '/api/ninki');
      if (root === el && cfg) return;
      root = el;
      el.innerHTML = '<div class="nk-modes" role="group" aria-label="表示の切り替え" hidden>' +
        '<button type="button" data-mode="vote">投票する</button><button type="button" data-mode="kaihyo">開票速報</button></div><div id="nk-body"></div>';
      host = el.querySelector('#nk-body');
      el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-mode]');
        if (b && b.dataset.mode !== mode) setMode(b.dataset.mode);
      });
      el.addEventListener('error', retryImg, true);   // error はバブリングしないのでキャプチャで拾う
      window.addEventListener('hashchange', function () {
        if (cfg && location.hash === '#kaihyo' && mode !== 'kaihyo') setMode('kaihyo');
      });
      load();
    }
  };
})();
