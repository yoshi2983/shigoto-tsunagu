import { firebaseConfig } from "./config.js";

const WORKS = ["清掃", "軽作業・検品", "封入・梱包・発送", "データ入力・書類整理", "農作業", "イベント運営補助", "その他"];
const FORMS = ["業務委託（作業の依頼）", "職場実習", "直接雇用の検討"];
const SEMINAR = ["第1回に参加したい", "第2回に参加したい", "まずは相談だけ"];
const TYPES = ["就労継続支援A型", "就労継続支援B型", "就労移行支援", "就労定着支援", "その他"];
const WARDS = ["千種区", "東区", "北区", "西区", "中村区", "中区", "昭和区", "瑞穂区", "熱田区", "中川区", "港区", "南区", "守山区", "緑区", "名東区", "天白区", "名古屋市外"];
const SIZES = ["37.5人未満", "37.5〜100人", "101〜300人", "301人以上"];
const MOVES = ["企業の事業所でも作業できる", "事業所内での作業のみ", "内容による"];
// 登録一覧で編集する項目（申込フォームと同じ並び）
const FIELDS = {
  companies: [
    ["name", "会社名", "text"], ["person", "ご担当者名", "text"], ["email", "メールアドレス", "text"], ["tel", "電話番号", "text"],
    ["area", "所在地（区）", "select", WARDS], ["size", "従業員数", "select", SIZES], ["work", "依頼したい業務", "checks", WORKS],
    ["detail", "業務の内容・量・時期", "area"], ["forms", "関心のあるかたち", "checks", FORMS], ["seminar", "セミナーへの参加", "checks", SEMINAR],
    ["ask", "今一番聞きたいこと", "area"],
  ],
  facilities: [
    ["name", "事業所名", "text"], ["type", "事業所の種別", "select", TYPES], ["person", "ご担当者名", "text"], ["email", "メールアドレス", "text"],
    ["tel", "電話番号", "text"], ["area", "所在地（区）", "select", WARDS], ["work", "対応できる作業", "checks", WORKS],
    ["forms", "対応できるかたち", "checks", FORMS], ["cap", "受け入れ可能な量・人数", "text"], ["move", "施設外での作業", "select", MOVES],
    ["strength", "事業所の強み・得意な作業", "area"],
  ],
};
const STEPS = ["ヒアリング", "職場見学", "業務の検討", "事業所と調整", "トライアル"];
const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/10.12.2/";

const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};
const kcls = w => "k" + (WORKS.indexOf(w) + 1);
const chip = w => el("span", { class: "chip " + kcls(w), text: w });
const ms = t => (t && typeof t.toMillis === "function") ? t.toMillis() : (typeof t === "number" ? t : 0);

// ---------------------------------------------------------------- backends
// お試しモード：Firebase 未設定の時は、この端末の localStorage にだけ保存する。
function localBackend() {
  const KEY = "shigoto-local-v1";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } };
  let store = { companies: [], facilities: [], pairs: [], ...load() };
  let listener = null;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (_) {} listener && listener(store); };
  const id = () => Math.random().toString(36).slice(2, 10);
  return {
    mode: "local",
    async submit(coll, rec) { store[coll].push({ id: id(), ...rec, createdAt: Date.now() }); save(); },
    onAuth(cb) { cb({ email: "この端末" }, true); },
    async signIn() {}, async signOut() {},
    watch(cb) { listener = cb; cb(store); },
    async addPair(rec) { store.pairs.push({ id: id(), ...rec, createdAt: Date.now() }); save(); },
    async updatePair(pid, patch) { Object.assign(store.pairs.find(p => p.id === pid) || {}, patch); save(); },
    async deletePair(pid) { store.pairs = store.pairs.filter(p => p.id !== pid); save(); },
    async updateItem(coll, iid, patch) { Object.assign(store[coll].find(x => x.id === iid) || {}, patch); save(); },
    async deleteItem(coll, iid) { store[coll] = store[coll].filter(x => x.id !== iid); save(); },
  };
}

