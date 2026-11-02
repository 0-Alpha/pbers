/* PBers Card Battle(ゲームタブ)。デッキを組んで自陣5枚 vs 敵陣5枚のターン制バトル。
   能力値は実数そのまま: HP=登録者 / 攻撃=1本あたり再生数 / 素早さ=投稿数 / 防御=Xフォロワー(X未登録は0)。
   パリイ率は過去21日の登録者伸び率(g21)から決まる。位置は攻撃の倍率に効く(向かいの敵ほど強い)。
   実数だと大手が圧倒するので、強さに比例するコストの合計(BUDGET)でデッキを制限する。
   毎ラウンド、生きているカード全員が素早さ順に1回ずつ攻撃する。自陣カードの番は攻撃先を選ぶ。 */
(function () {
  var BUDGET = 280;      // デッキの合計コスト上限
  var TOP_COST = 234;    // いちばん強いカードのコスト(これを基準に全カードのコストを決める)
  var DECK = 5;
  var ATK_DIV = 6;       // ダメージ = 攻撃 ÷ ATK_DIV × (1 - 軽減率)
  var DEF_K = 5000;      // 軽減率 = 防御 ÷ (防御 + DEF_K)。5000フォロワーで50%
  var POS_MULT = [1.5, 1, 0.75, 0.5, 0.5];   // 攻撃側と対象の列の離れ具合(0=向かい)ごとのダメージ倍率
  var PARRY_MAX = 0.5, PARRY_K = 10;   // パリイ率 = PARRY_MAX × 伸び率 ÷ (伸び率 + PARRY_K)。伸び率10%で25%
  var COUNTER = 0.25;    // パリイ成功時に攻撃側へ返す割合
  var DECK_KEY = 'pbers_cb_deck';
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var cards = [], root = null, game = null, token = 0;
  var deck = [], sortKey = 'cost', query = '';

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

  /* コスト = √(実質HP × 攻撃)。チーム戦の強さは概ね (Σ√(HP×攻撃))² に比例するので、これを足し算で制限すると釣り合う */
  function buildCards(channels) {
    var X = {};
    (window.PBERS_X || []).forEach(function (x) { X[x.slug] = x.followers; });
    var list = channels.filter(function (d) { return d.subs && d.views && d.videos; }).map(function (d) {
      var def = X[d.slug] || 0, red = def / (def + DEF_K), atk = Math.round(d.views / d.videos);
      var g = d.g21 == null ? null : d.g21, par = g > 0 ? PARRY_MAX * g / (g + PARRY_K) : 0;
      return { d: d, hp: d.subs, atk: atk, spd: d.videos, def: def, red: red, g: g, par: par, power: Math.sqrt(d.subs / ((1 - red) * (1 - par)) * atk) };
    });
    var max = list.reduce(function (a, c) { return Math.max(a, c.power); }, 1);
    list.forEach(function (c) { c.cost = Math.max(1, Math.round(c.power / max * TOP_COST)); });
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
    cost: function (c) { return c.cost; }, hp: function (c) { return c.hp; }, atk: function (c) { return c.atk; },
    spd: function (c) { return c.spd; }, def: function (c) { return c.def; }, g: function (c) { return c.g == null ? -Infinity : c.g; }
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
      return !q || r.c.d.name.toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return key(b.c) - key(a.c); });
    $('.cb-list').innerHTML = rows.length ? rows.map(function (r) {
      var c = r.c;
      return '<button type="button" class="cb-li" data-i="' + r.i + '">' +
        '<img src="' + av(c.d, 96) + '" alt="" loading="lazy" style="border-color:' + c.d.color + '">' +
        '<span class="cb-li-b"><span class="cb-li-n">' + esc(c.d.name) + '</span>' +
        '<span class="cb-li-s num"><span>HP ' + num(c.hp) + '</span><span>攻 ' + num(c.atk) + '</span><span>速 ' + num(c.spd) + '</span>' +
        '<span>防 ' + num(c.def) + (c.def ? ' (-' + Math.round(c.red * 100) + '%)' : '') + '</span>' +
        '<span>伸 ' + growthText(c.g) + (c.par ? ' (パリイ' + parText(c) + ')' : '') + '</span></span></span>' +
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
    $('.cb-sort').addEventListener('click', function (e) {
      var b = e.target.closest('.vt'); if (!b) return;
      sortKey = b.dataset.sort;
      [].slice.call(root.querySelectorAll('.cb-sort .vt')).forEach(function (x) { x.classList.toggle('on', x === b); });
      renderList();
    });
  }

  /* ---- バトル ---- */
  function alive(list) { return list.filter(function (c) { return c.hp > 0; }); }
  function unit(c, side, pos) { return { t: c, d: c.d, hp: c.hp, max: c.hp, atk: c.atk, spd: c.spd, def: c.def, red: c.red, g: c.g, par: c.par, cost: c.cost, side: side, pos: pos, el: null }; }
  function dmgOf(a, t) { return a.atk / ATK_DIV * (1 - t.red) * POS_MULT[Math.abs(a.pos - t.pos)]; }
  function cardHTML(c) {
    return '<button type="button" class="cb-card cb-' + rarOf(c.d) + '" style="--c:' + c.d.color + '" disabled>' +
      '<span class="cb-cost num">C' + c.cost + '</span>' +
      '<span class="cb-art" style="background:' + fill(c.d) + '"><img src="' + av(c.d, 96) + '" alt=""></span>' +
      '<span class="cb-name">' + esc(c.d.name) + '</span>' +
      '<span class="cb-hpbar"><i></i></span>' +
      '<span class="cb-hp num"><span class="cb-hp-v"></span><span class="cb-hp-m">/' + num(c.max) + '</span></span>' +
      '<span class="cb-stats num"><span>攻' + num(c.atk) + '</span><span>速' + num(c.spd) + '</span><span>防' + num(c.def) + '</span><span>パ' + parText(c) + '</span></span>' +
      '<span class="cb-mult num"></span>' +
      '</button>';
  }
  function paint(c) {
    var pct = Math.max(c.hp, 0) / c.max * 100;
    c.el.querySelector('.cb-hpbar i').style.transform = 'scaleX(' + pct / 100 + ')';
    c.el.classList.toggle('low', pct <= 30);
    c.el.querySelector('.cb-hp-v').textContent = num(c.hp);
    c.el.classList.toggle('cb-dead', c.hp <= 0);
    c.el.setAttribute('aria-label', c.d.name + ' HP' + Math.max(c.hp, 0) + '/' + c.max + ' 攻撃' + c.atk + ' 素早さ' + c.spd + ' 防御' + c.def + ' パリイ' + parText(c));
  }
  function msg(html) { $('.cb-msg').innerHTML = html; }
  function later(fn, ms) { var t = token; setTimeout(function () { if (t === token) fn(); }, RM ? Math.min(ms, 150) : ms); }

  function newBattle() {
    token++;
    var mine = deck.map(function (c, i) { return unit(c, 'ally', i); });
    var foes = shuffle(enemyDeck().slice()).map(function (c, i) { return unit(c, 'enemy', i); });
    game = { ally: mine, enemy: foes, queue: [], round: 0, actor: null, arranging: true, picked: null };
    $('.cb-build').hidden = true; $('.cb-board').hidden = false;
    renderRow(foes, '.cb-row-enemy'); renderRow(mine, '.cb-row-ally');
    setSwappable(true);
    $('.cb-enemy-cost').textContent = 'コスト ' + costSum(foes);
    $('.cb-ally-cost').textContent = 'コスト ' + costSum(mine);
    $('.cb-order').innerHTML = '';
    $('.cb-result').hidden = true;
    $('.cb-actions').hidden = false;
    msg('自陣のカードを2枚タップすると入れ替え。<b>向かいの敵への攻撃は1.5倍</b>、離れるほど弱くなります');
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
    game.queue = shuffle(alive(game.ally).concat(alive(game.enemy))).sort(function (a, b) { return b.spd - a.spd; });
    nextActor();
  }
  function paintOrder() {
    $('.cb-order').innerHTML = '<span class="cb-round num">R' + game.round + '</span>' + game.queue.filter(function (c) { return c.hp > 0; }).map(function (c) {
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
      c.el.querySelector('.cb-mult').textContent = t && actor ? '×' + POS_MULT[Math.abs(actor.pos - c.pos)] : '';
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
    var score = function (f) { return Math.min(dmgOf(c, f) / f.hp, 1) * f.atk; };
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
    var parried = Math.random() < t.par, mult = POS_MULT[Math.abs(a.pos - t.pos)];
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
        msg(names + ' に <b class="num">' + num(dmg) + '</b> ダメージ' + (mult !== 1 ? '(列×' + mult + ')' : '') + (crit ? '(会心!)' : '') + (t.hp <= 0 ? ' 撃破!' : ''));
      }
      later(nextActor, parried ? 900 : 600);
    };
    if (RM || !a.el.animate) return hit();
    var r1 = a.el.getBoundingClientRect(), r2 = t.el.getBoundingClientRect();
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
      '<div class="fc-lead">HP=登録者、攻=1本あたり再生、速=投稿数、防=Xフォロワー、パリイ=過去21日の登録者伸び率。5枚で合計コスト' + BUDGET + '以内のデッキを組み、並びを考えて相手を全滅させたら勝ち。</div></div>' +
      '<div class="cb-build">' +
        '<div class="cb-slots"></div>' +
        '<div class="cb-meter-row"><span class="cb-meter-l">コスト</span><span class="cb-meter"><i></i></span><span class="cb-meter-v num"></span></div>' +
        '<div class="cb-bact"><button type="button" class="g-btn g-confirm cb-go" disabled></button><button type="button" class="g-btn g-x cb-auto">おまかせ</button><button type="button" class="g-btn g-x cb-clear">クリア</button></div>' +
        '<div class="cb-tools"><input type="search" class="cb-q" placeholder="チャンネル名で検索" aria-label="チャンネル名で検索">' +
          '<div class="vtype cb-sort"><button type="button" class="vt on" data-sort="cost">コスト</button><button type="button" class="vt" data-sort="hp">HP</button><button type="button" class="vt" data-sort="atk">攻</button><button type="button" class="vt" data-sort="spd">速</button><button type="button" class="vt" data-sort="def">防</button><button type="button" class="vt" data-sort="g">伸</button></div></div>' +
        '<div class="cb-list"></div>' +
      '</div>' +
      '<div class="cb-board" hidden>' +
        '<div class="cb-label">敵陣 <span class="cb-enemy-cost num"></span></div><div class="cb-row cb-row-enemy"></div>' +
        '<div class="cb-mid"><div class="cb-order"></div><div class="cb-msg" aria-live="polite"></div>' +
          '<div class="cb-actions"><button type="button" class="g-btn g-confirm cb-start">バトル開始</button><button type="button" class="g-btn g-x cb-reroll">相手を変える</button><button type="button" class="g-btn g-x cb-edit">デッキ編集</button></div>' +
          '<div class="cb-result" hidden><div class="cb-res-t"></div><div class="cb-res-s"></div><div class="cb-bact"><button type="button" class="g-btn g-confirm cb-again">もう一度</button><button type="button" class="g-btn g-x cb-edit2">デッキ編集</button></div></div>' +
        '</div>' +
        '<div class="cb-row cb-row-ally"></div><div class="cb-label">自陣 <span class="cb-ally-cost num"></span></div>' +
      '</div>' +
      '<div class="cb-rule">ダメージ = 攻撃 ÷ ' + ATK_DIV + ' × (1 − 軽減率) × 列の倍率。軽減率 = 防御 ÷ (防御 + ' + num(DEF_K) + ')。列の倍率は向かい×1.5、1列隣×1、2列×0.75、3列以上×0.5。' +
        'パリイ率 = 50% × 伸び率 ÷ (伸び率 + 10)。成功するとダメージを無効にし、1/4を反撃。Xが未登録のチャンネルは防御0、伸びていないチャンネルはパリイ0%。</div>';
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
