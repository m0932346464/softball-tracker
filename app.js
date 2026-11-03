'use strict';

/* =========================================================
   壘球落點紀錄表（慢壘）
   - 資料存在瀏覽器 localStorage
   - 座標單位：英尺（ft），本壘為原點，x 往右（一壘側）為正，y 往中外野為正
   ========================================================= */

const STORE_KEY = 'softball-spray-v1';

const TYPES = [
  { id: 'GB', label: '滾地球', color: '#fb923c' },
  { id: 'LD', label: '平飛球', color: '#f43f5e' },
  { id: 'FB', label: '高飛球', color: '#38bdf8' },
  { id: 'PU', label: '小飛球', color: '#c084fc' },
];

const RESULTS = [
  { id: '1B', label: '一壘安打', hit: true, tb: 1 },
  { id: '2B', label: '二壘安打', hit: true, tb: 2 },
  { id: '3B', label: '三壘安打', hit: true, tb: 3 },
  { id: 'HR', label: '全壘打', hit: true, tb: 4 },
  { id: 'OUT', label: '出局' },
  { id: 'DP', label: '雙殺' },
  { id: 'E', label: '失誤上壘' },
  { id: 'FC', label: '野手選擇' },
  { id: 'SF', label: '高飛犧牲打' },
];

const QUICK = [
  { id: 'K', label: '三振' },
  { id: 'BB', label: '四壞球' },
  { id: 'FO', label: '界外接殺' },
];

// 慢壘 10 人標準站位（a = 角度，以中外野方向為 0°，左負右正；d = 距本壘英尺）
const POSITIONS = [
  { id: 'P', label: '投', a: 0, d: 50, fixed: true },
  { id: 'C', label: '捕', a: 0, d: -10, fixed: true },
  { id: '3B', label: '三', a: -36, d: 85, grp: 'IF' },
  { id: 'SS', label: '游', a: -14, d: 120, grp: 'IF' },
  { id: '2B', label: '二', a: 14, d: 120, grp: 'IF' },
  { id: '1B', label: '一', a: 36, d: 85, grp: 'IF' },
  { id: 'LF', label: '左', a: -31, d: 225, grp: 'OF' },
  { id: 'LCF', label: '左中', a: -11, d: 245, grp: 'OF' },
  { id: 'RCF', label: '右中', a: 11, d: 245, grp: 'OF' },
  { id: 'RF', label: '右', a: 31, d: 225, grp: 'OF' },
];

// 球場繪圖參數：本壘在 SVG (HX, HY)，1 英尺 = K 像素
const G = { HX: 260, HY: 392, K: 1.1, FENCE: 300, MAX: 345, W: 520, H: 412 };
const INFIELD_LIMIT = 150; // 150 英尺內視為內野範圍

/* ---------- 資料 ---------- */
let db = load();

const ui = {
  gameId: db.lastGameId,
  batterId: null,
  pending: null, // { x, y }
  type: null,
  result: null,
  an: { teamId: '', playerId: '', gameId: '' },
};

function emptyDb() {
  return { teams: [], players: [], games: [], records: [], lastGameId: null };
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (d && Array.isArray(d.teams)) return normalize(d);
  } catch (e) { /* 讀不到就用空資料 */ }
  return emptyDb();
}

function normalize(d) {
  return {
    teams: d.teams || [],
    players: d.players || [],
    games: d.games || [],
    records: d.records || [],
    lastGameId: d.lastGameId || null,
  };
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch (e) {
    toast('⚠ 無法存檔，請立刻到「資料備份」匯出');
  }
}

/* ---------- 小工具 ---------- */
const $ = (sel) => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const findById = (list, id) => list.find((o) => o.id === id);
const teamName = (id) => findById(db.teams, id)?.name ?? '（已刪除球隊）';
const playerLabel = (p) => (p ? `#${p.number} ${p.name}` : '（已刪除球員）');
const gameLabel = (g) => `${g.date} vs ${teamName(g.teamId)}${g.note ? '（' + g.note + '）' : ''}`;
const typeOf = (id) => TYPES.find((t) => t.id === id);
const resultOf = (id) => RESULTS.find((r) => r.id === id) || QUICK.find((r) => r.id === id);
const sortPlayers = (list) => [...list].sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999));
const sortGames = (list) => [...list].sort((a, b) => b.date.localeCompare(a.date));
const isHit = (r) => !!resultOf(r.result)?.hit;
const hasPoint = (r) => r.x != null && r.y != null;
const dist = (r) => Math.hypot(r.x, r.y);
const angleOf = (x, y) => (Math.atan2(x, y) * 180) / Math.PI;

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function fillSelect(sel, options, value) {
  sel.innerHTML = options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  if (options.some((o) => o.value === value)) sel.value = value;
  return sel.value;
}

/* ---------- 球場繪圖 ---------- */
const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

const toSvg = (x, y) => [G.HX + x * G.K, G.HY - y * G.K];
const polar = (r, deg) => [r * Math.sin((deg * Math.PI) / 180), r * Math.cos((deg * Math.PI) / 180)];
const P = (r, deg) => toSvg(...polar(r, deg)).map((n) => n.toFixed(1)).join(',');

function arcPath(r) {
  const R = r * G.K;
  return `M${P(r, -45)} A${R} ${R} 0 0 1 ${P(r, 45)}`;
}