async function firebaseBackend(cfg) {
  const [{ initializeApp }, fs, au] = await Promise.all([
    import(FIREBASE_SDK + "firebase-app.js"),
    import(FIREBASE_SDK + "firebase-firestore.js"),
    import(FIREBASE_SDK + "firebase-auth.js"),
  ]);
  const app = initializeApp(cfg);
  const db = fs.getFirestore(app);
  const auth = au.getAuth(app);
  let unsubs = [];
  return {
    mode: "firebase",
    async submit(coll, rec) { await fs.addDoc(fs.collection(db, coll), { ...rec, createdAt: fs.serverTimestamp() }); },
    onAuth(cb) {
      au.onAuthStateChanged(auth, async user => {
        if (!user) { cb(null, false); return; }
        let admin = false;
        try { admin = (await fs.getDoc(fs.doc(db, "admins", user.email.toLowerCase()))).exists(); } catch (_) {}
        cb(user, admin);
      });
    },
    async signIn() {
      const provider = new au.GoogleAuthProvider();
      // リダイレクト方式は iPhone の Safari で戻ってこられないため、ポップアップ方式だけを使う
      await au.signInWithPopup(auth, provider);
    },
    async signOut() { unsubs.forEach(u => u()); unsubs = []; await au.signOut(auth); },
    watch(cb) {
      unsubs.forEach(u => u());
      const data = { companies: [], facilities: [], pairs: [] };
      unsubs = Object.keys(data).map(coll => fs.onSnapshot(fs.collection(db, coll), snap => {
        data[coll] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        cb({ ...data });
      }, err => console.warn(coll, err)));
    },
    async addPair(rec) { await fs.addDoc(fs.collection(db, "pairs"), { ...rec, createdAt: fs.serverTimestamp() }); },
    async updatePair(pid, patch) { await fs.updateDoc(fs.doc(db, "pairs", pid), { ...patch, updatedAt: fs.serverTimestamp() }); },
    async deletePair(pid) { await fs.deleteDoc(fs.doc(db, "pairs", pid)); },
    async updateItem(coll, iid, patch) { await fs.updateDoc(fs.doc(db, coll, iid), patch); },
    async deleteItem(coll, iid) { await fs.deleteDoc(fs.doc(db, coll, iid)); },
  };
}

// ---------------------------------------------------------------- state
const DEMO = {
  companies: [
    { id: "ex-c1", name: "（例）株式会社サンプル食品", area: "中川区", size: "37.5〜100人", work: ["軽作業・検品", "封入・梱包・発送"], forms: ["業務委託（作業の依頼）", "職場実習"], detail: "月2回、商品ラベル貼りと検品。1回500個ほど。", createdAt: 1 },
    { id: "ex-c2", name: "（例）サンプル設備工業", area: "港区", size: "101〜300人", work: ["データ入力・書類整理", "清掃"], forms: ["直接雇用の検討"], detail: "点検報告書の入力と事務所清掃。", createdAt: 2 },
  ],
  facilities: [
    { id: "ex-f1", name: "（例）ワークサンプル中川", type: "就労継続支援B型", area: "中川区", work: ["軽作業・検品", "封入・梱包・発送", "清掃"], forms: ["業務委託（作業の依頼）"], createdAt: 1 },
    { id: "ex-f2", name: "（例）サンプル移行支援センター", type: "就労移行支援", area: "熱田区", work: ["データ入力・書類整理"], forms: ["職場実習", "直接雇用の検討"], createdAt: 2 },
    { id: "ex-f3", name: "（例）みどりサンプル農園", type: "就労継続支援A型", area: "緑区", work: ["農作業", "清掃"], forms: ["業務委託（作業の依頼）", "直接雇用の検討"], createdAt: 3 },
  ],
  pairs: [
    { id: "ex-p1", companyId: "ex-c1", facilityId: "ex-f1", step: 3, contract: false, staff: "例 委員", memo: "職場見学済み。ラベル貼りの手順書を作成中。", createdAt: 1 },
  ],
};
const state = { backend: null, user: null, admin: false, demo: false, tab: "companies", query: "", edit: null, live: { companies: [], facilities: [], pairs: [] }, loaded: false };
const clean = list => list.map(x => ({ ...x, work: Array.isArray(x.work) ? x.work : [], forms: Array.isArray(x.forms) ? x.forms : [] }));
const data = () => state.demo ? DEMO : { companies: clean(state.live.companies), facilities: clean(state.live.facilities), pairs: state.live.pairs };

