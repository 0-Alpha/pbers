/* PBers Card Battle(ゲームタブ)。デッキを組んで自陣5枚 vs 敵陣5枚のターン制バトル。
   能力値は実数そのまま: HP=登録者 / 白兵=横動画1本あたり再生数 / 遠戦=縦動画1本あたり再生数 / 防御=Xフォロワー(X未登録は0)。
   奇数ラウンドは遠戦(縦動画で攻撃、列は無関係)、偶数ラウンドは白兵戦(横動画で攻撃、向かいの敵ほど強い)。行動順はそれぞれの本数の多い順。
   パリイ率は過去21日の登録者伸び率(g21)から決まる。
   タイプ(ショート/両刀/長尺)はショート再生の割合で決まる三すくみ。拡散はXの30日投稿数で、生きている間は味方全体の攻撃を上げる。
   実数だと大手が圧倒するので、強さに比例するコストの合計(BUDGET)でデッキを制限する。
   余った予算で作戦(無断転載・抗無断転載・ネタ擦り・ブラックジョーク)を買える。それでも残った分はパラオパワーになり、バトル中のHPと攻撃を上げる(上限あり)。
   毎ラウンド、その戦いの手段を持つカードが1回ずつ攻撃する。自陣カードの番は攻撃先を選ぶ。
   相手は指定もできる(足りない枠は自動で埋める)。連戦は負けるまで続き、HPは持ち越しで、勝つたびに敵の予算が増える。
   同一人物のカード(d.twin)はデッキに片方だけ入り、倒れると同じ列にもう片方が現れる。サブチャンネル(d.backup)は倒れると順に現れて、すぐ攻撃する。田中MID(d.meme)は撃破すると1ターンに1回だけもう一度攻撃でき、本人の動画を埋め込みプレーヤーで少しだけ流す。
   敵の狙い方(AI)は対戦前に選べて、連戦では1戦ごとにランダムで決まる。 */