function wedgePath(r1, r2, a1, a2) {
  const R2 = r2 * G.K;
  const R1 = r1 * G.K;
  if (r1 <= 0) return `M${P(0, 0)} L${P(r2, a1)} A${R2} ${R2} 0 0 1 ${P(r2, a2)} Z`;
  return `M${P(r1, a1)} L${P(r2, a1)} A${R2} ${R2} 0 0 1 ${P(r2, a2)} L${P(r1, a2)} A${R1} ${R1} 0 0 0 ${P(r1, a1)} Z`;
}

function drawField(svg) {
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${G.W} ${G.H}`);
  // 草地除草條紋
  const defs = svgEl('defs', {}, svg);
  const patId = `${svg.id}-grass`;
  const pat = svgEl('pattern', { id: patId, width: 36, height: 36, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  svgEl('rect', { width: 36, height: 36, fill: '#1f6b3c' }, pat);
  svgEl('rect', { width: 18, height: 36, fill: '#237544' }, pat);
  const bg = svgEl('g', {}, svg);
  svgEl('rect', { x: 0, y: 0, width: G.W, height: G.H, class: 'f-out' }, bg);
  const R = G.FENCE * G.K;
  svgEl('path', { d: `M${P(0, 0)} L${P(G.FENCE, -45)} A${R} ${R} 0 0 1 ${P(G.FENCE, 45)} Z`, fill: `url(#${patId})` }, bg);
  const RD = 120 * G.K;
  svgEl('path', { d: `M${P(0, 0)} L${P(120, -45)} A${RD} ${RD} 0 0 1 ${P(120, 45)} Z`, class: 'f-dirt' }, bg);

  [150, 200, 250].forEach((r) => {
    svgEl('path', { d: arcPath(r), class: 'f-ring' }, bg);
    const [lx, ly] = toSvg(...polar(r, -40));
    svgEl('text', { x: lx, y: ly - 3, class: 'f-label' }, bg).textContent = `${r}ft`;
  });
  svgEl('path', { d: arcPath(G.FENCE), class: 'f-fence' }, bg);
  const [fx, fy] = toSvg(0, G.FENCE);
  svgEl('text', { x: fx, y: fy - 8, class: 'f-label' }, bg).textContent = `全壘打牆 ${G.FENCE}ft`;

  ['-45', '45'].forEach((a) => {
    const [x1, y1] = toSvg(0, 0);
    const [x2, y2] = toSvg(...polar(G.MAX + 20, Number(a)));
    svgEl('line', { x1, y1, x2, y2, class: 'f-line' }, bg);
  });

  // 壘包（慢壘壘間距 65ft）
  const bases = [[0, 0], [46, 46], [0, 92], [-46, 46]];
  svgEl('polygon', { points: bases.map((b) => toSvg(...b).join(',')).join(' '), class: 'f-basepath' }, bg);
  bases.forEach((b) => {
    const [x, y] = toSvg(...b);
    const s = 5;
    svgEl('polygon', { points: `${x},${y - s} ${x + s},${y} ${x},${y + s} ${x - s},${y}`, class: 'f-base' }, bg);
  });
  const [px, py] = toSvg(0, 50);
  svgEl('rect', { x: px - 4, y: py - 1.5, width: 8, height: 3, class: 'f-base' }, bg);

  return {
    heat: svgEl('g', {}, svg),
    pts: svgEl('g', {}, svg),
    def: svgEl('g', {}, svg),
    top: svgEl('g', {}, svg),
  };
}

function drawPoint(layer, r, faded) {
  const [x, y] = toSvg(r.x, r.y);
  const t = typeOf(r.type);
  const color = t ? t.color : '#555';
  const hit = isHit(r);
  const c = svgEl('circle', {
    cx: x, cy: y, r: hit ? 7 : 6,
    fill: hit ? color : '#0b1322',
    stroke: hit ? '#fff' : color,
    class: 'pt' + (faded ? ' pt-faded' : ''),
  }, layer);
  const p = findById(db.players, r.playerId);
  svgEl('title', {}, c).textContent =
    `${playerLabel(p)}｜${t ? t.label : ''}｜${resultOf(r.result)?.label ?? ''}｜${Math.round(dist(r))}ft`;
}

function legendHtml() {
  return TYPES.map((t) => `<span><i style="background:${t.color}"></i>${t.label}</span>`).join('') +
    '<span>實心＝安打　空心＝出局／其他</span>';
}

/* ---------- 分頁 ---------- */
function showTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.tab-panel').forEach((s) => { s.hidden = s.id !== 'tab-' + name; });
  ({ record: renderRecord, analysis: renderAnalysis, manage: renderManage, data: renderData })[name]();
  window.scrollTo(0, 0);
}

/* =========================================================
   紀錄頁
   ========================================================= */
const recSvg = $('#recordField');
let recLayers = drawField(recSvg);

function currentGame() {
  return findById(db.games, ui.gameId);
}