// ---------------------------------------------------------------- matching
function score(c, f) {
  const w = c.work.filter(x => f.work.includes(x));
  const fm = c.forms.filter(x => f.forms.includes(x));
  const inCity = a => a && a !== "名古屋市外";
  let s = Math.min(w.length, 3) * 25 + (fm.length ? 15 : 0);
  if (c.area && c.area === f.area) s += 10; else if (inCity(c.area) && inCity(f.area)) s += 5;
  const why = [];
  if (w.length) why.push("作業：" + w.join("・"));
  if (fm.length) why.push("かたち：" + fm.join("・"));
  if (c.area && c.area === f.area) why.push("同じ" + c.area);
  return { s: Math.min(s, 100), why: why.join(" ／ ") || "重なる条件なし" };
}

// ---------------------------------------------------------------- static UI
$("#home-chips").append(...WORKS.slice(0, 6).map(chip));
const fillChecks = (id, list, name) => $(id).append(...list.map((v, i) =>
  el("label", {}, el("input", { type: "checkbox", name, value: v, id: id.slice(1) + "-" + i }), v)));
fillChecks("#k-work", WORKS, "work"); fillChecks("#k-form", FORMS, "forms"); fillChecks("#k-sem", SEMINAR, "seminar");
fillChecks("#j-work", WORKS, "work"); fillChecks("#j-form", FORMS, "forms");
const fillSelect = (id, list) => $(id).append(el("option", { value: "", text: "選択してください" }), ...list.map(v => el("option", { text: v })));
fillSelect("#k-area", WARDS); fillSelect("#j-area", WARDS); fillSelect("#j-type", TYPES);

const VIEWS = ["home", "kigyou", "jigyosho", "match", "bansou", "ichiran"];
function route() {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
  for (const id of VIEWS) $("#v-" + id).hidden = id !== v;
  document.querySelectorAll("nav.tabs a").forEach(a => a.setAttribute("aria-current", a.getAttribute("href") === "#" + v ? "page" : "false"));
  window.scrollTo(0, 0);
}
addEventListener("hashchange", route); route();

// ---------------------------------------------------------------- render
const byId = (list, id) => list.find(x => x.id === id);
function tile(label, value, sub, ratio) {
  return el("div", {}, el("span", { class: "t", text: label }), el("span", { class: "v", text: value }), el("span", { class: "t", text: sub }),
    ratio == null ? null : el("span", { class: "meter" + (ratio >= 1 ? " done" : "") }, el("i", { style: "width:" + Math.round(Math.min(Math.max(ratio, 0), 1) * 100) + "%" })));
}
function authBar() {
  const b = state.backend;
  if (!b) return [];
  if (b.mode === "local") return [el("span", { text: "お試しモード：この端末に保存されたデータを表示しています。" })];
  if (b.mode === "error") return [el("span", { text: "サーバーに接続できません。ページを再読み込みしてください。" })];
  if (!state.user) {
    // iPhone のホーム画面アプリ（standalone）では、Google のログイン画面から戻ってこられない
    if (isIOS && standalone) return [el("span", { text: "iPhoneのホーム画面アプリからはログインできません。Safariでこのページを開いてログインしてください。" })];
    return [el("span", { text: "委員会の担当者だけが見られます。" }), el("button", { class: "btn small", type: "button", onclick: doSignIn }, "Googleでログイン"),
      state.authError ? el("span", { class: "msg err", text: state.authError }) : null];
  }
  return [el("span", { text: state.user.email + (state.admin ? "（委員会）" : "（閲覧権限なし）") }), el("button", { class: "btn small ghost", type: "button", onclick: () => b.signOut() }, "ログアウト")];
}
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
async function doSignIn() {
  state.authError = "";
  try { await state.backend.signIn(); }
  catch (e) {
    console.warn(e);
    const code = (e && e.code) || "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") state.authError = "ログイン画面が閉じられました。もう一度お試しください。";
    else if (code === "auth/popup-blocked") state.authError = "ポップアップがブロックされました。ブラウザの設定でポップアップを許可してから、もう一度お試しください。";
    else if (code === "auth/unauthorized-domain") state.authError = "このアドレスからのログインが許可されていません（Firebase の承認済みドメインを確認してください）。";
    else state.authError = "ログインできませんでした（" + (code || "不明なエラー") + "）。";
    render();
  }
}
function gate(container) {
  if (state.demo || state.admin) return false;
  const msg = !state.user ? "ログインすると、登録された企業・事業所と伴走記録が表示されます。"
    : "このアカウントには閲覧権限がありません。委員会の管理者に、権限の追加を依頼してください。";
  container.replaceChildren(el("div", { class: "empty" }, el("b", { text: "委員会用の画面です" }), msg, el("span", { class: "note", text: "「例のデータで試す」で、画面の動きは確認できます。" })));
  return true;
}