(function () {
  var BUDGET = 280;      // デッキの合計コスト上限
  var TOP_COST = 234;    // いちばん強いカードのコスト(これを基準に全カードのコストを決める)
  var COST_KNEE = 150, COST_OVER = 0.5;   // コストがこれを超える分は半額。1枚で予算の大半を使うと残り4枚が弱くなりすぎて、1位のカードがデッキでは最弱になる
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
  var PARAO_CAP = 3;                     // パラオパワーの倍率の上限。上限が無いと極端に軽いデッキが最強になる
  var ITEMS = {
    rep: { name: '無断転載', price: 25, desc: '毎ラウンド開始時、敵でいちばん強いカードの攻撃を転載して30%のダメージ' },
    anti: { name: '抗無断転載', price: 10, desc: '敵の無断転載を通報して、転載した側に跳ね返す' },
    neta: { name: 'ネタ擦り', price: 15, desc: '攻撃するたび威力+30%。5回目からは飽きられて×0.7' },
    black: { name: 'ブラックジョーク', price: 10, desc: '会心率40%・会心×2。ただし5%で滑って炎上し、最大HPの10%を失う' },
    collab: { name: 'コラボレーション', price: 25, desc: '選んだ2枚のHPと攻撃が1.2倍になり、片方が攻撃すると相方も同じ敵を攻撃する。ただし受けるダメージは2枚で半分ずつ' }
  };
  var COLLAB_RATE = 1.2, COLLAB_FOLLOW = 1, COLLAB_KEY = 'pbers_cb_collab', collabPick = [];   // 2枚の倍率と、相方の追撃の威力
  var REP_RATE = 0.3, NETA_STEP = 0.3, NETA_LIMIT = 4, NETA_STALE = 0.7;
  var BLACK_CRIT = 0.4, BLACK_CRIT_MULT = 2, BLACK_BURN = 0.05, BURN_HP = 0.1;
  var RUN_BASE = 100, RUN_STEP = 20;     // 連戦の敵の予算 = RUN_BASE + RUN_STEP × 連勝数
  var RUN_HEAL = 0.2, RUN_REVIVE = 0.15; // 勝った後、生き残りは最大HPの20%回復、倒れたカードは15%で復活
  var RUN_COIN = 20, RUN_INTEREST = 0.1, RUN_INTEREST_MAX = 5;   // 勝つともらえるコイン。残したコインには利子が付く
  var RS_HEAL = 0.3, RS_HEAL_COST = 5, RS_SWAP_COST = 10, RS_ITEM_COST = 5;   // ショップの回復量と値段
  var SPARE_GROW = 0.2;                  // 予備チャンネルのHPは、毎ラウンド本人の最大HPとの差をこの割合だけ埋める
  var TWIN_RATE = 0.5;                   // 同一人物のカードのコストに、もう片方のコストのこの割合を足す
  var AIS = {                            // 敵の狙い方。弱い順
    rand: { name: '気まぐれ', desc: 'ランダムに狙う。いちばん弱い' },
    ko: { name: '撃破優先', desc: '倒せる相手がいれば必ず先に倒す' },
    eff: { name: '効率重視', desc: '削れるHPの割合 × 相手の攻撃力で狙う。いちばん強い' }
  };
  var DEFAULT_AI = 'ko';
  var MY_TURN = "IT'S MY TURN!", ONE_MORE = 'ONE MORE GAME!', MEME_WAIT = 950;
  var VIDEO_KEY = 'pbers_cb_video', VIDEO_HOST = 'https://www.youtube-nocookie.com', VIDEO_VOLUME = 30, video = null;   // 音量は0〜100
  var SFX_ENABLED = false;   // 効果音は今はオフ。true にすると対戦画面に切り替えも出る
  var SFX_KEY = 'pbers_cb_sfx', audioCtx = null, audioOut = null;
  var DECK_KEY = 'pbers_cb_deck', ITEM_KEY = 'pbers_cb_items', BEST_KEY = 'pbers_cb_best', AI_KEY = 'pbers_cb_ai';
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var cards = [], root = null, game = null, token = 0;
  var deck = [], items = [], buildStep = 'cards', sortKey = 'cost', query = '', typeFilter = '';
  var foePick = [], foeFixed = null, foeSort = 'cost', foeQuery = '', run = null, aiKey = DEFAULT_AI;

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
  function itemSum(list) { return list.reduce(function (a, k) { return a + ITEMS[k].price; }, 0); }
  function leftOf(list, its) { return BUDGET - costSum(list) - itemSum(its); }
  /* 残った予算の分だけ倍率を掛ける。コストはHP×攻撃の平方根に比例するので、両方に掛けると残りの予算がそのまま総合力になる */
  function paraoOf(list, its, budget) { var s = costSum(list); return s > 0 ? Math.min(PARAO_CAP, 1 + Math.max(0, (budget || BUDGET) - s - itemSum(its)) / s) : 1; }
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
    var X = {}, XP = {}, shown = {};
    channels.forEach(function (d) { shown[d.slug] = true; });
    /* もう片方がジャンル設定で隠れていても、カードとして選べるようにする */
    var hidden = (window.PBERS_DATA || []).filter(function (d) { return !shown[d.slug] && channels.some(function (x) { return x.twin === d.slug; }); });
    (window.PBERS_X || []).forEach(function (x) { X[x.slug] = x.followers; XP[x.slug] = x.posts30 || 0; });
    var list = channels.concat(hidden).filter(function (d) { return d.subs && d.views && d.videos; }).map(function (d) {
      var def = X[d.slug] || 0, red = def / (def + DEF_K), sp = splitAtk(d);
      var g = d.g21 == null ? null : d.g21, par = g > 0 ? PARRY_MAX * g / (g + PARRY_K) : 0;
      var p30 = XP[d.slug] || 0, aura = AURA_MAX * p30 / (p30 + AURA_K);
      return { d: d, hp: d.subs, atkM: sp.atkM, atkR: sp.atkR, spdM: sp.spdM, spdR: sp.spdR, spd: d.videos, def: def, red: red, g: g, par: par, type: typeOf(d), p30: p30, aura: aura,
        power: Math.sqrt(d.subs / ((1 - red) * (1 - par)) * threat(sp) / 2) };
    });
    var max = list.reduce(function (a, c) { return Math.max(a, c.power); }, 1);
    var bySlug = {};
    list.forEach(function (c) {
      c.cost = Math.max(1, Math.round(c.power / max * TOP_COST) + Math.round(c.aura * AURA_COST));
      if (c.cost > COST_KNEE) c.cost = COST_KNEE + Math.round((c.cost - COST_KNEE) * COST_OVER);
      bySlug[c.d.slug] = c;
    });
    list.forEach(function (c) { c.twin = bySlug[c.d.twin] || null; c.own = c.cost; });
    list.forEach(function (c) { if (c.twin) c.cost = c.own + Math.round(c.twin.own * TWIN_RATE); c.spare = spareChain(c); });
    return list;
  }
  /* サブチャンネルはカードとしては選べず、コストも増えない。Xは本人と同じ。
     公開動画が0本のチャンネルは、攻撃を本人と同じにする(予備チャンネルは本人の動画を非公開で投稿済み) */
  function spareOf(c, b, i) {
    var real = b.views && b.videos ? splitAtk(b) : null, sp = real || c;
    return { d: { name: b.name, avatar: b.avatar, subs: b.subs, slug: c.d.slug + '#sub' + i, color: c.d.color, grad: c.d.grad }, hp: b.subs, atkM: sp.atkM, atkR: sp.atkR, spdM: sp.spdM, spdR: sp.spdR, spd: real ? b.videos : c.spd,
      def: c.def, red: c.red, g: null, par: 0, type: real ? typeOf(b) : c.type, p30: c.p30, aura: c.aura, cost: c.cost, twin: null, spare: null, borrowed: !real };
  }
  function spareChain(c) {   // 先頭が最初に出るカード。倒れると .spare が続く
    var next = null, list = c.d.backup || [];
    for (var i = list.length - 1; i >= 0; i--) { var s = spareOf(c, list[i], i); s.spare = next; next = s; }
    return next;
  }
  function chainOf(c) {   // このカードが倒れると出てくるカードを順に
    var out = [];
    for (var s = c.twin || c.spare; s; s = s.spare) out.push(s);
    return out;
  }
  function nextOf(u) { return u.t.spare || (!u.summoned && u.t.twin) || null; }   // 同一人物は1回だけ入れ替わる
  function minCost() { return cards.reduce(function (a, c) { return Math.min(a, c.cost); }, Infinity); }
  function clash(list, c) { return list.indexOf(c) >= 0 || (!!c.twin && list.indexOf(c.twin) >= 0); }   // 同じカードと同一人物は重ねない
  function canAdd(c) {
    if (clash(deck, c) || deck.length >= DECK) return false;
    return costSum(deck) + c.cost + (DECK - deck.length - 1) * minCost() <= BUDGET;   // 残り枠が埋められる分は残す
  }
  /* 敵・おまかせ用。枠ごとに残り予算を目安にばらつかせて選ぶので、大手1枚型も中堅並べ型も出る */
  function randomDeck(budget) {
    var bud = budget || BUDGET, best = null, mn = minCost();
    for (var tr = 0; tr < 40; tr++) {
      var d = [], left = bud;
      for (var slot = DECK; slot > 0; slot--) {
        var cap = left - mn * (slot - 1), tgt = left / slot * (0.3 + Math.random() * 1.7), used = d;
        var near = shuffle(cards.filter(function (c) { return !clash(used, c) && c.cost <= cap; }))
          .sort(function (a, b) { return Math.abs(a.cost - tgt) - Math.abs(b.cost - tgt); }).slice(0, 5);
        if (!near.length) break;
        var p = near[Math.floor(Math.random() * near.length)];
        d.push(p); left -= p.cost;
      }
      if (d.length < DECK) continue;
      if (!best || costSum(d) > costSum(best)) best = d;
      if (costSum(best) >= bud * 0.8) break;
    }
    return best || shuffle(cards.slice()).filter(function (c, i, a) { return !c.twin || a.indexOf(c.twin) < 0 || a.indexOf(c.twin) > i; }).slice(0, DECK);
  }
  /* 敵は6割の確率で「重いカードを軸に予算を使い切る」強いデッキにする(ばらつかせた編成だけだと大手デッキに必ず負ける) */
  function enemyDeck(budget) {
    var bud = budget || BUDGET;
    if (Math.random() >= 0.6) return randomDeck(bud);
    var mn = minCost(), srt = cards.slice().sort(function (a, b) { return b.cost - a.cost; });
    var top = srt.filter(function (c) { return c.cost <= bud - (DECK - 1) * mn; }).slice(0, 8);
    var d = [top[Math.floor(Math.random() * top.length)]];
    for (var slot = DECK - 1; slot > 0; slot--) {
      var cap = bud - costSum(d) - (slot - 1) * mn, used = d.slice();
      var near = srt.filter(function (c) { return !clash(used, c) && c.cost <= cap; }).slice(0, 4);
      if (!near.length) return randomDeck(bud);
      d.push(near[Math.floor(Math.random() * near.length)]);
    }
    return d;
  }
  /* 指定された相手の空き枠を埋める。指定だけで予算を超えていたら、残りはいちばん軽いカードにする */
  function fillFoe(pick) {
    var d = pick.slice(0, DECK), mn = minCost();
    var free = shuffle(cards.slice());
    while (d.length < DECK) {
      free = free.filter(function (c) { return !clash(d, c); });
      var cap = BUDGET - costSum(d) - (DECK - d.length - 1) * mn;
      var fit = free.filter(function (c) { return c.cost <= cap; }).sort(function (a, b) { return b.cost - a.cost; }).slice(0, 6);
      var p = fit.length ? fit[Math.floor(Math.random() * fit.length)] : free.slice().sort(function (a, b) { return a.cost - b.cost; })[0];
      d.push(p); free.splice(free.indexOf(p), 1);
    }
    return d;
  }
  function randomItems(list, budget) {   // 敵・おまかせ用
    var out = [], left = (budget || BUDGET) - costSum(list);
    shuffle(Object.keys(ITEMS)).forEach(function (k) {
      if (Math.random() < 0.5 && ITEMS[k].price <= left) { out.push(k); left -= ITEMS[k].price; }
    });
    return out;
  }
  /* コラボする2枚。選んだカードを優先し、足りない分はコストの高いカードで埋める(敵は自動) */
  function collabPair(list, pick) {
    var out = (pick || []).filter(function (s) { return list.some(function (c) { return c.d.slug === s; }); }).slice(0, 2);
    list.slice().sort(function (a, b) { return b.cost - a.cost; }).forEach(function (c) {
      if (out.length < 2 && out.indexOf(c.d.slug) < 0) out.push(c.d.slug);
    });
    return out;
  }
  function loadCollab() {
    try { var a = JSON.parse(localStorage.getItem(COLLAB_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function saveCollab() { try { localStorage.setItem(COLLAB_KEY, JSON.stringify(collabPick)); } catch (e) {} }
  function saveDeck() {
    if (run) return;   // 連戦の変更はその連戦だけ
    try {
      localStorage.setItem(DECK_KEY, JSON.stringify(deck.map(function (c) { return c.d.slug; })));
      localStorage.setItem(ITEM_KEY, JSON.stringify(items));
    } catch (e) {}
  }
  /* 自己ベストは日本版と海外版で別々に持つ。PBERS_BASE はこのファイルの後で設定されるので、使うときに読む */
  function bestKey() { return BEST_KEY + (window.PBERS_BASE === '/global/' ? '_global' : ''); }
  function bestRun() { try { return +localStorage.getItem(bestKey()) || 0; } catch (e) { return 0; } }
  function saveBest(n) { try { localStorage.setItem(bestKey(), String(n)); } catch (e) {} }
  function loadAI() {
    try { var k = localStorage.getItem(AI_KEY); return AIS.hasOwnProperty(k) ? k : DEFAULT_AI; } catch (e) { return DEFAULT_AI; }
  }
  function saveAI() { try { localStorage.setItem(AI_KEY, aiKey); } catch (e) {} }
  function loadItems(list) {
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem(ITEM_KEY) || '[]'); } catch (e) {}
    var out = (Array.isArray(saved) ? saved : []).filter(function (k) { return ITEMS.hasOwnProperty(k); });
    return leftOf(list, out) >= 0 ? out : [];
  }
  function loadDeck() {
    var slugs = [];
    try { slugs = JSON.parse(localStorage.getItem(DECK_KEY) || '[]'); } catch (e) {}
    var out = [];
    (Array.isArray(slugs) ? slugs : []).forEach(function (s) {
      var c = cards.filter(function (x) { return x.d.slug === s; })[0];
      if (c && !clash(out, c)) out.push(c);
    });
    return costSum(out) <= BUDGET && out.length <= DECK ? out : [];
  }

  function twinHelp() {   // 同一人物やサブチャンネルのカードがある版(日本版)だけ説明を出す
    var c = cards.filter(function (x) { return x.twin; })[0], s = cards.filter(function (x) { return x.spare; })[0];
    var m = cards.filter(function (x) { return x.d.meme; })[0];
    return (!m ? '' : '<dt>' + esc(MY_TURN) + '</dt><dd>' + esc(m.d.name) + 'のターンが来ると流れる。その攻撃で敵を撃破すると ' + ONE_MORE + ' で、もう1回攻撃できる(1ターンに1回まで)。本人の動画をYouTubeの埋め込みプレーヤーで少しだけ流す(対戦画面でオフにできる)。敵の' + esc(m.d.name) + 'は気まぐれ以外のAIで、倒せる中で攻撃順位がいちばん高い相手を狙い、もう1回攻撃では攻撃順位1位を狙う。</dd>') + (!s ? '' : '<dt>サブチャンネル</dt><dd>' + esc(s.d.name) + 'が倒れると、同じ列に' + chainOf(s).map(function (x) { return esc(x.d.name); }).join(' → ') + (chainOf(s).length > 1 ? 'の順に' : 'を') + '召喚する。召喚されたカードは順番に関係なくすぐ攻撃する。HPは登録者の実数で、攻撃も動画の実数。ただし公開動画が0本のチャンネルは、動画を非公開で投稿済みなので攻撃が本人と同じで、HPも毎ラウンド本人との差を' + SPARE_GROW * 100 + '%ずつ埋める。コストは増えない。</dd>') + (!c ? '' : '<dt>同一人物</dt><dd>' + esc(c.d.name) + 'と' + esc(c.twin.d.name) + 'は同じ人なので、デッキには片方だけ入る。倒れると同じ列にもう片方を召喚し、次のラウンドから動く。コストは自分 + もう片方の半分。</dd>');
  }
  function growthText(g) { return g == null ? '—' : (g > 0 ? '+' : '') + g + '%'; }
  function parText(c) { return Math.round(c.par * 100) + '%'; }

  /* ---- デッキ構築 ---- */
  var SORTS = {
    cost: function (c) { return c.cost; }, hp: function (c) { return c.hp; }, atkM: function (c) { return c.atkM; }, atkR: function (c) { return c.atkR; },
    spd: function (c) { return c.spd; }, def: function (c) { return c.def; }, g: function (c) { return c.g == null ? -Infinity : c.g; }, aura: function (c) { return c.aura; }
  };
  function slotsHTML(list, removeText) {
    var html = '';
    for (var i = 0; i < DECK; i++) {
      var c = list[i];
      html += c
        ? '<button type="button" class="cb-slot" data-i="' + i + '" style="--c:' + c.d.color + '" aria-label="' + esc(c.d.name) + ' を' + removeText + '">' +
            '<img src="' + av(c.d, 96) + '" alt="">' +
            '<span class="cb-slot-n">' + esc(c.d.name) + '</span><span class="cb-slot-c num">C' + c.cost + '</span></button>'
        : '<div class="cb-slot cb-slot-empty">空き</div>';
    }
    return html;
  }
  function renderSlots() {
    $('.cb-slots').innerHTML = slotsHTML(deck, 'デッキから外す');
    if (buildStep === 'items' && deck.length !== DECK) buildStep = 'cards';
    var onItems = buildStep === 'items', sum = costSum(deck) + (onItems ? itemSum(items) : 0);
    $('.cb-step-t').textContent = onItems ? '作戦を選ぶ' : 'カードを選ぶ';
    $('.cb-step-cards').hidden = onItems; $('.cb-step-items').hidden = !onItems;
    $('.cb-meter-v').textContent = sum + ' / ' + BUDGET;
    $('.cb-meter i').style.transform = 'scaleX(' + Math.min(sum / BUDGET, 1) + ')';
    var boost = paraoOf(deck, items), left = BUDGET - sum;
    $('.cb-parao-v').textContent = boostText(boost);
    $('.cb-parao-d').textContent = left <= 0 ? '予算を使い切ったので、強化はありません' :
      '残りの予算 ' + left + ' が自動で入り、バトル中のHPと攻撃が上がる' + (boost >= PARAO_CAP ? '(上限の×' + PARAO_CAP + 'です)' : '(最大×' + PARAO_CAP + ')');
    [].slice.call(root.querySelectorAll('button.cb-item')).forEach(function (el) {
      var k = el.dataset.item, on = items.indexOf(k) >= 0;
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', String(on));
      el.disabled = !on && left < ITEMS[k].price;
    });
    renderCollab();
    $('.cb-next').disabled = deck.length !== DECK;
    $('.cb-next').textContent = deck.length === DECK ? '次へ: 作戦を選ぶ' : 'あと' + (DECK - deck.length) + '枚';
    $('.cb-run-note').textContent = '連戦は負けるまで続きます。HPは持ち越しで、勝つたびに敵が強くなります。' + (bestRun() ? '自己ベスト ' + bestRun() + '連勝' : '');
    [].slice.call($('.cb-list').querySelectorAll('.cb-li')).forEach(function (el) {
      var r = cards[+el.dataset.i], on = deck.indexOf(r) >= 0;
      el.classList.toggle('on', on);
      el.disabled = !on && !canAdd(r);
      el.setAttribute('aria-pressed', String(on));
    });
  }
  function renderCollab() {
    var el = $('.cb-collab-pick'), show = buildStep === 'items' && items.indexOf('collab') >= 0;
    el.hidden = !show;
    if (show) collabChips(el);
  }
  function collabClick(e) {
    var b = e.target.closest('.cb-collab-c'); if (!b) return;
    var pair = collabPair(deck, collabPick), s = b.dataset.slug, at = pair.indexOf(s);
    if (at >= 0) return;   // 2枚のままにする。入れ替えは別のカードを押す
    collabPick = [pair[1], s];   // 古く選んだ方と入れ替える
    saveCollab();
    collabChips(b.parentNode);
  }
  function collabChips(el) {
    var pair = collabPair(deck, collabPick);
    el.innerHTML = '<span class="cb-collab-l">コラボする2枚を選ぶ</span>' + deck.map(function (c) {
      var on = pair.indexOf(c.d.slug) >= 0;
      return '<button type="button" class="cb-chip cb-collab-c' + (on ? ' on' : '') + '" data-slug="' + esc(c.d.slug) + '" aria-pressed="' + on + '">' + esc(c.d.name) + '</button>';
    }).join('');
  }
  function listExtras(c, sort) {   // 2行目は持っている能力だけ。並び替えに使っている値は必ず見せる
    var x = [];
    if (sort === 'spd') x.push('横 ' + num(c.spdM) + '本・縦 ' + num(c.spdR) + '本');
    if (c.def) x.push('防御 ' + num(c.def));
    if (sort === 'g') x.push('伸び ' + growthText(c.g));
    if (c.par) x.push('パリイ ' + parText(c));
    if (c.aura) x.push('拡散 +' + auraText(c) + (sort === 'aura' ? ' (30日' + c.p30 + '投稿)' : ''));
    if (c.d.meme) x.push('撃破するともう1回攻撃');
    if (chainOf(c).length) x.push('倒れると ' + chainOf(c).map(function (s) { return esc(s.d.name); }).join(' → ') + ' を召喚');
    return x.length ? '<span class="cb-li-x num">' + x.map(function (t) { return '<span>' + t + '</span>'; }).join('') + '</span>' : '';
  }
  function rowHTML(c, i, sort) {
    return '<button type="button" class="cb-li" data-i="' + i + '">' +
      '<img src="' + av(c.d, 96) + '" alt="" loading="lazy" style="border-color:' + c.d.color + '">' +
      '<span class="cb-li-b"><span class="cb-li-n">' + typeChip(c, 'cb-li-t') + esc(c.d.name) + '</span>' +
      '<span class="cb-li-s num"><span>HP ' + num(c.hp) + '</span><span>白兵 ' + num(c.atkM) + '</span><span>遠戦 ' + num(c.atkR) + '</span></span>' +
      listExtras(c, sort) + '</span>' +
      '<span class="cb-li-c num">C' + c.cost + '</span></button>';
  }
  function renderList() {
    var q = query.toLowerCase(), key = SORTS[sortKey];
    var rows = cards.map(function (c, i) { return { c: c, i: i }; }).filter(function (r) {
      return (!typeFilter || r.c.type === typeFilter) && (!q || r.c.d.name.toLowerCase().indexOf(q) >= 0);
    }).sort(function (a, b) { return key(b.c) - key(a.c); });
    $('.cb-list').innerHTML = rows.length ? rows.map(function (r) { return rowHTML(r.c, r.i, sortKey); }).join('') : '<div class="fc-empty">見つかりません</div>';
    renderSlots();
  }
  /* ---- 相手を選ぶ ---- */
  function renderFoeSlots() {
    $('.cb-foe-slots').innerHTML = slotsHTML(foePick, '相手から外す');
    var sum = costSum(foePick), open = DECK - foePick.length;
    $('.cb-foe-go').disabled = !foePick.length;
    $('.cb-foe-note').textContent = !foePick.length ? '戦いたいチャンネルを1〜5枚選んでください。足りない分は自動で埋まります。'
      : 'コスト ' + sum + (open ? '・残り' + open + '枚は自動で埋まります' : '') + (sum > BUDGET ? '・予算' + BUDGET + 'を超えても戦えます' : '');
    [].slice.call(root.querySelectorAll('.cb-foe-list .cb-li')).forEach(function (el) {
      var r = cards[+el.dataset.i], on = foePick.indexOf(r) >= 0;
      el.classList.toggle('on', on);
      el.disabled = !on && (foePick.length >= DECK || clash(foePick, r));
      el.setAttribute('aria-pressed', String(on));
    });
  }
  function renderFoeList() {
    var q = foeQuery.toLowerCase(), key = SORTS[foeSort];
    var rows = cards.map(function (c, i) { return { c: c, i: i }; }).filter(function (r) {
      return !q || r.c.d.name.toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return key(b.c) - key(a.c); });
    $('.cb-foe-list').innerHTML = rows.length ? rows.map(function (r) { return rowHTML(r.c, r.i, foeSort); }).join('') : '<div class="fc-empty">見つかりません</div>';
    renderFoeSlots();
  }
  function showFoe() {
    token++;
    game = null;
    $('.cb-board').hidden = true; $('.cb-foe').hidden = false;
    renderFoeList();
    $('.cb-foe').scrollIntoView({ block: 'start' });
  }
  function setupFoe() {
    $('.cb-foe-list').addEventListener('click', function (e) {
      var el = e.target.closest('.cb-li'); if (!el || el.disabled) return;
      var c = cards[+el.dataset.i], at = foePick.indexOf(c);
      if (at >= 0) foePick.splice(at, 1); else if (foePick.length < DECK) foePick.push(c);
      renderFoeSlots();
    });
    $('.cb-foe-slots').addEventListener('click', function (e) {
      var el = e.target.closest('button.cb-slot'); if (!el) return;
      foePick.splice(+el.dataset.i, 1); renderFoeSlots();
    });
    $('.cb-foe-q').addEventListener('input', function (e) { foeQuery = e.target.value.trim(); renderFoeList(); });
    $('.cb-foe-sort').addEventListener('change', function (e) { foeSort = e.target.value; renderFoeList(); });
    $('.cb-foe-go').addEventListener('click', function () {
      if (!foePick.length) return;
      foeFixed = fillFoe(foePick);
      $('.cb-foe').hidden = true;
      newBattle();
      $('.cb-board').scrollIntoView({ block: 'start' });
    });
    $('.cb-foe-back').addEventListener('click', function () {
      $('.cb-foe').hidden = true;
      newBattle();
      $('.cb-board').scrollIntoView({ block: 'start' });
    });
  }
  function showBuild() {
    token++;
    game = null;
    restoreRun();
    $('.cb-build').hidden = false; $('.cb-board').hidden = true; $('.cb-foe').hidden = true; $('.cb-rshop').hidden = true;
    buildStep = 'cards';
    run = null;
    renderList();
  }
  function setupBuild() {
    $('.cb-list').addEventListener('click', function (e) {
      var el = e.target.closest('.cb-li'); if (!el || el.disabled) return;
      var c = cards[+el.dataset.i], at = deck.indexOf(c);
      if (at >= 0) deck.splice(at, 1); else if (canAdd(c)) deck.push(c);
      while (leftOf(deck, items) < 0) items.pop();   // 重いカードに替えて予算を超えた作戦は外す
      saveDeck(); renderSlots();
    });
    $('.cb-slots').addEventListener('click', function (e) {
      var el = e.target.closest('button.cb-slot'); if (!el) return;
      deck.splice(+el.dataset.i, 1); saveDeck(); renderSlots();
    });
    $('.cb-auto').addEventListener('click', function () { deck = randomDeck().slice(); items = randomItems(deck); saveDeck(); renderSlots(); });
    $('.cb-clear').addEventListener('click', function () { deck = []; items = []; saveDeck(); renderSlots(); });
    $('.cb-shop').addEventListener('click', function (e) {
      var el = e.target.closest('button.cb-item'); if (!el || el.disabled) return;
      var k = el.dataset.item, at = items.indexOf(k);
      if (at >= 0) items.splice(at, 1); else items.push(k);
      saveDeck(); renderSlots();
    });
    $('.cb-collab-pick').addEventListener('click', collabClick);
    $('.cb-next').addEventListener('click', function () { if (deck.length === DECK) { buildStep = 'items'; renderSlots(); $('.cb-build').scrollIntoView({ block: 'start' }); } });
    $('.cb-back').addEventListener('click', function () { buildStep = 'cards'; renderSlots(); });
    $('.cb-go').addEventListener('click', function () { if (deck.length === DECK) { run = null; newBattle(); $('.cb-board').scrollIntoView({ block: 'start' }); } });
    $('.cb-run-go').addEventListener('click', function () { if (deck.length === DECK) { run = newRun(); newBattle(); $('.cb-board').scrollIntoView({ block: 'start' }); } });
    $('.cb-q').addEventListener('input', function (e) { query = e.target.value.trim(); renderList(); });
    $('.cb-tfilter').addEventListener('click', function (e) {
      var b = e.target.closest('.vt'); if (!b) return;
      typeFilter = b.dataset.type;
      [].slice.call(root.querySelectorAll('.cb-tfilter .vt')).forEach(function (x) { x.classList.toggle('on', x === b); });
      renderList();
    });
    $('.cb-sort').addEventListener('change', function (e) { sortKey = e.target.value; renderList(); });
  }

  /* ---- バトル ---- */
  function alive(list) { return list.filter(function (c) { return c.hp > 0; }); }
  function unit(c, side, pos, boost, collab) { var m = boost * (collab ? COLLAB_RATE : 1), hp = Math.round(c.hp * m); return { t: c, d: c.d, boost: boost, collab: !!collab, hp: hp, max: hp, atkM: Math.round(c.atkM * m), atkR: Math.round(c.atkR * m), spdM: c.spdM, spdR: c.spdR, def: c.def, red: c.red, g: c.g, par: c.par, type: c.type, p30: c.p30, aura: c.aura, cost: c.cost, side: side, pos: pos, n: 0, el: null }; }
  function teamBuff(side) { return alive(game[side]).reduce(function (a, c) { return a + c.aura; }, 0); }   // 倒されたカードの分は消える
  function atkNow(c) { return game.phase === 'm' ? c.atkM : c.atkR; }
  function posMult(a, t) { return game.phase === 'm' ? POS_MULT[Math.abs(a.pos - t.pos)] : 1; }   // 遠戦は列に関係なく届く
  function hitMult(a, t) { return posMult(a, t) * typeMult(a, t); }
  function hasItem(side, k) { return game.items[side].indexOf(k) >= 0; }
  function phaseDmg(c) { return atkNow(c) / (game.phase === 'm' ? MELEE_DIV : RANGED_DIV); }
  function netaMult(a) { return !hasItem(a.side, 'neta') ? 1 : a.n >= NETA_LIMIT ? NETA_STALE : parseFloat((1 + NETA_STEP * a.n).toFixed(2)); }
  function partnerOf(u) {   // コラボの相方。倒れたり召喚で入れ替わったりしたら解消
    return !u.collab ? null : game[u.side].filter(function (x) { return x !== u && x.collab && x.hp > 0; })[0] || null;
  }
  function hurt(u, d) {   // HPを減らす。相方がいれば半分ずつ受ける。戻り値は本人の分
    var p = partnerOf(u), mine = p ? Math.ceil(d / 2) : d;
    u.hp -= mine; paint(u);
    game.shared = p;
    if (p && d > mine) { p.hp -= d - mine; paint(p); pop(p, '-' + num(d - mine), ''); }
    return mine;
  }
  function sharedNote() { return game.shared ? '(<b style="color:' + game.shared.d.color + '">' + esc(game.shared.d.name) + '</b> も巻き添え)' : ''; }
  function dmgAt(a, t) { return dmgOf(a, t) * (partnerOf(t) ? 0.5 : 1); }   // 本人が実際に受ける分。撃破の見込みに使う
  function dmgOf(a, t) { return phaseDmg(a) * (1 - t.red) * hitMult(a, t) * (1 + teamBuff(a.side)) * netaMult(a); }
  function paintBuffs() {
    ['ally', 'enemy'].forEach(function (side) {
      var b = teamBuff(side);
      $('.cb-' + side + '-buff').textContent = b ? '拡散+' + (b * 100).toFixed(1) + '%' : '';
    });
  }
  function cardHTML(c) {
    var boosted = c.boost > 1 || c.collab;
    return '<button type="button" class="cb-card cb-' + rarOf(c.d) + (boosted ? ' cb-boosted' : '') + '" style="--c:' + c.d.color + '" disabled' +
      (boosted ? ' title="' + (c.boost > 1 ? 'パラオパワー' + boostText(c.boost) : '') + (c.collab ? ' コラボ×' + COLLAB_RATE : '') + '(実数 HP ' + num(c.t.hp) + ' / 白 ' + num(c.t.atkM) + ' / 遠 ' + num(c.t.atkR) + ')"' : '') + '>' +
      typeChip(c, 'cb-type') +
      (c.collab ? '<span class="cb-tag">コラボ</span>' : '') +
      (nextOf(c) ? '<span class="cb-twin" title="倒れると ' + esc(nextOf(c).d.name) + ' を召喚"><img src="' + av(nextOf(c).d, 96) + '" alt=""></span>' : '') +
      '<span class="cb-art" style="background:' + fill(c.d) + '"><img src="' + av(c.d, 96) + '" alt=""></span>' +
      '<span class="cb-mult num"></span>' +
      '<span class="cb-name">' + esc(c.d.name) + '</span>' +
      '<span class="cb-hpbar"><i></i></span>' +
      '<span class="cb-hp num"><span class="cb-hp-v"></span></span>' +
      '<span class="cb-stats num"><span class="cb-s-m">白' + num(c.atkM) + '</span><span class="cb-s-r">遠' + num(c.atkR) + '</span>' +
        '<span class="cb-more">防' + num(c.def) + '</span><span class="cb-more">パ' + parText(c) + '</span>' + (c.aura ? '<span class="cb-more">拡' + auraText(c) + '</span>' : '') + '</span>' +
      '</button>';
  }
  function paint(c) {
    var pct = Math.max(c.hp, 0) / c.max * 100;
    c.el.querySelector('.cb-hpbar i').style.transform = 'scaleX(' + pct / 100 + ')';
    c.el.classList.toggle('low', pct <= 30);
    c.el.querySelector('.cb-hp-v').textContent = num(c.hp);
    c.el.classList.toggle('cb-dead', c.hp <= 0);
    c.el.setAttribute('aria-label', c.d.name + ' HP' + Math.max(c.hp, 0) + '/' + c.max + ' 白兵' + c.atkM + ' 遠戦' + c.atkR + ' 防御' + c.def + ' パリイ' + parText(c) + ' 拡散' + auraText(c) + ' タイプ' + TYPES[c.type].label + (c.boost > 1 ? ' パラオパワー' + boostText(c.boost) : '') + (c.collab ? ' コラボ' : '') + (nextOf(c) ? ' 倒れると' + nextOf(c).d.name + 'を召喚' : ''));
  }
  function msg(html) { $('.cb-msg').innerHTML = html; }
  function later(fn, ms) { var t = token; setTimeout(function () { if (t === token) fn(); }, RM ? Math.min(ms, 150) : ms); }

  /* ---- 効果音。音声ファイルを使わず Web Audio で作るので、素材の権利を気にしなくてよい ---- */
  function sfxOn() {
    if (!SFX_ENABLED) return false;
    try { return localStorage.getItem(SFX_KEY) !== 'off'; } catch (e) { return true; }
  }
  function audio() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
      audioOut = audioCtx.createGain();
      audioOut.gain.value = 0.6;
      var limit = audioCtx.createDynamicsCompressor();
      audioOut.connect(limit); limit.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function sTone(c, out, t, o) {
    var osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.v, t + (o.a || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.d);
    osc.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + o.d + 0.02);
  }
  function sNoise(c, out, t, o) {
    var n = Math.ceil(c.sampleRate * o.d), buf = c.createBuffer(1, n, c.sampleRate), data = buf.getChannelData(0);
    for (var i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    var src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf;
    f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.f, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + o.d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.v, t + (o.a || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.d);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t);
  }
  var SFX = {
    shot: function (c, o, t) {   // 遠戦の発射
      sTone(c, o, t, { type: 'triangle', f: 1100, to: 260, d: 0.13, v: 0.5 });
      sNoise(c, o, t, { type: 'highpass', f: 2500, d: 0.06, v: 0.07 });
    },
    hit: function (c, o, t) {
      sNoise(c, o, t, { f: 2200, to: 500, d: 0.11, v: 0.42 });
      sTone(c, o, t, { f: 170, to: 60, d: 0.15, v: 0.5 });
    },
    crit: function (c, o, t) {   // 会心は高い音を重ねる
      SFX.hit(c, o, t);
      sTone(c, o, t, { type: 'square', f: 1500, to: 700, d: 0.16, v: 0.13 });
      sTone(c, o, t + 0.05, { type: 'square', f: 2100, to: 1100, d: 0.16, v: 0.09 });
    },
    ko: function (c, o, t) {   // 撃破は低く長く
      sNoise(c, o, t, { f: 1800, to: 180, d: 0.34, v: 0.5 });
      sTone(c, o, t, { f: 130, to: 34, d: 0.42, v: 0.62 });
    },
    parry: function (c, o, t) {   // 金属音。倍音を整数倍からずらす
      [1460, 2170, 3190, 4310].forEach(function (f, i) { sTone(c, o, t, { type: 'triangle', f: f, d: 0.34 - i * 0.06, v: 0.24 - i * 0.04 }); });
      sNoise(c, o, t, { type: 'highpass', f: 3500, d: 0.05, v: 0.22 });
    },
    burn: function (c, o, t) {   // 炎上
      sNoise(c, o, t, { type: 'bandpass', f: 350, to: 1900, d: 0.42, v: 1.6, a: 0.08 });
      sTone(c, o, t, { type: 'sawtooth', f: 300, to: 90, d: 0.32, v: 0.2 });
    },
    stamp: function (c, o, t) {   // 無断転載の判
      sNoise(c, o, t, { f: 1400, to: 300, d: 0.09, v: 0.5 });
      sTone(c, o, t, { f: 210, to: 75, d: 0.12, v: 0.55 });
    },
    report: function (c, o, t) {   // 通報
      sTone(c, o, t, { type: 'square', f: 880, d: 0.1, v: 0.3 });
      sTone(c, o, t + 0.12, { type: 'square', f: 660, d: 0.14, v: 0.3 });
    },
    summon: function (c, o, t) {   // カードが回る間にせり上がり、入れ替わる瞬間に鳴る
      sNoise(c, o, t, { type: 'bandpass', f: 300, to: 3200, d: 0.38, v: 0.34, a: 0.2 });
      sTone(c, o, t, { type: 'sawtooth', f: 110, to: 660, d: 0.38, v: 0.12, a: 0.2 });
      [523.25, 783.99, 1046.5, 1567.98].forEach(function (f, i) { sTone(c, o, t + 0.38 + i * 0.03, { type: 'triangle', f: f, d: 0.6, v: 0.2 - i * 0.03 }); });
      sTone(c, o, t + 0.38, { f: 120, to: 50, d: 0.22, v: 0.5 });
    },
    heal: function (c, o, t) {   // 予備チャンネルのHPが増える
      sTone(c, o, t, { f: 520, to: 880, d: 0.2, v: 0.32, a: 0.03 });
      sTone(c, o, t + 0.07, { f: 780, to: 1320, d: 0.2, v: 0.2, a: 0.03 });
    },
    win: function (c, o, t) {
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { sTone(c, o, t + i * 0.1, { type: 'triangle', f: f, d: i === 3 ? 0.55 : 0.2, v: 0.5 }); });
    },
    lose: function (c, o, t) {
      [392, 329.63, 261.63].forEach(function (f, i) { sTone(c, o, t + i * 0.16, { type: 'triangle', f: f, d: i === 2 ? 0.6 : 0.24, v: 0.5 }); });
    }
  };
  function sfx(name) {
    if (!sfxOn()) return;
    try { var c = audio(); if (c) SFX[name](c, audioOut, c.currentTime + 0.005); } catch (e) {}
  }
  function paintSfx() {
    $('.cb-sfx-btn').hidden = !SFX_ENABLED;
    $('.cb-sfx-btn').textContent = '効果音: ' + (sfxOn() ? 'オン' : 'オフ');
    $('.cb-sfx-btn').setAttribute('aria-pressed', String(sfxOn()));
  }

  /* ---- 連戦のショップ。勝つとコインがもらえ、次の戦いの前に使える。1コインで予算が1増える。カードと作戦の変更は連戦の間だけで、デッキの保存は変えない ---- */
  function newRun() { return { wins: 0, hp: null, over: false, coins: 0, budget: BUDGET, swap: null, q: '', base: { deck: deck.slice(), items: items.slice() } }; }
  function restoreRun() { if (run && run.base) { deck = run.base.deck; items = run.base.items; } }
  function hpRatio(c) { var r = run.hp && run.hp[c.d.slug]; return r == null ? 1 : r; }
  function runUsed() { return costSum(deck) + itemSum(items); }
  function showRunShop() {
    token++;
    game = null;
    run.swap = null;
    $('.cb-board').hidden = true; $('.cb-rshop').hidden = false;
    renderRunShop();
    $('.cb-rshop').scrollIntoView({ block: 'start' });
  }
  function rsBtn(act, label, off, data) {
    return '<button type="button" class="g-btn g-x cb-rs-btn" data-act="' + act + '"' + (data != null ? ' data-v="' + esc(data) + '"' : '') + (off ? ' disabled' : '') + '>' + label + '</button>';
  }
  function renderRunShop() {
    var used = runUsed(), room = run.budget - used, coins = run.coins, boost = paraoOf(deck, items, run.budget), capped = boost >= PARAO_CAP;
    $('.cb-rs-coin').textContent = coins;
    $('.cb-rs-wins').textContent = run.wins + '連勝中';
    $('.cb-rs-parao').innerHTML =
      '<div class="cb-rs-line"><span class="cb-rs-n">パラオパワー <b class="num">' + boostText(boost) + '</b></span><span class="cb-rs-d">' + (capped ? '上限の×' + PARAO_CAP + 'です。これ以上注いでも上がりません。' : '1コインで予算+1。') + '今の予算は使用 ' + used + ' / ' + run.budget + '</span></div>' +
      '<div class="cb-rs-acts">' + rsBtn('parao', '+5', capped || coins < 5, 5) + rsBtn('parao', '+20', capped || coins < 20, 20) + rsBtn('parao', '全部', capped || coins < 1, coins) + '</div>';
    $('.cb-rs-cards').innerHTML = deck.map(function (c, i) {
      var r = hpRatio(c);
      return '<div class="cb-rs-row"><img src="' + av(c.d, 96) + '" alt="" style="border-color:' + c.d.color + '">' +
        '<div class="cb-rs-line"><span class="cb-rs-n">' + esc(c.d.name) + ' <span class="cb-rs-c num">C' + c.cost + '</span></span>' +
        '<span class="cb-hpbar"><i style="transform:scaleX(' + r + ')"></i></span><span class="cb-rs-d num">HP ' + Math.round(r * 100) + '%</span></div>' +
        '<div class="cb-rs-acts">' + rsBtn('heal', '回復+' + RS_HEAL * 100 + '% <small>' + RS_HEAL_COST + '</small>', r >= 1 || coins < RS_HEAL_COST, i) + rsBtn('swap', '入れ替え <small>' + RS_SWAP_COST + '</small>', coins < RS_SWAP_COST, i) + '</div></div>';
    }).join('');
    $('.cb-rs-items').innerHTML = Object.keys(ITEMS).map(function (k) {
      var on = items.indexOf(k) >= 0;
      return '<div class="cb-rs-row"><div class="cb-rs-line"><span class="cb-rs-n">' + ITEMS[k].name + ' <span class="cb-rs-c num">予算' + ITEMS[k].price + '</span></span><span class="cb-rs-d">' + ITEMS[k].desc + '</span></div>' +
        '<div class="cb-rs-acts">' + (on ? rsBtn('itemoff', '外す', false, k) : rsBtn('itemon', '付ける <small>' + RS_ITEM_COST + '</small>', coins < RS_ITEM_COST || room < ITEMS[k].price, k)) + '</div></div>';
    }).join('');
    $('.cb-rs-pick').hidden = items.indexOf('collab') < 0;
    if (items.indexOf('collab') >= 0) collabChips($('.cb-rs-pick'));
    var sw = $('.cb-rs-swap');
    sw.hidden = run.swap == null;
    if (run.swap != null) renderRunSwap();
  }
  function renderRunSwap() {
    var old = deck[run.swap], room = run.budget - runUsed() + old.cost, q = run.q.toLowerCase();
    $('.cb-rs-swap-t').textContent = old.d.name + ' と入れ替えるカード(予算の残り ' + room + ')';
    var rows = cards.map(function (c, i) { return { c: c, i: i }; }).filter(function (r) {
      return deck.indexOf(r.c) < 0 && (!r.c.twin || deck.indexOf(r.c.twin) < 0 || r.c.twin === old) && (!q || r.c.d.name.toLowerCase().indexOf(q) >= 0);
    }).sort(function (a, b) { return b.c.cost - a.c.cost; });
    $('.cb-rs-list').innerHTML = rows.length ? rows.map(function (r) { return rowHTML(r.c, r.i, 'cost'); }).join('') : '<div class="fc-empty">見つかりません</div>';
    [].slice.call($('.cb-rs-list').querySelectorAll('.cb-li')).forEach(function (el) { el.disabled = cards[+el.dataset.i].cost > room; });
  }
  function setupRunShop() {
    $('.cb-rshop').addEventListener('click', function (e) {
      var b = e.target.closest('.cb-rs-btn');
      if (!b || b.disabled || !run) return;
      var act = b.dataset.act, v = b.dataset.v;
      if (act === 'parao') { var n = Math.min(+v, run.coins); run.coins -= n; run.budget += n; }
      if (act === 'heal') {
        var c = deck[+v];
        run.hp = run.hp || {};
        run.hp[c.d.slug] = Math.min(1, hpRatio(c) + RS_HEAL);
        run.coins -= RS_HEAL_COST;
      }
      if (act === 'swap') { run.swap = +v; run.q = ''; $('.cb-rs-q').value = ''; }
      if (act === 'itemon') { items.push(v); run.coins -= RS_ITEM_COST; }
      if (act === 'itemoff') items.splice(items.indexOf(v), 1);
      if (act === 'swapcancel') run.swap = null;
      renderRunShop();
      if (act === 'swap') $('.cb-rs-swap').scrollIntoView({ block: 'start' });
    });
    $('.cb-rs-list').addEventListener('click', function (e) {
      var el = e.target.closest('.cb-li');
      if (!el || el.disabled || run.swap == null) return;
      deck[run.swap] = cards[+el.dataset.i];
      run.coins -= RS_SWAP_COST;
      run.swap = null;
      renderRunShop();
      $('.cb-rshop').scrollIntoView({ block: 'start' });
    });
    $('.cb-rs-q').addEventListener('input', function (e) { run.q = e.target.value.trim(); renderRunSwap(); });
    $('.cb-rs-pick').addEventListener('click', collabClick);
    $('.cb-rs-go').addEventListener('click', function () {
      $('.cb-rshop').hidden = true;
      newBattle();
      $('.cb-board').scrollIntoView({ block: 'start' });
    });
    $('.cb-rs-quit').addEventListener('click', showBuild);
  }

  function newBattle() {
    token++;
    var foeBudget = run ? RUN_BASE + RUN_STEP * run.wins : BUDGET;
    var foeDeck = shuffle((run ? enemyDeck(foeBudget) : foeFixed || enemyDeck()).slice());
    var foeItems = randomItems(foeDeck, foeBudget), myBoost = paraoOf(deck, items, run ? run.budget : BUDGET), foeBoost = paraoOf(foeDeck, foeItems, foeBudget);
    var myPair = items.indexOf('collab') >= 0 ? collabPair(deck, collabPick) : [], foePair = foeItems.indexOf('collab') >= 0 ? collabPair(foeDeck) : [];
    var mine = deck.map(function (c, i) {
      var u = unit(c, 'ally', i, myBoost, myPair.indexOf(c.d.slug) >= 0);
      if (run && run.hp && run.hp[c.d.slug] != null) u.hp = Math.max(1, Math.round(u.max * run.hp[c.d.slug]));   // 連戦はHPの割合を持ち越す
      return u;
    });
    var foes = foeDeck.map(function (c, i) { return unit(c, 'enemy', i, foeBoost, foePair.indexOf(c.d.slug) >= 0); });
    var keys = Object.keys(AIS);
    game = { ally: mine, enemy: foes, fallen: [], ai: run ? keys[Math.floor(Math.random() * keys.length)] : aiKey, items: { ally: items.slice(), enemy: foeItems }, queue: [], round: 0, actor: null, arranging: true, picked: null };
    $('.cb-build').hidden = true; $('.cb-board').hidden = false;
    renderRow(foes, '.cb-row-enemy'); renderRow(mine, '.cb-row-ally');
    setSwappable(true);
    paintBuffs();
    $('.cb-enemy-boost').textContent = foeBoost > 1 ? 'パラオパワー' + boostText(foeBoost) : '';
    $('.cb-ally-boost').textContent = myBoost > 1 ? 'パラオパワー' + boostText(myBoost) : '';
    ['ally', 'enemy'].forEach(function (s) {
      $('.cb-' + s + '-items').innerHTML = game.items[s].map(function (k) { return '<span class="cb-chip" data-item="' + k + '">' + ITEMS[k].name + '</span>'; }).join('');
    });
    $('.cb-order').innerHTML = '';
    $('.cb-result').hidden = true;
    $('.cb-actions').hidden = false;
    delete $('.cb-board').dataset.phase;
    $('.cb-run').textContent = run ? '連戦 ' + (run.wins + 1) + '戦目' + (bestRun() ? '(自己ベスト ' + bestRun() + '連勝)' : '') : '';
    $('.cb-ai').hidden = !!run;   // 連戦のAIはランダムなので選ばせない
    paintAI();
    setupVideo();
    $('.cb-pick').hidden = !!run; $('.cb-reroll').hidden = !!run;
    $('.cb-edit').textContent = run ? '連戦をやめる' : 'デッキ編集';
    msg('自陣のカードを2枚タップで入れ替え。<b>白兵戦は向かいの敵に×1.5</b>');
  }
  function paintAI() {
    var a = AIS[game.ai];
    $('.cb-enemy-ai').textContent = 'AI: ' + a.name;
    $('.cb-enemy-ai').title = a.desc;
    $('.cb-ai-d').textContent = a.desc;
    [].slice.call(root.querySelectorAll('.cb-ai .vt')).forEach(function (b) {
      var on = b.dataset.ai === game.ai;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  function renderRow(list, sel) {
    $(sel).innerHTML = list.map(cardHTML).join('');
    [].slice.call(root.querySelectorAll(sel + ' .cb-card')).forEach(function (el, i) { bindCard(list[i], el); });
  }
  function bindCard(u, el) {
    u.el = el; paint(u);
    el.addEventListener('click', function () { if (game.arranging) swapPick(u); else choose(u); });
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
    $('.cb-ai').hidden = true;
    $('.cb-video-note').hidden = true;
    nextRound();
  }
  function nextRound() {
    game.round++;
    game.phase = game.round % 2 ? 'r' : 'm';
    var spd = game.phase === 'm' ? 'spdM' : 'spdR';
    game.queue = shuffle(alive(game.ally).concat(alive(game.enemy))).filter(function (c) { return atkNow(c) > 0; }).sort(function (a, b) { return b[spd] - a[spd]; });
    $('.cb-board').dataset.phase = game.phase;
    game.ally.concat(game.enemy).forEach(function (c) { c.el.classList.toggle('cb-idle', c.hp > 0 && atkNow(c) <= 0); });
    paintOrder(); setActive(null); setTargets(false);
    growSpares();
    runReposts(shuffle(['ally', 'enemy']).filter(function (s) { return hasItem(s, 'rep'); }));
  }
  /* 無断転載: 敵でいちばん強いカードの攻撃を転載して、敵のHP最小のカードに当てる。相手が抗無断転載を持っていれば転載した側に返る */
  function runReposts(list) {
    var f = fallenTwin();
    if (f) return summon(f, function () { runReposts(list); });
    if (!list.length) return nextActor();
    var side = list.shift(), foeSide = side === 'ally' ? 'enemy' : 'ally', me = alive(game[side]), fo = alive(game[foeSide]);
    if (!me.length || !fo.length) return nextActor();
    var src = fo.slice().sort(function (a, b) { return atkNow(b) - atkNow(a); })[0], raw = phaseDmg(src) * REP_RATE;
    if (raw <= 0) return runReposts(list);
    var back = hasItem(foeSide, 'anti');
    var t = (back ? me : fo).slice().sort(function (a, b) { return a.hp - b.hp; })[0];
    var aim = back ? fo.slice().sort(function (a, b) { return a.hp - b.hp; })[0] : t;
    var dmg = Math.max(1, Math.round(raw * (1 - t.red)));
    var who = side === 'ally' ? '自陣' : '敵陣', name = '<b style="color:' + src.d.color + '">' + esc(src.d.name) + '</b>', tn = '<b style="color:' + t.d.color + '">' + esc(t.d.name) + '</b>';
    msg(who + 'が ' + name + ' の動画を<b>無断転載!</b>');
    var land = function () {
      var taken = hurt(t, dmg); paintBuffs();
      sfx(t.hp <= 0 ? 'ko' : 'hit');
      pop(t, '-' + num(taken), '');
      shake(t);
      msg(who + 'が ' + name + ' の動画を<b>無断転載!</b> ' + (back ? '<b>通報されて</b> ' : '') + (t === src ? '本人に' : tn + ' に') + ' <b class="num">' + num(dmg) + '</b> ダメージ' + (t.hp <= 0 ? ' 撃破!' : '') + sharedNote());
      later(function () { runReposts(list); }, 1100);
    };
    if (RM || !t.el.animate) return land();
    repostShow(side, foeSide, src, aim, t, back, land);
  }
  /* 召喚: 倒れたカードの列に次のカードが出る。同一人物は次のラウンドから動き、サブチャンネルは順番に関係なくすぐ攻撃する */
  function growSpares() {   // 本人の登録者が予備チャンネルへ移ってくる
    game.ally.concat(game.enemy).forEach(function (c) {
      var g = c.growTo && c.hp > 0 ? Math.round((c.growTo - c.max) * SPARE_GROW) : 0;
      if (g < 1) return;
      c.max += g; c.hp += g;
      paint(c);
      pop(c, '+' + num(g), 'heal');
      sfx('heal');
    });
  }
  function fallenTwin() {
    return game.ally.concat(game.enemy).filter(function (c) { return c.hp <= 0 && nextOf(c); })[0];
  }
  function summon(u, done) {
    var w = unit(nextOf(u), u.side, u.pos, u.boost), row = game[u.side];
    w.summoned = true;
    if (u.side === 'ally') {
      game.fallen.push(u);
      if (run && run.hp && run.hp[w.d.slug] != null) w.hp = Math.max(1, Math.round(w.max * run.hp[w.d.slug]));   // 連戦で前に出ていたならHPを持ち越す
    }
    if (w.t.borrowed) w.growTo = u.max;
    row[row.indexOf(u)] = w;
    msg('<b style="color:' + u.d.color + '">' + esc(u.d.name) + '</b> が倒れた! <b style="color:' + w.d.color + '">' + esc(w.d.name) + '</b> を召喚!' + (w.t.borrowed ? ' 非公開の動画を一斉公開!' : ''));
    var show = !RM && !!u.el.animate, SPIN_OUT = 380, SPIN_IN = 640;
    summonBanner(w, show);
    sfx('summon');
    if (show) {   // 同じ人の表と裏: 倒れたカードが加速しながら回り、真横を向いた瞬間に別の顔へ替わる
      summonRing(u, w);
      u.el.style.zIndex = 3;
      u.el.animate([
        { transform: 'perspective(700px) rotateY(0deg) scale(1)', opacity: 0.35, filter: 'grayscale(1)' },
        { transform: 'perspective(700px) rotateY(630deg) scale(1.16)', opacity: 1, filter: 'grayscale(0) brightness(1.7)' }
      ], { duration: SPIN_OUT, easing: 'cubic-bezier(.55,0,.9,.4)', fill: 'forwards' });
    }
    later(function () {
      var box = document.createElement('div');
      box.innerHTML = cardHTML(w);
      var el = box.firstChild;
      u.el.parentNode.replaceChild(el, u.el);
      bindCard(w, el);
      el.classList.toggle('cb-idle', atkNow(w) <= 0);
      if (u.t.spare && atkNow(w) > 0) game.queue.unshift(w);
      paintBuffs(); paintOrder();
      if (show) {
        el.style.zIndex = 3;
        el.animate([
          { transform: 'perspective(700px) rotateY(90deg) scale(1.16)', filter: 'brightness(1.7)' },
          { transform: 'perspective(700px) rotateY(1080deg) scale(1)', filter: 'brightness(1)' }
        ], { duration: SPIN_IN, easing: 'cubic-bezier(.16,1,.3,1)' }).onfinish = function () { el.style.zIndex = ''; };
      } else if (el.animate) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
      }
      later(done, show ? SPIN_IN + 240 : 400);
    }, show ? SPIN_OUT : 0);
  }
  function summonBanner(w, moving) {   // 帯が左から走り、右へ抜ける。動きを減らす設定では出して消すだけ
    var bar = document.createElement('div'), T = moving ? 1260 : 700;
    bar.className = 'cb-summon';
    bar.setAttribute('aria-hidden', 'true');   // 同じ内容をメッセージ欄が読み上げる
    bar.style.setProperty('--c', w.d.color);
    bar.style.top = root.querySelector('.cb-order').offsetTop + 'px';
    bar.innerHTML = '<span class="cb-summon-n">' + esc(w.d.name) + '</span><b>召喚!</b>';
    $('.cb-board').appendChild(bar);
    if (bar.animate) bar.animate(moving ? [
      { clipPath: 'inset(0 100% 0 0)', offset: 0 },
      { clipPath: 'inset(0 100% 0 0)', offset: 280 / T, easing: 'cubic-bezier(.16,1,.3,1)' },
      { clipPath: 'inset(0 0 0 0)', offset: 520 / T },
      { clipPath: 'inset(0 0 0 0)', offset: 1120 / T, easing: 'ease-in' },
      { clipPath: 'inset(0 0 0 100%)', offset: 1 }
    ] : [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: T, fill: 'forwards' });
    setTimeout(function () { bar.remove(); }, T);   // 対戦を抜けた後でも必ず片付ける
  }
  function summonRing(u, w) {   // カードと逆回りの光の輪。はみ出してページが横に伸びないよう .cb-fx の中に置く
    var fx = document.createElement('div'), ring = document.createElement('span'), p = centerOf(u.el), size = u.el.offsetWidth * 1.7;
    fx.className = 'cb-fx'; ring.className = 'cb-ring';
    ring.style.cssText = 'width:' + size + 'px;height:' + size + 'px;left:' + (p.x - size / 2) + 'px;top:' + (p.y - size / 2) + 'px;--c:' + w.d.color;
    fx.appendChild(ring);
    $('.cb-board').appendChild(fx);
    ring.animate([
      { transform: 'rotate(0deg) scale(.45)', opacity: 0 },
      { transform: 'rotate(-160deg) scale(1)', opacity: 1, offset: 0.35 },
      { transform: 'rotate(-300deg) scale(1.08)', opacity: 1, offset: 0.75 },
      { transform: 'rotate(-380deg) scale(1.3)', opacity: 0 }
    ], { duration: 1150, easing: 'ease-out' });
    setTimeout(function () { fx.remove(); }, 1150);
  }
  function centerOf(el) {
    var b = $('.cb-board').getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - b.left, y: r.top + r.height / 2 - b.top };
  }
  function shake(c) {
    c.el.animate([
      { transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' },
      { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }
    ], { duration: 240 });
  }
  function stampIn(el, text, cls) {
    el.textContent = text;
    el.className = 'cb-stamp' + (cls ? ' ' + cls : '');
    el.animate([
      { transform: 'translate(-50%,-50%) rotate(-5deg) scale(1.9)', opacity: 0 },
      { transform: 'translate(-50%,-50%) rotate(-5deg) scale(1)', opacity: 1 }
    ], { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  /* 無断転載の演出: 判を押す → 元のカードからアイコンの複製が出る → 相手のカードへ飛ぶ。通報されたら転載した側へ戻ってくる */
  function repostShow(side, foeSide, src, aim, t, back, land) {
    var board = $('.cb-board'), COPY = 480, FLY = 400, HOLD = 260;
    var total = COPY + FLY + (back ? HOLD + FLY : 0);
    var stamp = document.createElement('span'), ghost = document.createElement('span');
    var chip = $('.cb-' + side + '-items [data-item=rep]'), antiChip = back ? $('.cb-' + foeSide + '-items [data-item=anti]') : null;
    stamp.style.top = root.querySelector('.cb-order').offsetTop + 'px';   // 下のメッセージに重ねない
    ghost.className = 'cb-ghost';
    ghost.style.background = fill(src.d);
    ghost.innerHTML = '<img src="' + av(src.d, 96) + '" alt=""><b>転載</b>';
    board.appendChild(stamp); board.appendChild(ghost);
    stampIn(stamp, '無断転載!', '');
    sfx('stamp');
    src.el.classList.add('cb-reposted');
    if (chip) chip.classList.add('fire');
    var half = ghost.offsetWidth / 2, at = function (p, s) { return 'translate(' + (p.x - half) + 'px,' + (p.y - half) + 'px) scale(' + s + ')'; };
    var a = centerOf(src.el), b = centerOf(aim.el), c = centerOf(t.el);
    var frames = [
      { transform: at(a, 0.4), opacity: 0, offset: 0 },
      { transform: at(a, 1.15), opacity: 1, offset: 0.5 * COPY / total },
      { transform: at(a, 1), opacity: 1, offset: COPY / total },
      { transform: at(b, 1), opacity: 1, offset: (COPY + FLY) / total }
    ];
    if (back) frames.push(
      { transform: at(b, 1.15), opacity: 1, offset: (COPY + FLY + HOLD) / total },
      { transform: at(c, 1), opacity: 1, offset: 1 }
    );
    ghost.animate(frames, { duration: total, easing: 'ease-in-out', fill: 'forwards' });
    if (back) later(function () {
      stampIn(stamp, '通報!', 'report');
      sfx('report');
      if (antiChip) antiChip.classList.add('fire');
      shake(aim);
    }, COPY + FLY);
    later(function () { ghost.remove(); land(); }, total);
    setTimeout(function () {   // 対戦を抜けた後でも必ず片付ける
      stamp.remove(); ghost.remove();
      src.el.classList.remove('cb-reposted');
      if (chip) chip.classList.remove('fire');
      if (antiChip) antiChip.classList.remove('fire');
    }, total + 1000);
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
      var d = t && actor ? dmgAt(actor, c) : 0;   // 列・相性・防御・拡散をまとめた「この敵に与えるダメージ」の目安
      m.textContent = !d ? '' : d * 0.85 >= c.hp ? '撃破' : d * 1.15 >= c.hp ? '撃破?' : num(Math.round(d));
      m.title = d ? '列×' + posMult(actor, c) + ' 相性×' + typeMult(actor, c) : '';
      m.classList.toggle('adv', !!(t && actor) && typeMult(actor, c) > 1);
      m.classList.toggle('dis', !!(t && actor) && typeMult(actor, c) < 1);
    });
  }
  function nextActor() {
    var f = fallenTwin();
    if (f) return summon(f, nextActor);
    if (!alive(game.ally).length || !alive(game.enemy).length) return finish();
    while (game.queue.length && game.queue[0].hp <= 0) game.queue.shift();
    if (!game.queue.length) return nextRound();
    var c = game.queue[0];
    if (c.d.meme && c.memeRound !== game.round) {   // ターンの最初に1回だけ流す
      c.memeRound = game.round;
      paintOrder(); setActive(c); setTargets(false);
      msg('<b style="color:' + c.d.color + '">' + esc(c.d.name) + '</b> ' + esc(MY_TURN));
      memeBanner(MY_TURN, '');
      return playClip(c.d.meme.turn, nextActor);
    }
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
  /* 敵の田中は気まぐれ以外のAIで、倒せる中で攻撃順位がいちばん高い相手を狙い、もう1回攻撃では攻撃順位1位を狙う。倒せる相手がいなければ通常のAIに任せる */
  function memeTarget(c, foes) {
    var rank = function (f) { return atkNow(f) <= 0 ? -1 : game.phase === 'm' ? f.spdM : f.spdR; };   // このラウンドに動けないカードは最後
    var order = foes.slice().sort(function (a, b) { return rank(b) - rank(a); });
    if (c.moreRound === game.round) return order[0];
    return order.filter(function (f) { return f.hp <= dmgAt(c, f) * 0.85; })[0] || null;
  }
  function aiTarget(c) {   // 「削れるHPの割合 × 相手の攻撃」が大きい相手を狙う(列の倍率も効く)。撃破優先は倒せる相手の中だけで比べる
    var foes = alive(game.ally);
    if (game.ai === 'rand') return foes[Math.floor(Math.random() * foes.length)];
    if (c.d.meme) { var mt = memeTarget(c, foes); if (mt) return mt; }
    var ko = game.ai === 'ko' ? foes.filter(function (f) { return f.hp <= dmgAt(c, f) * 0.85; }) : [];
    var score = function (f) { return Math.min(dmgAt(c, f) / f.hp, 1) * threat(f); };
    return (ko.length ? ko : foes).slice().sort(function (a, b) { return score(b) - score(a); })[0];
  }
  function choose(c) {
    if (!game || !game.actor || game.actor.side !== 'ally' || c.side !== 'enemy' || c.hp <= 0) return;
    setTargets(false);
    attack(game.actor, c);
  }
  function attack(a, t) {
    game.queue.shift(); game.actor = null;
    var black = hasItem(a.side, 'black'), crit = Math.random() < (black ? BLACK_CRIT : 0.1), nm = netaMult(a);
    var dmg = Math.max(1, Math.round(dmgOf(a, t) * (0.85 + Math.random() * 0.3) * (crit ? (black ? BLACK_CRIT_MULT : 1.5) : 1)));
    var burned = black && Math.random() < BLACK_BURN;
    var parried = !burned && Math.random() < t.par, mult = posMult(a, t), tm = typeMult(a, t);
    a.n++;
    var names = '<b style="color:' + a.d.color + '">' + esc(a.d.name) + '</b> → <b style="color:' + t.d.color + '">' + esc(t.d.name) + '</b>';
    var hit = function () {
      var again = false;
      if (burned) {
        var burn = Math.max(1, Math.round(a.max * BURN_HP));
        var burnt = hurt(a, burn);
        sfx('burn');
        pop(a, '炎上 -' + num(burnt), '');
        msg('<b style="color:' + a.d.color + '">' + esc(a.d.name) + '</b> のブラックジョークが滑って<b>炎上!</b> 自分に <b class="num">' + num(burn) + '</b> ダメージ' + (a.hp <= 0 ? ' 撃破!' : '') + sharedNote());
      } else if (parried) {
        var back = Math.max(1, Math.round(dmg * COUNTER));
        var countered = hurt(a, back);
        sfx('parry');
        pop(t, 'パリイ!', 'parry');
        pop(a, '-' + num(countered), '');
        msg(names + ' の攻撃を<b>パリイ!</b> ' + '<b class="num">' + num(back) + '</b> 反撃' + (a.hp <= 0 ? ' 撃破!' : '') + sharedNote());
      } else {
        var dealt = hurt(t, dmg);
        sfx(t.hp <= 0 ? 'ko' : crit ? 'crit' : 'hit');
        pop(t, '-' + num(dealt), crit ? 'crit' : '');
        msg(names + ' に <b class="num">' + num(dmg) + '</b> ダメージ' + (tm > 1 ? '(有利!)' : tm < 1 ? '(不利)' : '') + (mult !== 1 ? '(列×' + mult + ')' : '') + (nm > 1 ? '(ネタ擦り×' + nm + ')' : nm < 1 ? '(擦りすぎ×' + nm + ')' : '') + (crit ? '(会心!)' : '') + (t.hp <= 0 ? ' 撃破!' : '') + sharedNote());
        again = oneMore(a, t);
      }
      paintBuffs();
      if (again) return playClip(a.d.meme.more, nextActor);
      var mate = !burned && !parried && t.hp > 0 ? partnerOf(a) : null;
      if (mate && atkNow(mate) > 0) return later(function () { collabFollow(mate, t); }, 450);
      later(nextActor, parried || burned ? 900 : 600);
    };
    strike(a, t, hit);
  }
  function collabFollow(m, t) {   // 相方の追撃。パリイはされない
    setActive(m);
    var dmg = Math.max(1, Math.round(dmgOf(m, t) * COLLAB_FOLLOW * (0.85 + Math.random() * 0.3)));
    strike(m, t, function () {
      var taken = hurt(t, dmg);
      sfx(t.hp <= 0 ? 'ko' : 'hit');
      pop(t, '-' + num(taken), '');
      msg('<b style="color:' + m.d.color + '">' + esc(m.d.name) + '</b> も共演! <b style="color:' + t.d.color + '">' + esc(t.d.name) + '</b> に <b class="num">' + num(dmg) + '</b> ダメージ' + (t.hp <= 0 ? ' 撃破!' : '') + sharedNote());
      paintBuffs();
      later(nextActor, 700);
    });
  }
  function strike(a, t, hit) {   // カードが動いて、当たった瞬間に hit を呼ぶ
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
    later(function () { shake(t); hit(); }, 210);
  }
  function shoot(a, t, r1, r2, hit) {   // 遠戦はカードが動かず、弾だけが飛ぶ
    var box = $('.cb-board').getBoundingClientRect(), s = document.createElement('span');
    var x1 = r1.left + r1.width / 2 - box.left - 6, y1 = r1.top + r1.height / 2 - box.top - 6;
    var x2 = r2.left + r2.width / 2 - box.left - 6, y2 = r2.top + r2.height / 2 - box.top - 6;
    s.className = 'cb-shot';
    s.style.background = a.d.color;
    $('.cb-board').appendChild(s);
    sfx('shot');
    s.animate([{ transform: 'translate(' + x1 + 'px,' + y1 + 'px)' }, { transform: 'translate(' + x2 + 'px,' + y2 + 'px)' }], { duration: 300, easing: 'ease-in' }).onfinish = function () { s.remove(); };
    later(function () { shake(t); hit(); }, 300);
  }
  function oneMore(a, t) {   // 自分の攻撃で撃破したら、1ターンに1回だけもう一度動ける
    if (!a.d.meme || t.hp > 0 || a.moreRound === game.round) return false;
    if (!alive(game[t.side]).length && !nextOf(t)) return false;   // 相手が全滅なら試合が終わる
    a.moreRound = game.round;
    game.queue.unshift(a);
    $('.cb-msg').insertAdjacentHTML('beforeend', ' <b>' + ONE_MORE + '</b>');
    memeBanner(ONE_MORE, 'more');
    return true;
  }
  /* 動画は YouTube の埋め込みプレーヤーで流す。規約に合わせて、再生中はプレーヤーを隠さない。
     再生できないときは文字の帯だけで進める。音ありを止められたら音なしで試し、それでもだめならこの動画は諦める */
  function videoEnabled() {
    if (RM) return false;
    try { return localStorage.getItem(VIDEO_KEY) !== 'off'; } catch (e) { return true; }
  }
  function videoCmd(func, args) {
    if (video && video.frame.contentWindow) video.frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [] }), VIDEO_HOST);
  }
  function memeUnit() { return game.ally.concat(game.enemy).filter(function (c) { return c.d.meme; })[0]; }
  function setupVideo() {
    var m = memeUnit();
    $('.cb-video-btn').hidden = !m || RM;
    $('.cb-video-btn').textContent = esc(m ? m.d.name : '') + 'の動画: ' + (videoEnabled() ? 'オン' : 'オフ');
    $('.cb-video-btn').setAttribute('aria-pressed', String(videoEnabled()));
    $('.cb-video-note').hidden = !m || !videoEnabled() || !game.arranging;
    $('.cb-video-note').textContent = m ? '音が出ます。' + m.d.name + 'の番に動画が音ありで流れます。上の「' + m.d.name + 'の動画」でオフにできます。' : '';
    if (!m || !videoEnabled() || (video && video.id === m.d.meme.video)) return;
    if (video) video.box.remove();
    var box = document.createElement('div'), frame = document.createElement('iframe');
    box.className = 'cb-video';
    frame.title = m.d.name + ' の動画';
    frame.allow = 'autoplay; encrypted-media';
    frame.src = VIDEO_HOST + '/embed/' + m.d.meme.video + '?enablejsapi=1&playsinline=1&controls=0&rel=0&origin=' + encodeURIComponent(location.origin);
    video = { id: m.d.meme.video, box: box, frame: frame, ready: false, state: -1, fails: 0, broken: false, muted: false, clip: null };
    frame.addEventListener('load', function () {   // 再生の状態を送ってもらう
      if (frame.contentWindow) frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1 }), VIDEO_HOST);
    });
    box.appendChild(frame);
    $('.cb-board').appendChild(box);
  }
  function videoMessage(e) {
    if (!video || e.source !== video.frame.contentWindow) return;
    var d;
    try { d = JSON.parse(e.data); } catch (x) { return; }
    video.ready = true;
    if (d.event === 'onError') { video.broken = true; if (video.clip) video.clip.finish(); }
    if (d.event === 'infoDelivery' && d.info && d.info.playerState != null) video.state = d.info.playerState;
    var c = video.clip;
    if (c && !c.started && video.state === 1) {   // 実際に動き出してから区間の長さを測る
      c.started = true;
      clearTimeout(c.guard);
      setTimeout(c.finish, c.ms);
    }
  }
  function playClip(range, done) {
    if (!video || !video.ready || video.broken || !videoEnabled()) return later(done, MEME_WAIT);
    var t = token, v = video, c = { ms: (range[1] - range[0]) * 1000, started: false, guard: 0, finish: null };
    c.finish = function () {
      if (v.clip !== c) return;
      v.clip = null;
      clearTimeout(c.guard);
      videoCmd('pauseVideo');
      v.box.classList.remove('on');
      if (t === token) done();
    };
    v.clip = c;
    v.state = -1;
    v.box.style.setProperty('--cb-video-top', (root.querySelector('.cb-order').offsetTop + 34) + 'px');
    v.box.classList.add('on');
    videoCmd(v.muted ? 'mute' : 'unMute');
    videoCmd('setVolume', [VIDEO_VOLUME]);
    videoCmd('seekTo', [range[0], true]);
    videoCmd('playVideo');
    c.guard = setTimeout(function () {   // 動き出さなかった
      v.fails++;
      if (v.fails === 1) v.muted = true; else v.broken = true;
      c.finish();
    }, 1800);
  }
  function memeBanner(text, cls) {   // 文字が帯の右から流れてきて、真ん中でゆっくりになり、左へ抜ける
    var bar = document.createElement('div'), T = 950;
    bar.className = 'cb-meme' + (cls ? ' ' + cls : '');
    bar.setAttribute('aria-hidden', 'true');   // 同じ内容をメッセージ欄が読み上げる
    bar.style.top = root.querySelector('.cb-order').offsetTop + 'px';
    bar.innerHTML = '<span>' + esc(text) + '</span>';
    $('.cb-board').appendChild(bar);
    var s = bar.firstChild;
    if (s.animate) {
      var d = (bar.offsetWidth + s.offsetWidth) / 2;
      if (RM) bar.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: T, fill: 'forwards' });
      else s.animate([
        { transform: 'translateX(' + d + 'px)', easing: 'cubic-bezier(.16,1,.3,1)' },
        { transform: 'translateX(14px)', offset: 0.32 },
        { transform: 'translateX(-14px)', offset: 0.72, easing: 'cubic-bezier(.7,0,1,.5)' },
        { transform: 'translateX(' + -d + 'px)' }
      ], { duration: T, fill: 'forwards' });
    }
    setTimeout(function () { bar.remove(); }, T);   // 対戦を抜けた後でも必ず片付ける
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
    sfx(win ? 'win' : 'lose');
    $('.cb-result').hidden = false;
    $('.cb-res-t').textContent = win ? '勝利!' : run ? '連戦終了' : '敗北…';
    $('.cb-res-t').classList.toggle('win', win);
    $('.cb-res-s').textContent = run ? runResult(win) : game.round + 'ラウンド ・ ' + (win ? '自陣' : '敵陣') + 'の残り ' + alive(win ? game.ally : game.enemy).length + '枚';
    $('.cb-again').textContent = !run ? 'もう一度' : win ? '強化して次へ' : 'もう一度挑戦';
    $('.cb-edit2').textContent = run && win ? '連戦をやめる' : 'デッキ編集';
    msg('');
  }

  function runResult(win) {   // 連戦の結果の文面を作り、勝ちなら次の戦いのHP、負けなら終了を記録する
    if (!win) {
      run.over = true;
      return run.wins + '連勝' + (run.record ? '・自己ベスト!' : bestRun() ? '(自己ベスト ' + bestRun() + '連勝)' : '');
    }
    run.wins++;
    var fresh = run.wins > bestRun();
    if (fresh) { saveBest(run.wins); run.record = true; }
    run.hp = {};
    game.ally.concat(game.fallen).forEach(function (u) {
      run.hp[u.d.slug] = u.hp > 0 ? Math.min(1, u.hp / u.max + RUN_HEAL) : RUN_REVIVE;
    });
    var interest = Math.min(RUN_INTEREST_MAX, Math.floor(run.coins * RUN_INTEREST));
    run.coins += RUN_COIN + interest;
    return run.wins + '連勝' + (fresh ? '・自己ベスト更新!' : '') + ' +' + RUN_COIN + 'コイン' + (interest ? '(利子+' + interest + ')' : '') + '。生き残りはHP' + RUN_HEAL * 100 + '%回復、倒れたカードはHP' + RUN_REVIVE * 100 + '%で復活';
  }
  function mount(host, channels) {
    var fresh = buildCards(channels);
    if (root) {   // タブを移動しても対戦を続けられる。デッキ構築中ならジャンル設定の変更を反映
      host.innerHTML = ''; host.appendChild(root);
      if (!game) {
        cards = fresh;
        var remap = function (list) { return list.map(function (c) { return cards.filter(function (x) { return x.d.slug === c.d.slug; })[0]; }).filter(Boolean); };
        deck = remap(deck);
        foePick = remap(foePick);
        if (run && run.base) run.base.deck = remap(run.base.deck);
        if (foeFixed) { foeFixed = remap(foeFixed); if (foeFixed.length !== DECK) foeFixed = null; }
        renderList();
        if (!$('.cb-foe').hidden) renderFoeList();
        if (run && !$('.cb-rshop').hidden) renderRunShop();
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
      '<div class="fc-lead">5枚のデッキを組んで、相手を全滅させたら勝ち。</div>' +
      (cards.some(function (c) { return c.d.meme; }) ? '<p class="cb-sound-note">音が出ます。田中MIDが対戦にいると、YouTubeの動画が音ありで流れます。対戦画面でオフにできます。</p>' : '') +
      '<details class="cb-help"><summary>ルールを見る</summary><dl>' +
        '<dt>コスト</dt><dd>強さに合わせて決まる。' + COST_KNEE + 'を超える分は半額。</dd>' +
        '<dt>能力</dt><dd>HP=登録者 / 白兵=横動画1本あたり再生 / 遠戦=縦動画1本あたり再生 / 防御=Xフォロワー / パリイ=過去21日の登録者伸び率 / 拡散=Xの30日投稿数</dd>' +
        '<dt>戦い方</dt><dd>奇数ラウンドは遠戦、偶数ラウンドは白兵戦。その動画が無いカードは攻撃できず、本数が多いカードから動く。遠戦は列に関係なく届き、白兵戦は向かい×1.5、1列隣×1、2列×0.75、3列以上×0.5。</dd>' +
        '<dt>タイプ</dt><dd><span class="cb-li-t cb-t-s">短</span>ショート → <span class="cb-li-t cb-t-m">両</span>両刀 → <span class="cb-li-t cb-t-l">長</span>長尺 → <span class="cb-li-t cb-t-s">短</span>ショート の順に有利(×' + TYPE_ADV + '、逆は×' + TYPE_DIS + ')。再生数のショート割合が95%以上でショート、50%未満で長尺、その間が両刀。</dd>' +
        '<dt>作戦</dt><dd>コスト' + BUDGET + 'のうち、カードで余った分で買える。チーム全体に効く。最後に残った分はパラオパワーになり、倍率 = 1 + 残り ÷ カードの合計コスト(最大×' + PARAO_CAP + ')。金色の数字が強化込みの値。</dd>' +
        '<dt>ダメージ</dt><dd>攻撃 ÷ 割る数(遠戦' + RANGED_DIV + '、白兵戦' + MELEE_DIV + ') × (1 − 軽減率) × 列の倍率 × 相性 × (1 + 味方の拡散)。軽減率 = 防御 ÷ (防御 + ' + num(DEF_K) + ')。</dd>' +
        '<dt>パリイ・拡散</dt><dd>パリイ率 = 50% × 伸び率 ÷ (伸び率 + 10)。成功するとダメージを無効にし、1/4を反撃。拡散 = 10% × 30日投稿数 ÷ (30日投稿数 + 20)で、生きている間だけ味方全体の攻撃が上がる。</dd>' +
        twinHelp() +
        '<dt>敵のAI</dt><dd>対戦前に選べる。' + Object.keys(AIS).map(function (k) { return AIS[k].name + ' = ' + AIS[k].desc; }).join(' / ') + '。連戦では1戦ごとにランダムで決まる。</dd>' +
        '<dt>相手を選ぶ</dt><dd>対戦前の画面で、戦いたいチャンネルを1〜5枚指定できる。足りない枠は自動で埋まり、指定した相手は変えるまで続く。</dd>' +
        '<dt>連戦</dt><dd>負けるまで続く。敵の予算は' + RUN_BASE + 'から勝つたびに+' + RUN_STEP + '。HPは持ち越しで、勝つと生き残りは最大HPの' + RUN_HEAL * 100 + '%回復、倒れたカードは' + RUN_REVIVE * 100 + '%で復活する。勝つと' + RUN_COIN + 'コインもらえて、次の戦いの前に使える。パラオパワーに注ぐ(1コインで予算+1)、回復、カードの入れ替え、作戦の付け外しができ、残したコインには' + RUN_INTEREST * 100 + '%の利子(最大' + RUN_INTEREST_MAX + ')が付く。変更はその連戦の間だけ。</dd>' +
        '<dt>データが無いとき</dt><dd>Xが未登録なら防御0・拡散0、伸びていなければパリイ0%。横と縦の内訳が無ければ、全体の平均を遠戦に、その1/4を白兵に使う。</dd>' +
      '</dl></details></div>' +
      '<div class="cb-build">' +
        '<h4 class="cb-step-t"></h4>' +
        '<div class="cb-slots"></div>' +
        '<div class="cb-meter-row"><span class="cb-meter-l">コスト</span><span class="cb-meter"><i></i></span><span class="cb-meter-v num"></span></div>' +
        '<div class="cb-step-cards">' +
          '<div class="cb-bact"><button type="button" class="g-btn g-confirm cb-next" disabled></button><button type="button" class="g-btn g-x cb-auto">おまかせ</button><button type="button" class="g-btn g-x cb-clear">クリア</button></div>' +
          '<div class="cb-tools"><input type="search" class="cb-q" placeholder="チャンネル名で検索" aria-label="チャンネル名で検索">' +
            '<select class="cb-sort" aria-label="並び替え"><option value="cost">コスト順</option><option value="hp">HP順</option><option value="atkM">白兵順</option><option value="atkR">遠戦順</option><option value="spd">本数順</option><option value="def">防御順</option><option value="g">伸び率順</option><option value="aura">拡散順</option></select>' +
            '<div class="vtype cb-tfilter"><button type="button" class="vt on" data-type="">全タイプ</button><button type="button" class="vt" data-type="s">ショート</button><button type="button" class="vt" data-type="m">両刀</button><button type="button" class="vt" data-type="l">長尺</button></div></div>' +
          '<div class="cb-list"></div>' +
        '</div>' +
        '<div class="cb-step-items" hidden>' +
          '<div class="cb-shop">' + Object.keys(ITEMS).map(function (k) {
            return '<button type="button" class="cb-item" data-item="' + k + '" aria-pressed="false"><span class="cb-item-n">' + ITEMS[k].name + '</span><span class="cb-item-p num">' + ITEMS[k].price + '</span><span class="cb-item-d">' + ITEMS[k].desc + '</span></button>';
          }).join('') +
          '<div class="cb-item cb-parao"><span class="cb-item-n">パラオパワー</span><span class="cb-item-p num cb-parao-v"></span><span class="cb-item-d cb-parao-d"></span></div></div>' +
          '<div class="cb-collab-pick" hidden></div>' +
          '<div class="cb-bact"><button type="button" class="g-btn g-confirm cb-go">このデッキで戦う</button><button type="button" class="g-btn g-x cb-run-go">連戦に挑む</button><button type="button" class="g-btn g-x cb-back">カードを選び直す</button></div>' +
          '<p class="cb-note cb-run-note"></p>' +
        '</div>' +
      '</div>' +
      '<div class="cb-foe" hidden>' +
        '<h4 class="cb-step-t">相手を選ぶ</h4>' +
        '<div class="cb-slots cb-foe-slots"></div>' +
        '<p class="cb-note cb-foe-note"></p>' +
        '<div class="cb-bact"><button type="button" class="g-btn g-confirm cb-foe-go" disabled>この相手と戦う</button><button type="button" class="g-btn g-x cb-foe-back">戻る</button></div>' +
        '<div class="cb-tools"><input type="search" class="cb-q cb-foe-q" placeholder="チャンネル名で検索" aria-label="相手のチャンネル名で検索">' +
          '<select class="cb-sort cb-foe-sort" aria-label="相手の並び替え"><option value="cost">コスト順</option><option value="hp">HP順</option><option value="atkM">白兵順</option><option value="atkR">遠戦順</option><option value="spd">本数順</option><option value="def">防御順</option><option value="g">伸び率順</option><option value="aura">拡散順</option></select></div>' +
        '<div class="cb-list cb-foe-list"></div>' +
      '</div>' +
      '<div class="cb-rshop" hidden>' +
        '<div class="cb-rs-top"><h4 class="cb-step-t">連戦ショップ</h4><span class="cb-rs-wins"></span><span class="cb-rs-money">コイン<span class="cb-rs-coin num"></span></span></div>' +
        '<div class="cb-rs-parao"></div>' +
        '<div class="cb-rs-h">カード</div><div class="cb-rs-cards"></div>' +
        '<div class="cb-rs-swap" hidden><p class="cb-rs-swap-t"></p><input type="search" class="cb-q cb-rs-q" placeholder="チャンネル名で検索" aria-label="入れ替えるチャンネルを検索"><div class="cb-list cb-rs-list"></div><div class="cb-bact"><button type="button" class="g-btn g-x cb-rs-btn" data-act="swapcancel">入れ替えをやめる</button></div></div>' +
        '<div class="cb-rs-h">作戦</div><div class="cb-rs-items"></div>' +
        '<div class="cb-collab-pick cb-rs-pick" hidden></div>' +
        '<p class="cb-note">残したコインは次に勝ったとき' + RUN_INTEREST * 100 + '%の利子が付きます(最大' + RUN_INTEREST_MAX + ')。カードと作戦の変更はこの連戦の間だけです。</p>' +
        '<div class="cb-bact"><button type="button" class="g-btn g-confirm cb-rs-go">次の戦いへ</button><button type="button" class="g-btn g-x cb-rs-quit">連戦をやめる</button></div>' +
      '</div>' +
      '<div class="cb-board" hidden>' +
        '<div class="cb-label"><span>敵陣</span><span class="cb-chip cb-boost cb-enemy-boost num"></span><span class="cb-chip cb-enemy-ai"></span><span class="cb-chip cb-enemy-buff"></span><span class="cb-items cb-enemy-items"></span>' +
          '<button type="button" class="cb-more-btn" aria-pressed="false">防御・パリイも見る</button><button type="button" class="cb-more-btn cb-video-btn" aria-pressed="false" hidden></button><button type="button" class="cb-more-btn cb-sfx-btn" aria-pressed="true"></button></div><div class="cb-row cb-row-enemy"></div>' +
        '<div class="cb-mid"><div class="cb-run"></div><div class="cb-order"></div><div class="cb-msg" aria-live="polite"></div>' +
          '<p class="cb-sound-note cb-video-note" hidden></p>' +
          '<div class="cb-ai"><span class="cb-ai-l">敵のAI</span><div class="vtype">' + Object.keys(AIS).map(function (k) {
            return '<button type="button" class="vt" data-ai="' + k + '" aria-pressed="false">' + AIS[k].name + '</button>';
          }).join('') + '</div><span class="cb-ai-d"></span></div>' +
          '<div class="cb-actions"><button type="button" class="g-btn g-confirm cb-start">バトル開始</button><button type="button" class="g-btn g-x cb-pick">相手を選ぶ</button><button type="button" class="g-btn g-x cb-reroll">ランダムに変える</button><button type="button" class="g-btn g-x cb-edit">デッキ編集</button></div>' +
          '<div class="cb-result" hidden><div class="cb-res-t"></div><div class="cb-res-s"></div><div class="cb-bact"><button type="button" class="g-btn g-confirm cb-again">もう一度</button><button type="button" class="g-btn g-x cb-edit2">デッキ編集</button></div></div>' +
        '</div>' +
        '<div class="cb-row cb-row-ally"></div><div class="cb-label"><span>自陣</span><span class="cb-chip cb-boost cb-ally-boost num"></span><span class="cb-chip cb-ally-buff"></span><span class="cb-items cb-ally-items"></span></div>' +
      '</div>';
    setupBuild();
    setupFoe();
    setupRunShop();
    window.addEventListener('message', videoMessage);
    root.addEventListener('click', function () { if (sfxOn()) audio(); });   // 音を出すにはクリックが要るブラウザがある
    $('.cb-sfx-btn').addEventListener('click', function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? 'off' : 'on'); } catch (e) {}
      paintSfx();
    });
    paintSfx();
    $('.cb-video-btn').addEventListener('click', function () {
      try { localStorage.setItem(VIDEO_KEY, videoEnabled() ? 'off' : 'on'); } catch (e) {}
      if (video && video.clip) video.clip.finish();
      if (game) setupVideo();
    });
    $('.cb-more-btn').addEventListener('click', function (e) {
      var on = $('.cb-board').classList.toggle('more');
      e.target.setAttribute('aria-pressed', String(on));
      e.target.textContent = on ? '防御・パリイを隠す' : '防御・パリイも見る';
    });
    $('.cb-ai').addEventListener('click', function (e) {
      var b = e.target.closest('.vt'); if (!b) return;
      aiKey = game.ai = b.dataset.ai;
      saveAI(); paintAI();
    });
    $('.cb-start').addEventListener('click', start);
    $('.cb-pick').addEventListener('click', showFoe);
    $('.cb-reroll').addEventListener('click', function () { foeFixed = null; newBattle(); });
    $('.cb-again').addEventListener('click', function () {
      if (run && !run.over) return showRunShop();
      if (run) { restoreRun(); run = newRun(); }
      newBattle();
    });
    $('.cb-edit').addEventListener('click', showBuild);
    $('.cb-edit2').addEventListener('click', showBuild);
    deck = loadDeck();
    items = loadItems(deck);
    aiKey = loadAI();
    collabPick = loadCollab();
    host.innerHTML = ''; host.appendChild(root);
    showBuild();
  }
  window.PBERS_CB = { mount: mount };
})();