function renderRecord() {
  const games = sortGames(db.games);
  $('#noGameHint').hidden = games.length > 0;
  $('#gameSelect').hidden = games.length === 0;
  if (!findById(db.games, ui.gameId)) ui.gameId = games[0]?.id ?? null;
  fillSelect($('#gameSelect'), games.map((g) => ({ value: g.id, label: gameLabel(g) })), ui.gameId);

  // 打者
  const game = currentGame();
  const players = game ? sortPlayers(db.players.filter((p) => p.teamId === game.teamId)) : [];
  if (!players.some((p) => p.id === ui.batterId)) ui.batterId = null;
  $('#batterGrid').innerHTML = players.length
    ? players.map((p) => `<button class="batter-btn${p.id === ui.batterId ? ' selected' : ''}" data-id="${p.id}">
        <b>${esc(p.number)}</b><span>${esc(p.name)}</span></button>`).join('')
    : `<p class="hint">${game ? '這支球隊還沒有球員，可用上方「臨時新增打者」。' : '請先選擇比賽。'}</p>`;

  // 類型／結果按鈕狀態
  document.querySelectorAll('#typeBtns .chip').forEach((b) => b.classList.toggle('selected', b.dataset.id === ui.type));
  document.querySelectorAll('#resultBtns .chip').forEach((b) => b.classList.toggle('selected', b.dataset.id === ui.result));

  const ready = game && ui.batterId && ui.pending && ui.type && ui.result;
  $('#saveBtn').disabled = !ready;

  // 步驟提示
  const hint = $('#stepHint');
  let msg;
  if (!game) msg = '請先建立並選擇比賽';
  else if (!ui.batterId) msg = '① 先選打者';
  else if (!ui.pending) msg = '② 點球場上的落點（沒有落點請用右側一鍵紀錄）';
  else if (!ui.type) msg = '③ 選擇擊球類型';
  else if (!ui.result) msg = '④ 選擇擊球結果';
  else msg = '✔ 按「儲存這一球」';
  hint.textContent = msg;
  hint.classList.toggle('ready', !!ready);

  drawRecordField();
  renderRecent();
}

function drawRecordField() {
  recLayers.pts.innerHTML = '';
  recLayers.top.innerHTML = '';
  if (ui.batterId) {
    db.records.filter((r) => r.playerId === ui.batterId && hasPoint(r)).forEach((r) => drawPoint(recLayers.pts, r, true));
  }
  if (ui.pending) {
    const [x, y] = toSvg(ui.pending.x, ui.pending.y);
    svgEl('circle', { cx: x, cy: y, r: 9, class: 'pending-ring' }, recLayers.top);
    svgEl('circle', { cx: x, cy: y, r: 8, class: 'pending-dot' }, recLayers.top);
  }
}

function renderRecent() {
  const list = db.records.filter((r) => r.gameId === ui.gameId).sort((a, b) => b.ts - a.ts).slice(0, 6);
  $('#recentList').innerHTML = list.length
    ? list.map((r) => {
        const p = findById(db.players, r.playerId);
        const t = typeOf(r.type);
        const extra = hasPoint(r) ? `<span class="muted">（${Math.round(dist(r))}ft）</span>` : '';
        return `<li>${esc(playerLabel(p))}　${t ? t.label + '・' : ''}${resultOf(r.result)?.label ?? ''} ${extra}</li>`;
      }).join('')
    : '<li class="muted" style="font-weight:400">這場比賽還沒有紀錄</li>';
}

function svgToField(svg, evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: (p.x - G.HX) / G.K, y: (G.HY - p.y) / G.K };
}

recSvg.addEventListener('click', (e) => {
  if (!currentGame()) return toast('請先選擇比賽');
  if (!ui.batterId) return toast('請先選打者');
  const pos = svgToField(recSvg, e);
  if (pos.y < -5 || Math.hypot(pos.x, pos.y) > G.MAX) return toast('請點在球場範圍內');
  ui.pending = { x: Math.round(pos.x * 10) / 10, y: Math.round(pos.y * 10) / 10 };
  renderRecord();
});

function addRecord(rec) {
  const p = findById(db.players, ui.batterId);
  db.records.push({ id: uid(), gameId: ui.gameId, playerId: ui.batterId, ts: Date.now(), ...rec });
  save();
  toast(`已記錄：${playerLabel(p)} ${resultOf(rec.result).label}`);
  ui.pending = null;
  ui.type = null;
  ui.result = null;
  ui.batterId = null;
  renderRecord();
}