function render() {
  document.querySelectorAll("[data-demo]").forEach(n => n.hidden = !state.demo);
  document.querySelectorAll(".demo-toggle").forEach(n => n.checked = state.demo);
  document.querySelectorAll("[data-auth]").forEach(n => n.replaceChildren(...authBar().filter(Boolean)));
  const d = data();
  const can = state.demo || state.admin;

  // マッチング
  const ml = $("#m-list");
  $("#m-counts").replaceChildren(...(can ? [
    tile("登録企業", d.companies.length + "社", "KDI 参加企業 延べ20社以上", d.companies.length / 20),
    tile("登録事業所", d.facilities.length + "か所", "伴走の相手となる事業所", null),
    tile("伴走ペア", d.pairs.length + "組", "目標 10〜15組", d.pairs.length / 10)] : []));
  if (!gate(ml)) {
    if (!state.demo && !state.loaded) ml.replaceChildren(el("div", { class: "empty" }, el("b", { text: "読み込んでいます" })));
    else if (!d.companies.length) ml.replaceChildren(el("div", { class: "empty" }, el("b", { text: "まだ企業の登録がありません" }),
      "「企業の方」のフォームから届いた相談が、ここに並びます。", el("a", { class: "btn small ghost", href: "#kigyou", text: "企業フォームを開く" })));
    else ml.replaceChildren(...[...d.companies].sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).map(c => companyCard(c, d)));
  }

  renderIchiran(d, can);

  // 伴走記録
  const bl = $("#b-list"), pairs = d.pairs;
  const trial = pairs.filter(p => p.step >= 5).length, contracts = pairs.filter(p => p.contract).length;
  $("#b-kdi").replaceChildren(...(can ? [
    tile("伴走ペア", pairs.length + "組", "目標 10〜15組", pairs.length / 10),
    tile("トライアル開始", pairs.length ? Math.round(trial / pairs.length * 100) + "%" : "―", trial + "組／目標 50%以上", pairs.length ? (trial / pairs.length) / .5 : 0),
    tile("雇用契約締結", contracts + "件", "目標 1件以上", contracts)] : []));
  if (!gate(bl)) {
    if (!pairs.length) bl.replaceChildren(el("div", { class: "empty" }, el("b", { text: "伴走ペアはまだありません" }),
      "「マッチング」で候補の事業所を選ぶと、ここにペアができます。", el("a", { class: "btn small ghost", href: "#match", text: "マッチングを開く" })));
    else bl.replaceChildren(...[...pairs].sort((a, b) => ms(a.createdAt) - ms(b.createdAt)).map(p => pairCard(p, d)));
  }
}

