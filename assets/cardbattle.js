/* PBers Card Battle(ゲームタブ)。デッキを組んで自陣5枚 vs 敵陣5枚のターン制バトル。
   能力値は実数そのまま: HP=登録者 / 白兵=横動画1本あたり再生数 / 遠戦=縦動画1本あたり再生数 / 防御=Xフォロワー(X未登録は0)。
   奇数ラウンドは遠戦(縦動画で攻撃、列は無関係)、偶数ラウンドは白兵戦(横動画で攻撃、向かいの敵ほど強い)。行動順はそれぞれの本数の多い順。
   パリイ率は過去21日の登録者伸び率(g21)から決まる。
   タイプ(ショート/両刀/長尺)はショート再生の割合で決まる三すくみ。拡散はXの30日投稿数で、生きている間は味方全体の攻撃を上げる。
   実数だと大手が圧倒するので、強さに比例するコストの合計(BUDGET)でデッキを制限する。
   余った予算は余力ボーナスになり、バトル中のHPと攻撃に 予算 ÷ 使ったコスト を掛ける(軽いデッキも戦えるように)。
   毎ラウンド、その戦いの手段を持つカードが1回ずつ攻撃する。自陣カードの番は攻撃先を選ぶ。 */
(function () {
  var BUDGET = 280;      // デッキの合計コスト上限
  var TOP_COST = 234;    // いちばん強いカードのコスト(これを基準に全カードのコストを決める)
  var DECK = 5;
  var RANGED_DIV = 5, MELEE_DIV = 1.25;   // ダメージ = 攻撃 ÷ これ × (1 - 軽減率)。横は縦より再生が伸びにくいので、横の1再生を縦の4再生分に数える
  var PHASES = { r: { label: '遠戦', src: '縦動画' }, m: { label: '白兵戦', src: '横動画' } };
  var DEF_K = 5000;      // 軽減率 = 防御 ÷ (防御 + DEF_K)。5000フォロワーで50%
  var POS_MULT = [1.5, 1, 0.75, 0.5, 0.5];   // 白兵戦で、攻撃側と対象の列の離れ具合(0=向かい)ごとのダメージ倍率
  var PARRY_MAX = 0.5, PARRY_K = 10;   // パリイ率 = PARRY_MAX × 伸び率 ÷ (伸び率 + PARRY_K)。伸び率10%で25%
  var COUNTER = 0.25;    // パリイ成功時に攻撃側へ返す割合
  var TYPES = {
    s: { label: 'ショート', mark: '短', beats: 'm' },
    m: { label: '両刀', mark: '両', beats: 'l' },
    l: { label: '長尺', mark: '長', beats: 's' }
  };
  var TYPE_ADV = 1.5, TYPE_DIS = 0.67;   // 有利/不利のダメージ倍率
  var SHORT_HI = 0.95, SHORT_LO = 0.5;   // 再生数のショート割合がこれ以上ならショート、未満なら長尺、間は両刀
  var AURA_MAX = 0.1, AURA_K = 20;       // 拡散 = AURA_MAX × 30日投稿数 ÷ (30日投稿数 + AURA_K)
  var AURA_COST = 100;                   // 拡散のコスト(拡散10%で+10)
  var DECK_KEY = 'pbers_cb_deck';
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var cards = [], root = null, game = null, token = 0;
  var deck = [], sortKey = 'cost', query = '', typeFilter = '';

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function sig3(x) { return parseFloat(x.toFixed(x < 10 ? 2 : (x < 100 ? 1 : 0))).toString(); }
  function num(n) {
    n = Math.max(n, 0);
    if (n >= 1e8) return sig3(n / 1e8) + '億';
    if (n >= 1e4) return sig3(n / 1e4) + '万';
    return n.toLocaleString('en-US');
  }
  /* アイコンはカードも一覧もサイト共通の96px版にそろえてブラウザのキャッシュを効かせる。
     900px版や別サイズを大量に読むと画像サーバーが429(回数制限)を返す */
  function av(d, px) { return esc((d.avatar || '').replace(/=s\d+/, '=s' + px).replace(/=w\d+-h\d+/, '=s' + px)); }
  function retryImg(e) {   // 429等で失敗したら間隔を空けて読み直す。それでもだめなら隠す
    var i = e.target;
    if (i.tagName !== 'IMG' || !i.getAttribute('src')) return;
    var n = +(i.dataset.retry || 0);
    i.style.visibility = 'hidden';   // 読み直し中は壊れた画像アイコンを見せない
    if (n >= 4) return;
    i.onload = function () { i.style.visibility = ''; };
    i.dataset.retry = n + 1;
    setTimeout(function () { i.src = i.src; }, 1500 * Math.pow(2, n) + Math.random() * 1000);
  }
  function rarOf(d) { return d.subs >= 100000 ? 'ssr' : d.subs >= 30000 ? 'sr' : d.subs >= 10000 ? 'r' : 'n'; }
  function fill(d) { return d.grad ? 'linear-gradient(135deg,' + d.grad[0] + ',' + d.grad[1] + ')' : d.color; }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function $(sel) { return root.querySelector(sel); }
  function costSum(list) { return list.reduce(function (a, c) { return a + c.cost; }, 0); }
  function boostOf(list) { var s = costSum(list); return s > 0 ? Math.max(1, BUDGET / s) : 1; }   // コストはHP×攻撃の平方根に比例するので、両方に掛けると全デッキの総合力がそろう
  function boostText(s) { return '×' + s.toFixed(2); }

  function typeOf(d) {   // 内訳データが無いチャンネルは両刀扱い
    var sum = (d.vShort || 0) + (d.vLong || 0);
    if (d.vShort == null || d.vLong == null || sum <= 0) return 'm';
    var r = d.vShort / sum;
    return r >= SHORT_HI ? 's' : r < SHORT_LO ? 'l' : 'm';
  }
  function typeMult(a, t) { return TYPES[a.type].beats === t.type ? TYPE_ADV : TYPES[t.type].beats === a.type ? TYPE_DIS : 1; }
  function typeChip(c, cls) { return '<span class="' + cls + ' cb-t-' + c.type + '" title="' + TYPES[c.type].label + '">' + TYPES[c.type].mark + '</span>'; }
  function auraText(c) { return (c.aura * 100).toFixed(1).replace(/\.0$/, '') + '%'; }

  /* 横・縦それぞれの1本あたり再生と本数。内訳が無いチャンネルは全体平均を縦に、その1/4(横1再生=縦4再生)を横に使う */
  function splitAtk(d) {
    var nL = d.nLong || 0, nS = d.nShort || 0;
    var aL = nL ? Math.round((d.vLong || 0) / nL) : 0, aS = nS ? Math.round((d.vShort || 0) / nS) : 0;
    if (aL || aS) return { atkM: aL, atkR: aS, spdM: nL, spdR: nS };
    var avg = Math.max(1, Math.round(d.views / d.videos));
    return { atkM: Math.round(avg / 4), atkR: avg, spdM: d.videos, spdR: d.videos };
  }
  function threat(c) { return c.atkM / MELEE_DIV + c.atkR / RANGED_DIV; }   // 2ラウンド分の攻撃力

  /* コスト = √(実質HP × 攻撃)。チーム戦の強さは概ね (Σ√(HP×攻撃))² に比例するので、これを足し算で制限すると釣り合う */
  function buildCards(channels) {
    var X = {}, XP = {};
    (window.PBERS_X || []).forEach(function (x) { X[x.slug] = x.followers; XP[x.slug] = x.posts30 || 0; });
    var list = channels.filter(function (d) { return d.subs && d.views && d.videos; }).map(function (d) {
      var def = X[d.slug] || 0, red = def / (def + DEF_K), sp = splitAtk(d);
      var g = d.g21 == null ? null : d.g21, par = g > 0 ? PARRY_MAX * g / (g + PARRY_K) : 0;
      var p30 = XP[d.slug] || 0, aura = AURA_MAX * p30 / (p30 + AURA_K);
      return { d: d, hp: d.subs, atkM: sp.atkM, atkR: sp.atkR, spdM: sp.spdM, spdR: sp.spdR, spd: d.videos, def: def, red: red, g: g, par: par, type: typeOf(d), p30: p30, aura: aura,
        power: Math.sqrt(d.subs / ((1 - red) * (1 - par)) * threat(sp) / 2) };
    });
    var max = list.reduce(function (a, c) { return Math.max(a, c.power); }, 1);
    list.forEach(function (c) { c.cost = Math.max(1, Math.round(c.power / max * TOP_COST) + Math.round(c.aura * AURA_COST)); });
    return list;
  }
  function minCost() { return cards.reduce(function (a, c) { return Math.min(a, c.cost); }, Infinity); }
  function canAdd(c) {
    if (deck.indexOf(c) >= 0 || deck.length >= DECK) return false;
    return costSum(deck) + c.cost + (DECK - deck.length - 1) * minCost() <= BUDGET;   // 残り枠が埋められる分は残す
  }
  /* 敵・おまかせ用。枠ごとに残り予算を目安にばらつかせて選ぶので、大手1枚型も中堅並べ型も出る */
  function randomDeck() {
    var best = null, mn = minCost();
    for (var tr = 0; tr < 40; tr++) {
      var d = [], left = BUDGET;
      for (var slot = DECK; slot > 0; slot--) {
        var cap = left - mn * (slot - 1), tgt = left / slot * (0.3 + Math.random() * 1.7), used = d;
        var near = shuffle(cards.filter(function (c) { return used.indexOf(c) < 0 && c.cost <= cap; }))
          .sort(function (a, b) { return Math.abs(a.cost - tgt) - Math.abs(b.cost - tgt); }).slice(0, 5);
        if (!near.length) break;
        var p = near[Math.floor(Math.random() * near.length)];
        d.push(p); left -= p.cost;
      }
      if (d.length < DECK) continue;
      if (!best || costSum(d) > costSum(best)) best = d;
      if (costSum(best) >= BUDGET * 0.8) break;
    }
    return best || shuffle(cards.slice()).slice(0, DECK);
  }
  /* 敵は6割の確率で「重いカードを軸に予算を使い切る」強いデッキにする(ばらつかせた編成だけだと大手デッキに必ず負ける) */
  function enemyDeck() {
    if (Math.random() >= 0.6) return randomDeck();
    var mn = minCost(), srt = cards.slice().sort(function (a, b) { return b.cost - a.cost; });
    var top = srt.filter(function (c) { return c.cost <= BUDGET - (DECK - 1) * mn; }).slice(0, 8);
    var d = [top[Math.floor(Math.random() * top.length)]];
    for (var slot = DECK - 1; slot > 0; slot--) {
      var cap = BUDGET - costSum(d) - (slot - 1) * mn, used = d.slice();
      var near = srt.filter(function (c) { return used.indexOf(c) < 0 && c.cost <= cap; }).slice(0, 4);
      if (!near.length) return randomDeck();
      d.push(near[Math.floor(Math.random() * near.length)]);
    }
    return d;
  }
  function saveDeck() { try { localStorage.setItem(DECK_KEY, JSON.stringify(deck.map(function (c) { return c.d.slug; }))); } catch (e) {} }
  function loadDeck() {
    var slugs = [];
    try { slugs = JSON.parse(localStorage.getItem(DECK_KEY) || '[]'); } catch (e) {}
    var out = [];
    (Array.isArray(slugs) ? slugs : []).forEach(function (s) {
      var c = cards.filter(function (x) { return x.d.slug === s; })[0];
      if (c && out.indexOf(c) < 0) out.push(c);
    });
    return costSum(out) <= BUDGET && out.length <= DECK ? out : [];
  }

  function growthText(g) { return g == null ? '—' : (g > 0 ? '+' : '') + g + '%'; }
  function parText(c) { return Math.round(c.par * 100) + '%'; }

  /* ---- デッキ構築 ---- */
  var SORTS = {
    cost: function (c) { return c.cost; }, hp: function (c) { return c.hp; }, atkM: function (c) { return c.atkM; }, atkR: function (c) { return c.atkR; },
    spd: function (c) { return c.spd; }, def: function (c) { return c.def; }, g: function (c) { return c.g == null ? -Infinity : c.g; }, aura: function (c) { return c.aura; }
  };
  function renderSlots() {
    var html = '';
    for (var i = 0; i < DECK; i++) {
      var c = deck[i];
      html += c
        ? '<button type="button" class="cb-slot" data-i="' + i + '" style="--c:' + c.d.color + '" aria-label="' + esc(c.d.name) + ' をデッキから外す">' +
            '<img src="' + av(c.d, 96) + '" alt="">' +
            '<span class="cb-slot-n">' + esc(c.d.name) + '</span><span class="cb-slot-c num">C' + c.cost + '</span></button>'
        : '<div class="cb-slot cb-slot-empty">空き</div>';
    }
    $('.cb-slots').innerHTML = html;
    var sum = costSum(deck);
    $('.cb-meter-v').textContent = sum + ' / ' + BUDGET;
    $('.cb-meter i').style.transform = 'scaleX(' + Math.min(sum / BUDGET, 1) + ')';
    var boost = boostOf(deck);
    $('.cb-bonus').innerHTML = deck.length === DECK && boost > 1
      ? '余った予算 <b class="num">' + (BUDGET - sum) + '</b> → <b>余力ボーナス HP・攻撃 <span class="num">' + boostText(boost) + '</span></b>'
      : deck.length === DECK ? '予算を使い切りました(余力ボーナスなし)' : '余った予算は余力ボーナスになり、バトル中のHPと攻撃が上がります';
    $('.cb-go').disabled = deck.length !== DECK;
    $('.cb-go').textContent = deck.length === DECK ? 'このデッキで戦う' : 'あと' + (DECK - deck.length) + '枚';
    [].slice.call(root.querySelectorAll('.cb-li')).forEach(function (el) {
      var r = cards[+el.dataset.i], on = deck.indexOf(r) >= 0;
      el.classList.toggle('on', on);
      el.disabled = !on && !canAdd(r);
      el.setAttribute('aria-pressed', String(on));
    });
  }
  function renderList() {
    var q = query.toLowerCase(), key = SORTS[sortKey];
    var rows = cards.map(function (c, i) { return { c: c, i: i }; }).filter(function (r) {
      return (!typeFilter || r.c.type === typeFilter) && (!q || r.c.d.name.toLowerCase().indexOf(q) >= 0);
    }).sort(function (a, b) { return key(b.c) - key(a.c); });
    $('.cb-list').innerHTML = rows.length ? rows.map(function (r) {
      var c = r.c;
      return '<button type="button" class="cb-li" data-i="' + r.i + '">' +
        '<img src="' + av(c.d, 96) + '" alt="" loading="lazy" style="border-color:' + c.d.color + '">' +
        '<span class="cb-li-b"><span class="cb-li-n">' + typeChip(c, 'cb-li-t') + esc(c.d.name) + '</span>' +
        '<span class="cb-li-s num"><span>HP ' + num(c.hp) + '</span><span>白 ' + num(c.atkM) + ' (' + num(c.spdM) + '本)</span><span>遠 ' + num(c.atkR) + ' (' + num(c.spdR) + '本)</span>' +
        '<span>防 ' + num(c.def) + (c.def ? ' (-' + Math.round(c.red * 100) + '%)' : '') + '</span>' +
        '<span>伸 ' + growthText(c.g) + (c.par ? ' (パリイ' + parText(c) + ')' : '') + '</span>' +
        (c.aura ? '<span>拡 +' + auraText(c) + ' (30日' + c.p30 + '投稿)</span>' : '') + '</span></span>' +
        '<span class="cb-li-c num">C' + c.cost + '</span></button>';
    }).join('') : '<div class="fc-empty">見つかりません</div>';
    renderSlots();
  }
  function showBuild() {
    token++;
    game = null;
    $('.cb-build').hidden = false; $('.cb-board').hidden = true;
    renderList();
  }
  function setupBuild() {
    $('.cb-list').addEventListener('click', function (e) {
      var el = e.target.closest('.cb-li'); if (!el || el.disabled) return;
      var c = cards[+el.dataset.i], at = deck.indexOf(c);
      if (at >= 0) deck.splice(at, 1); else if (canAdd(c)) deck.push(c);
      saveDeck(); renderSlots();
    });
    $('.cb-slots').addEventListener('click', function (e) {
      var el = e.target.closest('button.cb-slot'); if (!el) return;
      deck.splice(+el.dataset.i, 1); saveDeck(); renderSlots();
    });
    $('.cb-auto').addEventListener('click', function () { deck = randomDeck().slice(); saveDeck(); renderSlots(); });
    $('.cb-clear').addEventListener('click', function () { deck = []; saveDeck(); renderSlots(); });
    $('.cb-go').addEventListener('click', function () { if (deck.length === DECK) newBattle(); });
    $('.cb-q').addEventListener('input', function (e) { query = e.target.value.trim(); renderList(); });
    $('.cb-tfilter').addEventListener('click', function (e) {
      var b = e.target.closest('.vt'); if (!b) return;
      typeFilter = b.dataset.type;
      [].slice.call(root.querySelectorAll('.cb-tfilter .vt')).forEach(function (x) { x.classList.toggle('on', x === b); });
      renderList();
    });
    $('.cb-sort').addEventListener('click', function (e) {
      var b = e.target.closest('.vt'); if (!b) return;
      sortKey = b.dataset.sort;
      [].slice.call(root.querySelectorAll('.cb-sort .vt')).forEach(function (x) { x.classList.toggle('on', x === b); });
      renderList();
    });
  }

  /* ---- バトル ---- */
  function alive(list) { return list.filter(function (c) { return c.hp > 0; }); }
  function unit(c, side, pos, boost) { var hp = Math.round(c.hp * boost); return { t: c, d: c.d, boost: boost, hp: hp, max: hp, atkM: Math.round(c.atkM * boost), atkR: Math.round(c.atkR * boost), spdM: c.spdM, spdR: c.spdR, def: c.def, red: c.red, g: c.g, par: c.par, type: c.type, p30: c.p30, aura: c.aura, cost: c.cost, side: side, pos: pos, el: null }; }
  function teamBuff(side) { return alive(game[side]).reduce(function (a, c) { return a + c.aura; }, 0); }   // 倒されたカードの分は消える
  function atkNow(c) { return game.phase === 'm' ? c.atkM : c.atkR; }
  function posMult(a, t) { return game.phase === 'm' ? POS_MULT[Math.abs(a.pos - t.pos)] : 1; }   // 遠戦は列に関係なく届く
  function hitMult(a, t) { return posMult(a, t) * typeMult(a, t); }
  function dmgOf(a, t) { return atkNow(a) / (game.phase === 'm' ? MELEE_DIV : RANGED_DIV) * (1 - t.red) * hitMult(a, t) * (1 + teamBuff(a.side)); }
  function paintBuffs() {
    ['ally', 'enemy'].forEach(function (side) {
      var b = teamBuff(side);
      $('.cb-' + side + '-buff').textContent = b ? '拡散 攻撃+' + (b * 100).toFixed(1) + '%' : '';
    });
  }
  function cardHTML(c) {
    var boosted = c.boost > 1;
    return '<button type="button" class="cb-card cb-' + rarOf(c.d) + (boosted ? ' cb-boosted' : '') + '" style="--c:' + c.d.color + '" disabled' +
      (boosted ? ' title="余力ボーナス' + boostText(c.boost) + '(実数 HP ' + num(c.t.hp) + ' / 白 ' + num(c.t.atkM) + ' / 遠 ' + num(c.t.atkR) + ')"' : '') + '>' +
      '<span class="cb-cost num">C' + c.cost + '</span>' + typeChip(c, 'cb-type') +
      '<span class="cb-art" style="background:' + fill(c.d) + '"><img src="' + av(c.d, 96) + '" alt=""></span>' +
      '<span class="cb-name">' + esc(c.d.name) + '</span>' +
      '<span class="cb-hpbar"><i></i></span>' +
      '<span class="cb-hp num"><span class="cb-hp-v"></span><span class="cb-hp-m">/' + num(c.max) + '</span></span>' +
      '<span class="cb-stats num"><span class="cb-s-m">白' + num(c.atkM) + '</span><span class="cb-s-r">遠' + num(c.atkR) + '</span><span>防' + num(c.def) + '</span><span>パ' + parText(c) + '</span>' + (c.aura ? '<span>拡' + auraText(c) + '</span>' : '') + '</span>' +
      '<span class="cb-mult num"></span>' +
      '</button>';
  }
  function paint(c) {
    var pct = Math.max(c.hp, 0) / c.max * 100;
    c.el.querySelector('.cb-hpbar i').style.transform = 'scaleX(' + pct / 100 + ')';
    c.el.classList.toggle('low', pct <= 30);
    c.el.querySelector('.cb-hp-v').textContent = num(c.hp);
    c.el.classList.toggle('cb-dead', c.hp <= 0);
    c.el.setAttribute('aria-label', c.d.name + ' HP' + Math.max(c.hp, 0) + '/' + c.max + ' 白兵' + c.atkM + ' 遠戦' + c.atkR + ' 防御' + c.def + ' パリイ' + parText(c) + ' 拡散' + auraText(c) + ' タイプ' + TYPES[c.type].label + (c.boost > 1 ? ' 余力ボーナス' + boostText(c.boost) : ''));
  }
  function msg(html) { $('.cb-msg').innerHTML = html; }
  function later(fn, ms) { var t = token; setTimeout(function () { if (t === token) fn(); }, RM ? Math.min(ms, 150) : ms); }

  function newBattle() {
    token++;
    var myBoost = boostOf(deck), foeDeck = shuffle(enemyDeck().slice()), foeBoost = boostOf(foeDeck);
    var mine = deck.map(function (c, i) { return unit(c, 'ally', i, myBoost); });
    var foes = foeDeck.map(function (c, i) { return unit(c, 'enemy', i, foeBoost); });
    game = { ally: mine, enemy: foes, queue: [], round: 0, actor: null, arranging: true, picked: null };
    $('.cb-build').hidden = true; $('.cb-board').hidden = false;
    renderRow(foes, '.cb-row-enemy'); renderRow(mine, '.cb-row-ally');
    setSwappable(true);
    paintBuffs();
    $('.cb-enemy-cost').textContent = 'コスト ' + costSum(foes);
    $('.cb-ally-cost').textContent = 'コスト ' + costSum(mine);
    $('.cb-enemy-boost').textContent = foeBoost > 1 ? '余力ボーナス HP・攻撃' + boostText(foeBoost) : '';
    $('.cb-ally-boost').textContent = myBoost > 1 ? '余力ボーナス HP・攻撃' + boostText(myBoost) : '';
    $('.cb-order').innerHTML = '';
    $('.cb-result').hidden = true;
    $('.cb-actions').hidden = false;
    delete $('.cb-board').dataset.phase;
    msg('遠戦(縦動画)と白兵戦(横動画)を交互に戦います。自陣のカードを2枚タップすると入れ替え。<b>白兵戦は向かいの敵に1.5倍</b>、離れるほど弱くなります');
  }
  function renderRow(list, sel) {
    $(sel).innerHTML = list.map(cardHTML).join('');
    [].slice.call(root.querySelectorAll(sel + ' .cb-card')).forEach(function (el, i) {
      var u = list[i];
      u.el = el; paint(u);
      el.addEventListener('click', function () { if (game.arranging) swapPick(u); else choose(u); });
    });
  }
  function setSwappable(on) {
    game.ally.forEach(function (u) {
      u.el.disabled = !on; u.el.classList.toggle('cb-swap', on);
      u.el.classList.toggle('cb-picked', on && u === game.picked);
    });
  }
  function swapPick(u) {
    if (u.side !== 'ally') return;
    var p = game.picked;
    if (!p) { game.picked = u; setSwappable(true); return; }
    game.picked = null;
    if (p !== u) {
      var i = p.pos, j = u.pos;
      game.ally[i] = u; game.ally[j] = p; u.pos = i; p.pos = j;
      renderRow(game.ally, '.cb-row-ally');
      deck = game.ally.map(function (x) { return x.t; }); saveDeck();   // 並びは次の対戦にも引き継ぐ
    }
    setSwappable(true);
  }
  function start() {
    game.arranging = false; game.picked = null;
    setSwappable(false);
    $('.cb-actions').hidden = true;
    nextRound();
  }
  function nextRound() {
    game.round++;
    game.phase = game.round % 2 ? 'r' : 'm';
    var spd = game.phase === 'm' ? 'spdM' : 'spdR';
    game.queue = shuffle(alive(game.ally).concat(alive(game.enemy))).filter(function (c) { return atkNow(c) > 0; }).sort(function (a, b) { return b[spd] - a[spd]; });
    $('.cb-board').dataset.phase = game.phase;
    game.ally.concat(game.enemy).forEach(function (c) { c.el.classList.toggle('cb-idle', c.hp > 0 && atkNow(c) <= 0); });
    nextActor();
  }
  function paintOrder() {
    var ph = PHASES[game.phase];
    $('.cb-order').innerHTML = '<span class="cb-round num">R' + game.round + '</span><span class="cb-phase cb-ph-' + game.phase + '">' + ph.label + '<small>' + ph.src + '</small></span>' + game.queue.filter(function (c) { return c.hp > 0; }).map(function (c) {
      return '<img class="cb-ord ' + (c.side === 'ally' ? 'a' : 'e') + '" src="' + av(c.d, 96) + '" alt="" style="border-color:' + c.d.color + '">';
    }).join('');
  }
  function setActive(c) {
    game.ally.concat(game.enemy).forEach(function (x) { x.el.classList.toggle('cb-active', x === c); });
  }
  function setTargets(on, actor) {
    game.enemy.forEach(function (c) {
      var t = on && c.hp > 0;
      c.el.disabled = !t; c.el.classList.toggle('cb-target', t);
      var m = c.el.querySelector('.cb-mult');
      m.textContent = t && actor ? '×' + parseFloat(hitMult(actor, c).toFixed(2)) : '';
      m.classList.toggle('adv', !!(t && actor) && typeMult(actor, c) > 1);
      m.classList.toggle('dis', !!(t && actor) && typeMult(actor, c) < 1);
    });
  }
  function nextActor() {
    if (!alive(game.ally).length || !alive(game.enemy).length) return finish();
    while (game.queue.length && game.queue[0].hp <= 0) game.queue.shift();
    if (!game.queue.length) return nextRound();
    var c = game.queue[0];
    game.actor = c; paintOrder(); setActive(c);
    if (c.side === 'ally') {
      setTargets(true, c);
      msg('<b style="color:' + c.d.color + '">' + esc(c.d.name) + '</b> の番 — 攻撃する敵を選んでください');
    } else {
      setTargets(false);
      msg('敵の <b style="color:' + c.d.color + '">' + esc(c.d.name) + '</b> の番');
      later(function () { attack(c, aiTarget(c)); }, 750);
    }
  }
  function aiTarget(c) {   // 倒せる相手がいれば倒す。その中で「削れるHPの割合 × 相手の攻撃」が大きい相手を狙う(列の倍率も効く)
    var foes = alive(game.ally);
    var ko = foes.filter(function (f) { return f.hp <= dmgOf(c, f) * 0.85; });
    var score = function (f) { return Math.min(dmgOf(c, f) / f.hp, 1) * threat(f); };
    return (ko.length ? ko : foes).slice().sort(function (a, b) { return score(b) - score(a); })[0];
  }
  function choose(c) {
    if (!game || !game.actor || game.actor.side !== 'ally' || c.side !== 'enemy' || c.hp <= 0) return;
    setTargets(false);
    attack(game.actor, c);
  }
  function attack(a, t) {
    game.queue.shift(); game.actor = null;
    var crit = Math.random() < 0.1;
    var dmg = Math.max(1, Math.round(dmgOf(a, t) * (0.85 + Math.random() * 0.3) * (crit ? 1.5 : 1)));
    var parried = Math.random() < t.par, mult = posMult(a, t), tm = typeMult(a, t);
    var names = '<b style="color:' + a.d.color + '">' + esc(a.d.name) + '</b> → <b style="color:' + t.d.color + '">' + esc(t.d.name) + '</b>';
    var hit = function () {
      if (parried) {
        var back = Math.max(1, Math.round(dmg * COUNTER));
        a.hp -= back; paint(a);
        pop(t, 'パリイ!', 'parry');
        pop(a, '-' + num(back), '');
        msg(names + ' の攻撃を<b>パリイ!</b> ' + '<b class="num">' + num(back) + '</b> 反撃' + (a.hp <= 0 ? ' 撃破!' : ''));
      } else {
        t.hp -= dmg; paint(t);
        pop(t, '-' + num(dmg), crit ? 'crit' : '');
        msg(names + ' に <b class="num">' + num(dmg) + '</b> ダメージ' + (tm > 1 ? '(有利!)' : tm < 1 ? '(不利)' : '') + (mult !== 1 ? '(列×' + mult + ')' : '') + (crit ? '(会心!)' : '') + (t.hp <= 0 ? ' 撃破!' : ''));
      }
      paintBuffs();
      later(nextActor, parried ? 900 : 600);
    };
    if (RM || !a.el.animate) return hit();
    var r1 = a.el.getBoundingClientRect(), r2 = t.el.getBoundingClientRect();
    if (game.phase === 'r') return shoot(a, t, r1, r2, hit);
    var dx = (r2.left - r1.left) * 0.7, dy = (r2.top - r1.top) * 0.7;
    a.el.style.zIndex = 3;
    var an = a.el.animate([
      { transform: 'translate(0,0)' },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(1.06)', offset: 0.5 },
      { transform: 'translate(0,0)' }
    ], { duration: 420, easing: 'ease-in-out' });
    an.onfinish = function () { a.el.style.zIndex = ''; };
    later(function () {
      t.el.animate([
        { transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' },
        { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }
      ], { duration: 240 });
      hit();
    }, 210);
  }
  function shoot(a, t, r1, r2, hit) {   // 遠戦はカードが動かず、弾だけが飛ぶ
    var box = $('.cb-board').getBoundingClientRect(), s = document.createElement('span');
    var x1 = r1.left + r1.width / 2 - box.left - 6, y1 = r1.top + r1.height / 2 - box.top - 6;
    var x2 = r2.left + r2.width / 2 - box.left - 6, y2 = r2.top + r2.height / 2 - box.top - 6;
    s.className = 'cb-shot';
    s.style.background = a.d.color;
    $('.cb-board').appendChild(s);
    s.animate([{ transform: 'translate(' + x1 + 'px,' + y1 + 'px)' }, { transform: 'translate(' + x2 + 'px,' + y2 + 'px)' }], { duration: 300, easing: 'ease-in' }).onfinish = function () { s.remove(); };
    later(function () {
      t.el.animate([
        { transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' },
        { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }
      ], { duration: 240 });
      hit();
    }, 300);
  }
  function pop(t, text, cls) {
    var p = document.createElement('span');
    p.className = 'cb-pop num' + (cls ? ' ' + cls : '');
    p.textContent = text;
    t.el.appendChild(p);
    if (RM || !p.animate) { setTimeout(function () { p.remove(); }, 500); return; }
    p.animate([{ transform: 'translate(-50%,0)', opacity: 1 }, { transform: 'translate(-50%,-34px)', opacity: 0 }], { duration: 750, easing: 'ease-out' }).onfinish = function () { p.remove(); };
  }
  function finish() {
    setActive(null); setTargets(false);
    delete $('.cb-board').dataset.phase;
    game.ally.concat(game.enemy).forEach(function (c) { c.el.classList.remove('cb-idle'); });
    $('.cb-order').innerHTML = '';
    var win = alive(game.ally).length > 0;
    $('.cb-result').hidden = false;
    $('.cb-res-t').textContent = win ? '勝利!' : '敗北…';
    $('.cb-res-t').classList.toggle('win', win);
    $('.cb-res-s').textContent = game.round + 'ラウンド ・ ' + (win ? '自陣' : '敵陣') + 'の残り ' + alive(win ? game.ally : game.enemy).length + '枚';
    msg('');
  }

  function mount(host, channels) {
    var fresh = buildCards(channels);
    if (root) {   // タブを移動しても対戦を続けられる。デッキ構築中ならジャンル設定の変更を反映
      host.innerHTML = ''; host.appendChild(root);
      if (!game) {
        cards = fresh;
        deck = deck.map(function (c) { return cards.filter(function (x) { return x.d.slug === c.d.slug; })[0]; }).filter(Boolean);
        renderList();
      }
      return;
    }
    if (fresh.length < 10) { host.innerHTML = '<div class="fc-empty">カードが足りません(ジャンル設定を確認してください)。</div>'; return; }
    cards = fresh;
    root = document.createElement('div');
    root.className = 'cb';
    root.addEventListener('error', retryImg, true);   // error はバブリングしないのでキャプチャで拾う
    root.innerHTML =
      '<div class="game-head"><h3 class="g-h3">⚔️ カードバトル <span class="fc-en">PBers Card Battle</span></h3>' +
      '<div class="fc-lead">HP=登録者、白=横動画1本あたり再生、遠=縦動画1本あたり再生、防=Xフォロワー、パリイ=過去21日の登録者伸び率、拡散=Xの30日投稿数。5枚で合計コスト' + BUDGET + '以内のデッキを組み、並びを考えて相手を全滅させたら勝ち。</div>' +
      '<div class="cb-legend"><span class="cb-li-t cb-t-s">短</span>ショート → <span class="cb-li-t cb-t-m">両</span>両刀 → <span class="cb-li-t cb-t-l">長</span>長尺 → <span class="cb-li-t cb-t-s">短</span>ショート の順に有利(×' + TYPE_ADV + ')</div></div>' +
      '<div class="cb-build">' +
        '<div class="cb-slots"></div>' +
        '<div class="cb-meter-row"><span class="cb-meter-l">コスト</span><span class="cb-meter"><i></i></span><span class="cb-meter-v num"></span></div>' +
        '<div class="cb-bonus"></div>' +
        '<div class="cb-bact"><button type="button" class="g-btn g-confirm cb-go" disabled></button><button type="button" class="g-btn g-x cb-auto">おまかせ</button><button type="button" class="g-btn g-x cb-clear">クリア</button></div>' +
        '<div class="cb-tools"><input type="search" class="cb-q" placeholder="チャンネル名で検索" aria-label="チャンネル名で検索">' +
          '<div class="vtype cb-sort"><button type="button" class="vt on" data-sort="cost">コスト</button><button type="button" class="vt" data-sort="hp">HP</button><button type="button" class="vt" data-sort="atkM">白</button><button type="button" class="vt" data-sort="atkR">遠</button><button type="button" class="vt" data-sort="spd">本数</button><button type="button" class="vt" data-sort="def">防</button><button type="button" class="vt" data-sort="g">伸</button><button type="button" class="vt" data-sort="aura">拡</button></div>' +
          '<div class="vtype cb-tfilter"><button type="button" class="vt on" data-type="">全タイプ</button><button type="button" class="vt" data-type="s">ショート</button><button type="button" class="vt" data-type="m">両刀</button><button type="button" class="vt" data-type="l">長尺</button></div></div>' +
        '<div class="cb-list"></div>' +
      '</div>' +
      '<div class="cb-board" hidden>' +
        '<div class="cb-label">敵陣 <span class="cb-enemy-cost num"></span> <span class="cb-boost cb-enemy-boost num"></span> <span class="cb-buff cb-enemy-buff"></span></div><div class="cb-row cb-row-enemy"></div>' +
        '<div class="cb-mid"><div class="cb-order"></div><div class="cb-msg" aria-live="polite"></div>' +
          '<div class="cb-actions"><button type="button" class="g-btn g-confirm cb-start">バトル開始</button><button type="button" class="g-btn g-x cb-reroll">相手を変える</button><button type="button" class="g-btn g-x cb-edit">デッキ編集</button></div>' +
          '<div class="cb-result" hidden><div class="cb-res-t"></div><div class="cb-res-s"></div><div class="cb-bact"><button type="button" class="g-btn g-confirm cb-again">もう一度</button><button type="button" class="g-btn g-x cb-edit2">デッキ編集</button></div></div>' +
        '</div>' +
        '<div class="cb-row cb-row-ally"></div><div class="cb-label">自陣 <span class="cb-ally-cost num"></span> <span class="cb-boost cb-ally-boost num"></span> <span class="cb-buff cb-ally-buff"></span></div>' +
      '</div>' +
      '<div class="cb-rule">奇数ラウンドは遠戦(縦動画1本あたり再生で攻撃、列は関係なし)、偶数ラウンドは白兵戦(横動画1本あたり再生で攻撃)。その動画を持たないカードは攻撃できず、行動順はその動画の本数が多い順。' +
        'ダメージ = 攻撃 ÷ 割る数(遠戦' + RANGED_DIV + '、白兵戦' + MELEE_DIV + ') × (1 − 軽減率) × 列の倍率 × 相性 × (1 + 味方の拡散)。軽減率 = 防御 ÷ (防御 + ' + num(DEF_K) + ')。白兵戦の列の倍率は向かい×1.5、1列隣×1、2列×0.75、3列以上×0.5。' +
        'パリイ率 = 50% × 伸び率 ÷ (伸び率 + 10)。成功するとダメージを無効にし、1/4を反撃。' +
        'タイプは再生数のショート割合で決まり、95%以上がショート、50%未満が長尺、その間が両刀。不利な相手へは×' + TYPE_DIS + '。' +
        '拡散 = 10% × 30日投稿数 ÷ (30日投稿数 + 20)。生きている間だけ味方全体の攻撃が上がる。Xが未登録のチャンネルは防御0・拡散0、伸びていないチャンネルはパリイ0%。横と縦の内訳が無いチャンネルは、全体の平均を遠戦に、その1/4を白兵に使う。' +
        '余力ボーナス = 予算' + BUDGET + ' ÷ 使ったコスト。バトル中のHPと攻撃に掛かり、金色の数字がボーナス込みの値。</div>';
    setupBuild();
    $('.cb-start').addEventListener('click', start);
    $('.cb-reroll').addEventListener('click', newBattle);
    $('.cb-again').addEventListener('click', newBattle);
    $('.cb-edit').addEventListener('click', showBuild);
    $('.cb-edit2').addEventListener('click', showBuild);
    deck = loadDeck();
    host.innerHTML = ''; host.appendChild(root);
    showBuild();
  }
  window.PBERS_CB = { mount: mount };
})();