function initRecordControls() {
  $('#typeBtns').innerHTML = TYPES.map((t) =>
    `<button class="chip" data-id="${t.id}"><span class="dot" style="background:${t.color}"></span>${t.label}</button>`).join('');
  const kind = (r) => (r.hit ? 'kind-hit' : ['OUT', 'DP', 'K', 'FO'].includes(r.id) ? 'kind-out' : 'kind-other');
  $('#resultBtns').innerHTML = RESULTS.map((r) => `<button class="chip ${kind(r)}" data-id="${r.id}">${r.label}</button>`).join('');
  $('#quickBtns').innerHTML = QUICK.map((r) => `<button class="chip quick ${kind(r)}" data-id="${r.id}">${r.label}</button>`).join('');
  $('#recordLegend').innerHTML = legendHtml() + '<span>淡色點＝選中打者過去的落點</span>';

  $('#gameSelect').addEventListener('change', (e) => {
    ui.gameId = e.target.value;
    db.lastGameId = ui.gameId;
    save();
    ui.batterId = null;
    ui.pending = null;
    renderRecord();
  });

  $('#batterGrid').addEventListener('click', (e) => {
    const b = e.target.closest('.batter-btn');
    if (!b) return;
    ui.batterId = ui.batterId === b.dataset.id ? null : b.dataset.id;
    renderRecord();
  });

  $('#typeBtns').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    ui.type = b.dataset.id;
    renderRecord();
  });

  $('#resultBtns').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    ui.result = b.dataset.id;
    renderRecord();
  });

  $('#saveBtn').addEventListener('click', () => {
    addRecord({ x: ui.pending.x, y: ui.pending.y, type: ui.type, result: ui.result });
  });

  $('#quickBtns').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    if (!currentGame()) return toast('請先選擇比賽');
    if (!ui.batterId) return toast('請先選打者');
    addRecord({ x: null, y: null, type: null, result: b.dataset.id });
  });

  $('#undoBtn').addEventListener('click', () => {
    const list = db.records.filter((r) => r.gameId === ui.gameId);
    if (!list.length) return toast('這場比賽還沒有紀錄');
    const last = list.reduce((a, b) => (b.ts > a.ts ? b : a));
    const p = findById(db.players, last.playerId);
    const label = `${playerLabel(p)} ${resultOf(last.result)?.label ?? ''}`;
    if (!confirm(`確定要刪除最後一筆？\n\n${label}`)) return;
    db.records = db.records.filter((r) => r.id !== last.id);
    save();
    toast(`已復原：${label}`);
    renderRecord();
  });

  $('#quickAddToggle').addEventListener('click', () => {
    const f = $('#quickAddForm');
    f.hidden = !f.hidden;
    if (!f.hidden) $('#qaNumber').focus();
  });

  $('#quickAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const game = currentGame();
    if (!game) return toast('請先選擇比賽');
    const number = $('#qaNumber').value.trim();
    const name = $('#qaName').value.trim() || `${number}號`;
    if (!number) return toast('請輸入背號');
    const p = { id: uid(), teamId: game.teamId, number, name };
    db.players.push(p);
    save();
    ui.batterId = p.id;
    e.target.reset();
    e.target.hidden = true;
    toast(`已加入 ${playerLabel(p)}`);
    renderRecord();
  });
}

/* =========================================================
   分析頁
   ========================================================= */
const anSvg = $('#analysisField');
let anLayers = drawField(anSvg);

function filteredRecords() {
  const { teamId, playerId, gameId } = ui.an;
  const playerIds = new Set(db.players.filter((p) => p.teamId === teamId).map((p) => p.id));
  return db.records.filter((r) =>
    playerIds.has(r.playerId) && (!playerId || r.playerId === playerId) && (!gameId || r.gameId === gameId));
}

function calcStats(recs) {
  const count = (id) => recs.filter((r) => r.result === id).length;
  const pa = recs.length;
  const bb = count('BB');
  const sf = count('SF');
  const ab = pa - bb - sf;
  const hits = recs.filter(isHit);
  const tb = hits.reduce((s, r) => s + resultOf(r.result).tb, 0);
  const bip = recs.filter(hasPoint);
  const types = {};
  TYPES.forEach((t) => { types[t.id] = bip.filter((r) => r.type === t.id).length; });
  const dir = { L: 0, C: 0, R: 0 };
  let deep = 0;
  bip.forEach((r) => {
    const a = angleOf(r.x, r.y);
    dir[a < -15 ? 'L' : a > 15 ? 'R' : 'C']++;
    if (dist(r) >= 200) deep++;
  });
  return { pa, ab, h: hits.length, tb, k: count('K'), bb, hr: count('HR'), bip: bip.length, types, dir, deep };
}

const fmtRate = (n, d) => (d ? (n / d).toFixed(3).replace(/^0/, '') : '-');

function topEntry(obj, labels) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  return entries[0] && entries[0][1] > 0 ? labels[entries[0][0]] : '-';
}

const DIR_LABELS = { L: '左外野側', C: '中間', R: '右外野側' };
const TYPE_LABELS = Object.fromEntries(TYPES.map((t) => [t.id, t.label]));

function insightText(s) {
  if (s.bip < 3) return '有落點的球少於 3 球，先多累積幾場資料再判斷。';
  const d = Object.entries(s.dir).sort((a, b) => b[1] - a[1])[0];
  const t = Object.entries(s.types).sort((a, b) => b[1] - a[1])[0];
  let txt = `擊球最常往 <b>${DIR_LABELS[d[0]]}</b>（${pct(d[1], s.bip)}%），以 <b>${TYPE_LABELS[t[0]]}</b> 居多（${pct(t[1], s.bip)}%）。`;
  if (pct(d[1], s.bip) >= 50) txt += `方向明顯集中，守備可整體往${DIR_LABELS[d[0]]}移位。`;
  const deepPct = pct(s.deep, s.bip);
  if (deepPct >= 40) txt += `有 ${deepPct}% 的球飛超過 200ft，外野建議後退。`;
  else if (deepPct <= 15) txt += `很少打到 200ft 以外，外野可以往前壓。`;
  if (pct(s.types.GB, s.bip) >= 50) txt += '滾地球比例高，內野要注意站位。';
  if (s.bip < 8) txt += '<br><small>（樣本少於 8 球，僅供參考）</small>';
  return txt;
}