function companyCard(c, d) {
  const paired = new Set(d.pairs.filter(p => p.companyId === c.id).map(p => p.facilityId));
  const cands = d.facilities.map(f => ({ f, ...score(c, f) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
  const contact = [c.person, c.email, c.tel].filter(Boolean).join("　");
  return el("article", { class: "card" },
    el("div", { class: "card-top" }, el("h3", { text: c.name }), el("span", { class: "meta", text: [c.area, c.size].filter(Boolean).join("・") })),
    el("div", { class: "chips" }, c.work.map(chip)),
    el("div", { class: "actions" }, el("button", { class: "btn small ghost", type: "button", onclick: () => openEdit("companies", c.id) }, "登録内容を直す")),
    c.detail ? el("p", { class: "meta", text: c.detail }) : null,
    (c.forms.length || (c.seminar || []).length) ? el("p", { class: "meta", text: [...c.forms, ...(c.seminar || [])].join("／") }) : null,
    c.ask ? el("p", { class: "meta", text: "聞きたいこと：" + c.ask }) : null,
    contact ? el("p", { class: "meta", text: "連絡先：" + contact }) : null,
    el("div", { class: "cands" }, cands.length ? cands.map(x => el("div", { class: "cand" },
      el("span", { class: "score " + (x.s >= 60 ? "hi" : x.s >= 35 ? "mid" : "lo"), text: x.s, "aria-label": "適合度 " + x.s + "点" }),
      el("div", {}, el("b", { text: x.f.name }), el("div", { class: "why", text: [x.f.type, x.f.area].filter(Boolean).join("・") + "　" + x.why })),
      paired.has(x.f.id) ? el("span", { class: "pill ok", text: "伴走中" })
        : el("button", { class: "btn small", type: "button", onclick: () => addPair(c, x.f) }, "伴走ペアにする")))
      : el("p", { class: "meta", text: "条件が重なる事業所はまだありません。事業所の登録が増えると候補が出ます。" })));
}

function pairCard(p, d) {
  const c = byId(d.companies, p.companyId), f = byId(d.facilities, p.facilityId);
  const memoId = "memo-" + p.id, staffId = "staff-" + p.id;
  return el("article", { class: "card" },
    el("div", { class: "card-top" }, el("h3", { text: c ? c.name : "（削除された企業）" }),
      p.contract ? el("span", { class: "pill ok", text: "雇用契約締結" }) : p.step >= 5 ? el("span", { class: "pill warn", text: "トライアル中" }) : el("span", { class: "pill mute", text: "ステップ" + p.step + "／5" })),
    el("p", { class: "meta", text: "× " + (f ? f.name + "（" + [f.type, f.area].filter(Boolean).join("・") + "）" : "（削除された事業所）") }),
    f && (f.person || f.email || f.tel) ? el("p", { class: "meta", text: "事業所の連絡先：" + [f.person, f.email, f.tel].filter(Boolean).join("　") }) : null,
    el("div", { class: "steps", role: "group", "aria-label": "伴走ステップ" }, STEPS.map((s, i) =>
      el("button", { type: "button", class: (i < p.step ? "done" : "") + (i === p.step - 1 ? " now" : ""), "aria-pressed": i < p.step ? "true" : "false",
        onclick: () => savePair(p, { step: i + 1 }) }, (i + 1) + " " + s))),
    el("div", { class: "field" }, el("label", { for: staffId, text: "JC担当者" }),
      el("input", { type: "text", id: staffId, value: p.staff || "", maxlength: "60", onchange: e => savePair(p, { staff: e.target.value.trim() }) })),
    el("div", { class: "field" }, el("label", { for: memoId, text: "伴走メモ（経過・次にやること）" }),
      el("textarea", { id: memoId, maxlength: "2000", onchange: e => savePair(p, { memo: e.target.value }) }, p.memo || "")),
    el("div", { class: "actions" },
      el("label", { class: "toggle" }, el("input", { type: "checkbox", checked: !!p.contract, onchange: e => savePair(p, { contract: e.target.checked }) }), "雇用契約を締結した"),
      el("button", { class: "btn small ghost", type: "button", onclick: e => confirmRemove(e.currentTarget, p) }, "ペアを解除")));
}

// ---------------------------------------------------------------- 登録一覧（編集・削除）
const fmtDate = t => { const v = ms(t); if (!v || v < 1e11) return ""; const dt = new Date(v); return (dt.getMonth() + 1) + "/" + dt.getDate() + " 登録"; };
function openEdit(coll, iid) {
  state.tab = coll; state.edit = { coll, id: iid, formEl: null, msg: "" };
  if (location.hash !== "#ichiran") location.hash = "#ichiran"; else render();
  setTimeout(() => { const n = document.getElementById("row-" + iid); if (n) n.scrollIntoView({ block: "start", behavior: "smooth" }); }, 50);
}
function closeEdit() { state.edit = null; render(); }
function buildEditForm(coll, item, pairCount) {
  const form = el("form", { class: "edit", novalidate: true });
  for (const [key, label, kind, opts] of FIELDS[coll]) {
    const fid = "e-" + key;
    const v = item[key];
    let input;
    if (kind === "text") input = el("input", { type: "text", id: fid, name: key, value: v || "" });
    else if (kind === "area") input = el("textarea", { id: fid, name: key }, v || "");
    else if (kind === "select") {
      input = el("select", { id: fid, name: key }, el("option", { value: "", text: "選択してください" }),
        opts.map(o => el("option", { text: o, selected: o === v })));
      if (v && !opts.includes(v)) input.append(el("option", { text: v, selected: true }));
    } else {
      const have = Array.isArray(v) ? v : [];
      input = el("div", { class: "checks", role: "group", "aria-label": label },
        opts.map((o, i) => el("label", {}, el("input", { type: "checkbox", name: key, value: o, id: fid + "-" + i, checked: have.includes(o) }), o)));
    }
    form.append(el("div", { class: "field" }, kind === "checks" ? el("span", { class: "lbl", text: label }) : el("label", { for: fid, text: label }), input));
  }
  const msg = el("p", { class: "msg", role: "status", hidden: true });
  const del = el("button", { class: "btn ghost danger", type: "button" }, "この登録を削除");
  del.addEventListener("click", () => {
    if (!del.dataset.armed) {
      del.dataset.armed = "1";
      del.textContent = pairCount ? `もう一度押すと削除（伴走ペア${pairCount}組も解除）` : "もう一度押すと削除します";
      setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = "この登録を削除"; } }, 5000);
      return;
    }
    removeItem(coll, item.id);
  });
  form.append(el("div", { class: "actions" }, el("button", { class: "btn", type: "submit" }, "保存する"),
    el("button", { class: "btn ghost", type: "button", onclick: closeEdit }, "閉じる"), el("span", { class: "spacer" }), del), msg);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const patch = {};
    for (const [key, , kind] of FIELDS[coll]) {
      patch[key] = kind === "checks" ? [...form.querySelectorAll(`input[name="${key}"]:checked`)].map(i => i.value) : (form.elements[key].value || "").trim();
    }
    if (!patch.name) { msg.hidden = false; msg.className = "msg err"; msg.textContent = "名前は空にできません。"; return; }
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      if (state.demo) Object.assign(DEMO[coll].find(x => x.id === item.id) || {}, patch);
      else await state.backend.updateItem(coll, item.id, patch);
      state.edit = null; state.flash = { id: item.id, text: "保存しました" }; render();
      setTimeout(() => { if (state.flash && state.flash.id === item.id) { state.flash = null; render(); } }, 3000);
    } catch (err) {
      console.warn(err); btn.disabled = false;
      msg.hidden = false; msg.className = "msg err"; msg.textContent = "保存できませんでした。通信状態を確認して、もう一度お試しください。";
    }
  });
  return form;
}
async function removeItem(coll, iid) {
  const key = coll === "companies" ? "companyId" : "facilityId";
  try {
    if (state.demo) {
      DEMO[coll] = DEMO[coll].filter(x => x.id !== iid);
      DEMO.pairs = DEMO.pairs.filter(p => p[key] !== iid);
    } else {
      for (const p of state.live.pairs.filter(p => p[key] === iid)) await state.backend.deletePair(p.id);
      await state.backend.deleteItem(coll, iid);
    }
    state.edit = null; render();
  } catch (e) { console.warn("削除できませんでした", e); }
}
function renderIchiran(d, can) {
  const box = $("#i-list");
  $("#i-tabs").replaceChildren(...[["companies", "企業", d.companies.length], ["facilities", "事業所", d.facilities.length]].map(([k, label, n]) =>
    el("button", { type: "button", class: "seg" + (state.tab === k ? " on" : ""), "aria-pressed": state.tab === k ? "true" : "false",
      onclick: () => { state.tab = k; state.edit = null; render(); } }, `${label}（${n}）`)));
  if (gate(box)) return;
  const q = state.query.trim().toLowerCase();
  const items = [...d[state.tab]].sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
    .filter(x => !q || [x.name, x.person, x.email, x.area, x.type].some(v => (v || "").toLowerCase().includes(q)));
  if (!items.length) {
    box.replaceChildren(el("div", { class: "empty" }, el("b", { text: q ? "見つかりませんでした" : "まだ登録がありません" }),
      q ? "名前・担当者・メール・区で探せます。" : (state.tab === "companies" ? "企業フォームから届くと、ここに並びます。" : "事業所フォームから届くと、ここに並びます。")));
    return;
  }
  const pairKey = state.tab === "companies" ? "companyId" : "facilityId";
  box.replaceChildren(...items.map(x => {
    const editing = state.edit && state.edit.coll === state.tab && state.edit.id === x.id;
    const pairCount = d.pairs.filter(p => p[pairKey] === x.id).length;
    if (editing && !state.edit.formEl) state.edit.formEl = buildEditForm(state.tab, x, pairCount);
    const flash = state.flash && state.flash.id === x.id ? el("span", { class: "pill ok", text: state.flash.text }) : null;
    return el("article", { class: "row" + (editing ? " open" : ""), id: "row-" + x.id },
      el("div", { class: "row-main" },
        el("div", { class: "row-text" },
          el("b", { text: x.name || "（名前なし）" }),
          el("span", { class: "meta", text: [x.type, x.area, x.person, fmtDate(x.createdAt), pairCount ? "伴走ペア" + pairCount + "組" : ""].filter(Boolean).join("・") })),
        flash,
        editing ? null : el("button", { class: "btn small ghost", type: "button", onclick: () => openEdit(state.tab, x.id) }, "編集")),
      editing ? state.edit.formEl : null);
  }));
}

