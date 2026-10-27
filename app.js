import { firebaseConfig } from "./config.js";

const WORKS = ["清掃", "軽作業・検品", "封入・梱包・発送", "データ入力・書類整理", "農作業", "イベント運営補助", "その他"];
const FORMS = ["業務委託（作業の依頼）", "職場実習", "直接雇用の検討"];
const SEMINAR = ["第1回に参加したい", "第2回に参加したい", "まずは相談だけ"];
const TYPES = ["就労継続支援A型", "就労継続支援B型", "就労移行支援", "就労定着支援", "その他"];
const WARDS = ["千種区", "東区", "北区", "西区", "中村区", "中区", "昭和区", "瑞穂区", "熱田区", "中川区", "港区", "南区", "守山区", "緑区", "名東区", "天白区", "名古屋市外"];
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
      try { await au.signInWithPopup(auth, provider); }
      catch (e) { if (e && e.code === "auth/popup-blocked") await au.signInWithRedirect(auth, provider); else throw e; }
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
const state = { backend: null, user: null, admin: false, demo: false, live: { companies: [], facilities: [], pairs: [] }, loaded: false };
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

const VIEWS = ["home", "kigyou", "jigyosho", "match", "bansou"];
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
  if (!b || b.mode === "local") return [el("span", { text: "お試しモード：この端末に保存されたデータを表示しています。" })];
  if (!state.user) return [el("span", { text: "委員会の担当者だけが見られます。" }), el("button", { class: "btn small", type: "button", onclick: doSignIn }, "Googleでログイン")];
  return [el("span", { text: state.user.email + (state.admin ? "（委員会）" : "（閲覧権限なし）") }), el("button", { class: "btn small ghost", type: "button", onclick: () => b.signOut() }, "ログアウト")];
}
async function doSignIn() {
  try { await state.backend.signIn(); } catch (e) { console.warn(e); }
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
  document.querySelectorAll("[data-auth]").forEach(n => n.replaceChildren(...authBar()));
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

document.querySelectorAll(".demo-toggle").forEach(t => t.addEventListener("change", e => { state.demo = e.target.checked; render(); }));

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
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

// ---------------------------------------------------------------- start
render();
(async () => {
  try {
    state.backend = firebaseConfig ? await firebaseBackend(firebaseConfig) : localBackend();
  } catch (e) {
    console.warn("Firebase に接続できませんでした。お試しモードで動きます。", e);
    state.backend = localBackend();
  }
  $("#setup-banner").hidden = state.backend.mode !== "local";
  state.backend.onAuth((user, admin) => {
    state.user = user; state.admin = admin;
    if (admin) state.backend.watch(d => { state.live = d; state.loaded = true; render(); });
    else { state.live = { companies: [], facilities: [], pairs: [] }; state.loaded = false; }
    render();
  });
})();