function computeDefense(recs) {
  const res = POSITIONS.map((p) => ({ ...p, na: p.a, nd: p.d, n: 0 }));
  const groups = { IF: res.filter((p) => p.grp === 'IF'), OF: res.filter((p) => p.grp === 'OF') };
  const buckets = new Map();
  recs.filter(hasPoint).forEach((r) => {
    const d = dist(r);
    const a = clamp(angleOf(r.x, r.y), -45, 45);
    const grp = d < INFIELD_LIMIT ? 'IF' : 'OF';
    if (d > G.FENCE) return; // 全壘打不影響守備站位
    let best = null;
    let bd = Infinity;
    groups[grp].forEach((p) => {
      const diff = Math.abs(a - p.a);
      if (diff < bd) { bd = diff; best = p; }
    });
    if (!buckets.has(best)) buckets.set(best, []);
    buckets.get(best).push({ a, d });
  });

  buckets.forEach((arr, p) => {
    p.n = arr.length;
    if (arr.length < 2) return;
    const w = Math.min(0.75, 0.25 + arr.length * 0.05); // 球越多越相信資料
    p.na = p.a + clamp((avg(arr.map((o) => o.a)) - p.a) * w, -12, 12);
    const md = avg(arr.map((o) => o.d));
    p.nd = p.grp === 'IF' ? clamp(p.d + (md - p.d) * w * 0.6, 60, 140) : clamp(p.d + (md - p.d) * w, 170, 290);
  });

  // 同組守備員保持左右順序、彼此至少間隔 8°
  Object.values(groups).forEach((g) => {
    for (let i = 1; i < g.length; i++) g[i].na = Math.max(g[i].na, g[i - 1].na + 8);
    for (let i = g.length - 2; i >= 0; i--) g[i].na = Math.min(g[i].na, g[i + 1].na - 8);
    g.forEach((p) => { p.na = clamp(p.na, -42, 42); });
  });
  return res;
}

function drawHeat(layer, recs) {
  const bip = recs.filter(hasPoint);
  if (!bip.length) return;
  const angs = [-45, -27, -9, 9, 27, 45];
  const rings = [[0, INFIELD_LIMIT], [INFIELD_LIMIT, G.FENCE]];
  const zones = [];
  rings.forEach(([r1, r2]) => {
    for (let i = 0; i < 5; i++) zones.push({ r1, r2, a1: angs[i], a2: angs[i + 1], n: 0 });
  });
  bip.forEach((r) => {
    const a = clamp(angleOf(r.x, r.y), -44.9, 44.9);
    const d = dist(r);
    const z = zones.find((z) => a >= z.a1 && a < z.a2 && (d < INFIELD_LIMIT ? z.r1 === 0 : z.r1 > 0));
    if (z) z.n++;
  });
  const max = Math.max(...zones.map((z) => z.n));
  zones.forEach((z) => {
    const alpha = z.n ? 0.15 + 0.65 * (z.n / max) : 0;
    svgEl('path', { d: wedgePath(z.r1, z.r2, z.a1, z.a2), class: 'zone', fill: `rgba(239,68,68,${alpha.toFixed(2)})` }, layer);
    if (!z.n) return;
    const [x, y] = toSvg(...polar(z.r1 ? 225 : 100, (z.a1 + z.a2) / 2));
    const t = svgEl('text', { x, y, class: 'zone-label' }, layer);
    t.textContent = `${pct(z.n, bip.length)}%`;
    const sub = svgEl('tspan', { x, dy: 13, class: 'zone-sub' }, t);
    sub.textContent = `${z.n} 球`;
  });
}

function drawDefense(layer, recs) {
  computeDefense(recs).forEach((p) => {
    const [x0, y0] = toSvg(...polar(p.d, p.a));
    const [x, y] = toSvg(...polar(p.nd, p.na));
    const moved = Math.hypot(x - x0, y - y0) > 4;
    if (moved) {
      svgEl('circle', { cx: x0, cy: y0, r: 10, class: 'def-old' }, layer);
      svgEl('line', { x1: x0, y1: y0, x2: x, y2: y, class: 'def-move' }, layer);
    }
    const c = svgEl('circle', { cx: x, cy: y, r: p.label.length > 1 ? 13 : 11, class: p.fixed ? 'def-fixed' : 'def-pos' }, layer);
    svgEl('title', {}, c).textContent = p.fixed ? p.label : `${p.label}：負責區域 ${p.n} 球`;
    svgEl('text', { x, y, class: 'def-text' }, layer).textContent = p.label;
  });
}

function barsHtml(rows, total) {
  return rows.map((r) => `<div class="bar-row"><span>${r.label}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${pct(r.n, total)}%;background:${r.color}"></div></div>
    <span class="num">${pct(r.n, total)}%（${r.n}）</span></div>`).join('');
}