function confirmRemove(btn, p) {
  if (btn.dataset.armed) { removePair(p); return; }
  btn.dataset.armed = "1"; btn.textContent = "もう一度押すと解除します";
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = "ペアを解除"; } }, 4000);
}

// ---------------------------------------------------------------- writes
async function addPair(c, f) {
  const rec = { companyId: c.id, facilityId: f.id, step: 1, contract: false, staff: "", memo: "" };
  if (state.demo) { DEMO.pairs.push({ id: "ex-p" + Date.now(), ...rec, createdAt: Date.now() }); render(); return; }
  try { await state.backend.addPair(rec); } catch (e) { console.warn("保存できませんでした", e); }
}
async function savePair(p, patch) {
  if (state.demo) { Object.assign(p, patch); render(); return; }
  try { await state.backend.updatePair(p.id, patch); } catch (e) { console.warn("保存できませんでした", e); }
}
async function removePair(p) {
  if (state.demo) { DEMO.pairs.splice(DEMO.pairs.indexOf(p), 1); render(); return; }
  try { await state.backend.deletePair(p.id); } catch (e) { console.warn("削除できませんでした", e); }
}

// ---------------------------------------------------------------- forms
const picked = (form, name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);
const val = (f, n) => (f.elements[n].value || "").trim();
function showMsg(id, text, kind) { const m = $(id); m.hidden = false; m.className = "msg " + kind; m.textContent = text; }
function bindForm(formSel, msgSel, coll, build, need, done) {
  const form = $(formSel);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (val(form, "website")) return; // 自動送信（スパム）よけ
    const rec = build(form);
    const missing = need.filter(([k]) => !rec[k] || (Array.isArray(rec[k]) && !rec[k].length)).map(([, l]) => l);
    if (rec.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rec.email)) missing.push("メールアドレスの形式");
    if (!form.elements.consent.checked) missing.push("個人情報の取り扱いへの同意");
    if (missing.length) { showMsg(msgSel, "次の項目を確認してください：" + missing.join("、"), "err"); return; }
    if (!state.backend) { showMsg(msgSel, "準備中です。少し待ってから、もう一度お試しください。", "err"); return; }
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      await state.backend.submit(coll, rec);
      form.reset();
      showMsg(msgSel, done, "ok");
    } catch (err) {
      console.warn(err);
      showMsg(msgSel, "送信できませんでした。通信状態を確認して、もう一度お試しください。", "err");
    } finally { btn.disabled = false; }
  });
}
bindForm("#f-kigyou", "#k-msg", "companies", f => ({
  name: val(f, "name"), person: val(f, "person"), email: val(f, "email"), tel: val(f, "tel"), area: val(f, "area"), size: val(f, "size"),
  work: picked(f, "work"), detail: val(f, "detail"), forms: picked(f, "forms"), seminar: picked(f, "seminar"), ask: val(f, "ask"),
}), [["name", "会社名"], ["person", "ご担当者名"], ["email", "メールアドレス"], ["area", "所在地"], ["work", "依頼したい業務"]],
"送信しました。委員会の担当者から、ご入力のメールアドレスへご連絡します。");
bindForm("#f-jigyosho", "#j-msg", "facilities", f => ({
  name: val(f, "name"), type: val(f, "type"), person: val(f, "person"), email: val(f, "email"), tel: val(f, "tel"), area: val(f, "area"),
  work: picked(f, "work"), forms: picked(f, "forms"), cap: val(f, "cap"), move: val(f, "move"), strength: val(f, "strength"),
}), [["name", "事業所名"], ["type", "事業所の種別"], ["person", "ご担当者名"], ["email", "メールアドレス"], ["area", "所在地"], ["work", "対応できる作業"]],
"登録しました。委員会の担当者から、ご入力のメールアドレスへご連絡します。");