function renderAnalysis() {
  const teams = db.teams;
  if (!findById(teams, ui.an.teamId)) {
    ui.an.teamId = currentGame()?.teamId ?? teams[0]?.id ?? '';
    ui.an.playerId = '';
    ui.an.gameId = '';
  }
  fillSelect($('#anTeam'), teams.length ? teams.map((t) => ({ value: t.id, label: t.name })) : [{ value: '', label: '（尚無球隊）' }], ui.an.teamId);
  const players = sortPlayers(db.players.filter((p) => p.teamId === ui.an.teamId));
  ui.an.playerId = fillSelect($('#anPlayer'), [{ value: '', label: '全隊' }, ...players.map((p) => ({ value: p.id, label: playerLabel(p) }))], ui.an.playerId);
  const games = sortGames(db.games.filter((g) => g.teamId === ui.an.teamId));
  ui.an.gameId = fillSelect($('#anGame'), [{ value: '', label: '全部比賽' }, ...games.map((g) => ({ value: g.id, label: gameLabel(g) }))], ui.an.gameId);

  const recs = filteredRecords();
  const s = calcStats(recs);

  // 球場圖層
  anLayers.heat.innerHTML = '';
  anLayers.pts.innerHTML = '';
  anLayers.def.innerHTML = '';
  if ($('#lyHeat').checked) drawHeat(anLayers.heat, recs);
  if ($('#lyPts').checked) recs.filter(hasPoint).forEach((r) => drawPoint(anLayers.pts, r, false));
  if ($('#lyDef').checked) drawDefense(anLayers.def, recs);
  $('#analysisLegend').innerHTML = legendHtml() + '<span><i style="background:#2563eb"></i>建議守備位置（虛線圈＝標準站位）</span>';

  // 統計
  const who = ui.an.playerId ? playerLabel(findById(db.players, ui.an.playerId)) : (findById(teams, ui.an.teamId)?.name ?? '');
  $('#anTitle').textContent = `統計：${who}`;
  const tiles = [
    ['打席', s.pa], ['打數', s.ab], ['安打', s.h], ['打擊率', fmtRate(s.h, s.ab)],
    ['長打率', fmtRate(s.tb, s.ab)], ['全壘打', s.hr], ['三振', s.k], ['四壞', s.bb],
  ];
  $('#statTiles').innerHTML = tiles.map(([k, v]) =>
    `<div class="tile${['打擊率', '長打率'].includes(k) ? ' key' : ''}"><b>${v}</b><span>${k}</span></div>`).join('');
  $('#insight').innerHTML = s.pa ? insightText(s) : '目前沒有符合條件的紀錄。';

  $('#typeBars').innerHTML = barsHtml(TYPES.map((t) => ({ label: t.label, n: s.types[t.id], color: t.color })), s.bip);
  $('#dirBars').innerHTML = barsHtml([
    { label: '左外野側', n: s.dir.L, color: 'var(--accent)' },
    { label: '中間', n: s.dir.C, color: 'var(--accent)' },
    { label: '右外野側', n: s.dir.R, color: 'var(--accent)' },
  ], s.bip);

  // 全隊一覽
  $('#playerTableCard').hidden = !!ui.an.playerId;
  if (!ui.an.playerId) {
    const rows = players.map((p) => {
      const ps = calcStats(recs.filter((r) => r.playerId === p.id));
      return `<tr data-id="${p.id}"><td>${esc(p.number)}</td><td>${esc(p.name)}</td>
        <td class="n">${ps.pa}</td><td class="n">${fmtRate(ps.h, ps.ab)}</td>
        <td>${topEntry(ps.dir, DIR_LABELS)}</td><td>${topEntry(ps.types, TYPE_LABELS)}</td></tr>`;
    }).join('');
    $('#playerTable').innerHTML = `<thead><tr><th>背號</th><th>姓名</th><th>打席</th><th>打擊率</th><th>主要方向</th><th>主要類型</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">這支球隊還沒有球員</td></tr>'}</tbody>`;
  }
}

function initAnalysisControls() {
  $('#anTeam').addEventListener('change', (e) => {
    ui.an = { teamId: e.target.value, playerId: '', gameId: '' };
    renderAnalysis();
  });
  $('#anPlayer').addEventListener('change', (e) => { ui.an.playerId = e.target.value; renderAnalysis(); });
  $('#anGame').addEventListener('change', (e) => { ui.an.gameId = e.target.value; renderAnalysis(); });
  ['#lyPts', '#lyHeat', '#lyDef'].forEach((id) => $(id).addEventListener('change', renderAnalysis));
  $('#playerTable').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    ui.an.playerId = tr.dataset.id;
    renderAnalysis();
    window.scrollTo(0, 0);
  });
}

/* =========================================================
   球隊／比賽管理
   ========================================================= */
let mpTeamId = '';

function recordCount(pred) {
  return db.records.filter(pred).length;
}

function renderManage() {
  // 球隊
  $('#teamList').innerHTML = db.teams.length
    ? db.teams.map((t) => {
        const n = db.players.filter((p) => p.teamId === t.id).length;
        return `<li><span class="grow">${esc(t.name)} <small>${n} 位球員</small></span>
          <button class="btn btn-sm" data-act="rename-team" data-id="${t.id}">改名</button>
          <button class="btn btn-sm btn-danger" data-act="del-team" data-id="${t.id}">刪除</button></li>`;
      }).join('')
    : '<li class="empty">還沒有球隊，先新增一支對手球隊。</li>';

  // 球員
  const teamOpts = db.teams.map((t) => ({ value: t.id, label: t.name }));
  if (!findById(db.teams, mpTeamId)) mpTeamId = db.teams[0]?.id ?? '';
  fillSelect($('#mpTeam'), teamOpts.length ? teamOpts : [{ value: '', label: '（請先新增球隊）' }], mpTeamId);
  const players = sortPlayers(db.players.filter((p) => p.teamId === mpTeamId));
  $('#playerList').innerHTML = players.length
    ? players.map((p) => `<li><span class="grow"><b>#${esc(p.number)}</b> ${esc(p.name)}
        <small>${recordCount((r) => r.playerId === p.id)} 筆紀錄</small></span>
        <button class="btn btn-sm" data-act="edit-player" data-id="${p.id}">編輯</button>
        <button class="btn btn-sm btn-danger" data-act="del-player" data-id="${p.id}">刪除</button></li>`).join('')
    : '<li class="empty">這支球隊還沒有球員。</li>';

  // 比賽
  if (!$('#gameDate').value) $('#gameDate').value = today();
  const gameTeam = $('#gameTeam').value;
  fillSelect($('#gameTeam'), teamOpts.length ? teamOpts : [{ value: '', label: '（請先新增球隊）' }], gameTeam || mpTeamId);
  $('#gameList').innerHTML = db.games.length
    ? sortGames(db.games).map((g) => `<li><span class="grow">${esc(gameLabel(g))}
        <small>${recordCount((r) => r.gameId === g.id)} 筆紀錄</small></span>
        <button class="btn btn-sm btn-primary" data-act="use-game" data-id="${g.id}">開始紀錄</button>
        <button class="btn btn-sm btn-danger" data-act="del-game" data-id="${g.id}">刪除</button></li>`).join('')
    : '<li class="empty">還沒有比賽。</li>';
}

function initManageControls() {
  $('#teamForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#teamName').value.trim();
    if (!name) return;
    const t = { id: uid(), name };
    db.teams.push(t);
    mpTeamId = t.id;
    save();
    e.target.reset();
    toast(`已新增球隊：${name}`);
    renderManage();
  });

  $('#mpTeam').addEventListener('change', (e) => { mpTeamId = e.target.value; renderManage(); });

  $('#playerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!mpTeamId) return toast('請先新增球隊');
    const number = $('#playerNumber').value.trim();
    const name = $('#playerName').value.trim();
    if (!number || !name) return;
    if (db.players.some((p) => p.teamId === mpTeamId && p.number === number)) {
      if (!confirm(`背號 ${number} 已經有人了，還是要新增嗎？`)) return;
    }
    db.players.push({ id: uid(), teamId: mpTeamId, number, name });
    save();
    e.target.reset();
    $('#playerNumber').focus();
    toast(`已新增 #${number} ${name}`);
    renderManage();
  });

  $('#gameForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const teamId = $('#gameTeam').value;
    if (!teamId) return toast('請先新增球隊');
    const g = { id: uid(), date: $('#gameDate').value || today(), teamId, note: $('#gameNote').value.trim() };
    db.games.push(g);
    ui.gameId = g.id;
    db.lastGameId = g.id;
    save();
    $('#gameNote').value = '';
    toast(`已新增比賽：${gameLabel(g)}`);
    renderManage();
  });

  $('#tab-manage').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case 'rename-team': {
        const t = findById(db.teams, id);
        const name = prompt('新的球隊名稱', t.name);
        if (name && name.trim()) { t.name = name.trim(); save(); renderManage(); }
        break;
      }
      case 'del-team': {
        const pids = new Set(db.players.filter((p) => p.teamId === id).map((p) => p.id));
        const gids = new Set(db.games.filter((g) => g.teamId === id).map((g) => g.id));
        const n = recordCount((r) => pids.has(r.playerId) || gids.has(r.gameId));
        if (!confirm(`刪除「${teamName(id)}」會一併刪除 ${pids.size} 位球員、${gids.size} 場比賽、${n} 筆紀錄。確定？`)) return;
        db.teams = db.teams.filter((t) => t.id !== id);
        db.players = db.players.filter((p) => !pids.has(p.id));
        db.games = db.games.filter((g) => !gids.has(g.id));
        db.records = db.records.filter((r) => !pids.has(r.playerId) && !gids.has(r.gameId));
        save();
        renderManage();
        break;
      }
      case 'edit-player': {
        const p = findById(db.players, id);
        const number = prompt('背號', p.number);
        if (number === null) return;
        const name = prompt('姓名', p.name);
        if (name === null) return;
        p.number = number.trim() || p.number;
        p.name = name.trim() || p.name;
        save();
        renderManage();
        break;
      }
      case 'del-player': {
        const p = findById(db.players, id);
        const n = recordCount((r) => r.playerId === id);
        if (!confirm(`刪除 ${playerLabel(p)}${n ? `，以及他的 ${n} 筆紀錄` : ''}？`)) return;
        db.players = db.players.filter((x) => x.id !== id);
        db.records = db.records.filter((r) => r.playerId !== id);
        save();
        renderManage();
        break;
      }
      case 'use-game': {
        ui.gameId = id;
        db.lastGameId = id;
        ui.batterId = null;
        ui.pending = null;
        save();
        showTab('record');
        break;
      }
      case 'del-game': {
        const g = findById(db.games, id);
        const n = recordCount((r) => r.gameId === id);
        if (!confirm(`刪除比賽「${gameLabel(g)}」${n ? `以及 ${n} 筆紀錄` : ''}？`)) return;
        db.games = db.games.filter((x) => x.id !== id);
        db.records = db.records.filter((r) => r.gameId !== id);
        save();
        renderManage();
        break;
      }
    }
  });
}

/* =========================================================
   資料備份
   ========================================================= */