document.querySelectorAll(".demo-toggle").forEach(t => t.addEventListener("change", e => { state.demo = e.target.checked; state.edit = null; render(); }));
$("#i-search").addEventListener("input", e => { state.query = e.target.value; state.edit = null; render(); });

// ---------------------------------------------------------------- install (PWA)
let deferred = null;
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
if (!standalone) {
  addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); deferred = e;
    $("#install-box").hidden = false; $("#install-btn").hidden = false;
  });
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    $("#install-box").hidden = false;
    $("#install-text").textContent = "iPhoneでは、Safariの共有ボタン（□に↑）から「ホーム画面に追加」を選ぶと、アプリのようにすぐ開けます。";
  }
}
$("#install-btn").addEventListener("click", async () => {
  if (!deferred) return;
  deferred.prompt(); await deferred.userChoice; deferred = null;
  $("#install-box").hidden = true;
});
if ("serviceWorker" in navigator) {
  // 新しい版が入ったら1回だけ再読み込みして、古い画面が残らないようにする（初回のインストール時は除く）
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  addEventListener("load", () => navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {}));
}

// ---------------------------------------------------------------- start
render();
(async () => {
  try {
    state.backend = firebaseConfig ? await firebaseBackend(firebaseConfig) : localBackend();
  } catch (e) {
    // 設定済みなのにつながらない時は、端末に保存して「送信しました」と見せない（届いたと誤解させない）。
    console.warn("Firebase に接続できませんでした。", e);
    const fail = async () => { throw new Error("offline"); };
    state.backend = { mode: "error", submit: fail, signIn: fail, signOut: fail, onAuth(cb) { cb(null, false); }, watch() {}, addPair: fail, updatePair: fail, deletePair: fail };
    $("#setup-banner").firstElementChild.textContent = "サーバーに接続できません。通信状態を確認して、ページを再読み込みしてください。";
  }
  $("#setup-banner").hidden = state.backend.mode === "firebase";
  state.backend.onAuth((user, admin) => {
    state.user = user; state.admin = admin;
    if (admin) state.backend.watch(d => { state.live = d; state.loaded = true; render(); });
    else { state.live = { companies: [], facilities: [], pairs: [] }; state.loaded = false; }
    render();
  });
})();