function renderData() {
  const items = [['球隊', db.teams.length], ['球員', db.players.length], ['比賽', db.games.length], ['紀錄', db.records.length]];
  $('#dataSummary').innerHTML = items.map(([k, v]) => `<div class="tile"><b>${v}</b><span>${k}</span></div>`).join('');
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
  const head = ['比賽日期', '對手球隊', '備註', '背號', '姓名', '擊球類型', '結果', '是否安打', '距離(ft)', '角度(度)', 'x(ft)', 'y(ft)', '紀錄時間'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [...db.records].sort((a, b) => a.ts - b.ts).map((r) => {
    const g = findById(db.games, r.gameId) || {};
    const p = findById(db.players, r.playerId) || {};
    const pt = hasPoint(r);
    return [
      g.date, teamName(p.teamId), g.note, p.number, p.name,
      typeOf(r.type)?.label ?? '', resultOf(r.result)?.label ?? r.result, isHit(r) ? '是' : '否',
      pt ? Math.round(dist(r)) : '', pt ? Math.round(angleOf(r.x, r.y)) : '', pt ? r.x : '', pt ? r.y : '',
      new Date(r.ts).toLocaleString('zh-TW'),
    ].map(cell).join(',');
  });
  // 前面加 BOM，Excel 開啟中文才不會亂碼
  download(`壘球落點紀錄_${today()}.csv`, '﻿' + [head.map(cell).join(','), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
}

function loadDemo() {
  const team = { id: uid(), name: '示範隊（可刪除）' };
  const game = { id: uid(), date: today(), teamId: team.id, note: '示範比賽' };
  db.teams.push(team);
  db.games.push(game);
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (weights) => {
    let x = Math.random() * weights.reduce((s, w) => s + w[1], 0);
    for (const [k, w] of weights) { if ((x -= w) <= 0) return k; }
    return weights[0][0];
  };
  const specs = [
    { number: '7', name: '陳拉打', bias: -28, types: [['GB', 4], ['LD', 3], ['FB', 3]] },
    { number: '12', name: '林中間', bias: 0, types: [['GB', 3], ['LD', 4], ['FB', 3]] },
    { number: '23', name: '王推打', bias: 26, types: [['GB', 3], ['LD', 3], ['FB', 3], ['PU', 1]] },
    { number: '31', name: '黃長打', bias: -10, types: [['GB', 1], ['LD', 3], ['FB', 6]] },
    { number: '18', name: '李滾地', bias: 12, types: [['GB', 7], ['LD', 2], ['PU', 1]] },
    { number: '5', name: '張全場', bias: null, types: [['GB', 3], ['LD', 3], ['FB', 3], ['PU', 1]] },
  ];
  let ts = Date.now() - 3600 * 1000;
  specs.forEach((s) => {
    const p = { id: uid(), teamId: team.id, number: s.number, name: s.name };
    db.players.push(p);
    for (let i = 0; i < 14; i++) {
      ts += 30000;
      const roll = Math.random();
      if (roll < 0.08) { db.records.push({ id: uid(), gameId: game.id, playerId: p.id, x: null, y: null, type: null, result: 'K', ts }); continue; }
      if (roll < 0.14) { db.records.push({ id: uid(), gameId: game.id, playerId: p.id, x: null, y: null, type: null, result: 'BB', ts }); continue; }
      const type = pick(s.types);
      const a = clamp(s.bias === null ? rand(-42, 42) : s.bias + gauss() * 14, -44, 44);
      let d;
      let result;
      if (type === 'GB') { d = rand(55, 140); result = Math.random() < 0.3 ? '1B' : pick([['OUT', 8], ['DP', 1], ['E', 1]]); }
      else if (type === 'LD') { d = rand(110, 240); result = Math.random() < 0.6 ? pick([['1B', 7], ['2B', 3]]) : 'OUT'; }
      else if (type === 'PU') { d = rand(40, 120); result = 'OUT'; }
      else {
        d = rand(180, s.name === '黃長打' ? 325 : 295);
        result = d > G.FENCE ? 'HR' : d > 255 && Math.random() < 0.35 ? pick([['2B', 3], ['3B', 1]]) : pick([['OUT', 8], ['SF', 1], ['1B', 2]]);
      }
      const [x, y] = polar(d, a);
      db.records.push({ id: uid(), gameId: game.id, playerId: p.id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, type, result, ts });
    }
  });
  ui.gameId = game.id;
  db.lastGameId = game.id;
  ui.an = { teamId: team.id, playerId: '', gameId: '' };
  save();
}

function initDataControls() {
  $('#exportJson').addEventListener('click', () => {
    download(`壘球落點備份_${today()}.json`, JSON.stringify(db, null, 2), 'application/json');
  });
  $('#exportCsv').addEventListener('click', () => {
    if (!db.records.length) return toast('目前沒有紀錄可匯出');
    exportCsv();
  });
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.teams) || !Array.isArray(data.records)) throw new Error('格式不符');
      if (!confirm(`匯入會取代目前所有資料（${db.records.length} 筆紀錄）。確定？`)) return;
      db = normalize(data);
      ui.gameId = db.lastGameId;
      ui.batterId = null;
      ui.an = { teamId: '', playerId: '', gameId: '' };
      save();
      toast(`匯入完成：${db.records.length} 筆紀錄`);
      renderData();
    } catch (err) {
      alert('匯入失敗：這不是本系統匯出的備份檔。');
    }
  });
  $('#demoBtn').addEventListener('click', () => {
    loadDemo();
    toast('已載入示範資料，去「分析」看看吧');
    showTab('analysis');
  });
  $('#clearBtn').addEventListener('click', () => {
    if (!confirm('確定清除全部資料？建議先匯出備份。')) return;
    if (!confirm('再確認一次：清除後無法復原。')) return;
    db = emptyDb();
    ui.gameId = null;
    ui.batterId = null;
    ui.pending = null;
    ui.an = { teamId: '', playerId: '', gameId: '' };
    save();
    toast('已清除全部資料');
    renderData();
  });
}

/* ---------- 啟動 ---------- */
document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.goto)));
initRecordControls();
initAnalysisControls();
initManageControls();
initDataControls();
showTab(db.games.length ? 'record' : 'manage');
