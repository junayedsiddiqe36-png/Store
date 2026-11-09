/* ============================================================
   Bot Script Store — Telegram Mini App
   Hosting: GitHub Pages · Database: Firebase Firestore
   কোনো সার্ভার লাগে না — সব সরাসরি Firebase-এর সাথে কথা বলে।
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged, signOut,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  linkWithPopup, linkWithRedirect, browserLocalPersistence, setPersistence,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, runTransaction,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const tg = window.Telegram?.WebApp || null;
const inTelegram = !!(tg && tg.initData && tg.initData.length > 0);
const OWNER_EMAIL = String(window.OWNER_EMAIL || "").toLowerCase();

const state = {
  auth: null, db: null, fbUser: null,
  user: null, isAdmin: false,
  settings: { store_name: "Bot Script Store", currency: "BDT", min_deposit: 10, payment_instructions: "", telegram_app_link: "", support_url: "" },
  products: [],
  tab: "home", adminTab: "deposits", profileTab: "orders",
};

const $app = document.getElementById("app");
const $modal = document.getElementById("modal-root");
const $toast = document.getElementById("toast-root");

/* ---------------- helpers ---------------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n, cur) => `${Number(n || 0).toLocaleString()} ${esc(cur || state.settings.currency || "BDT")}`;
const shortId = (id) => String(id || "").slice(-6).toUpperCase();
const dateText = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return String(iso || ""); } };
const nowIso = () => new Date().toISOString();
function randomHex(n) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function toast(msg, type = "") {
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  // একসাথে সর্বোচ্চ ২টা — নাহলে পুরো স্ক্রিন ঢেকে যায়
  while ($toast.children.length >= 2) $toast.firstElementChild.remove();
  $toast.appendChild(el);
  setTimeout(() => el.remove(), 3500);
  if (inTelegram && tg.HapticFeedback) {
    try { tg.HapticFeedback.notificationOccurred(type === "error" ? "error" : "success"); } catch {}
  }
}
function friendlyError(e) {
  const code = e?.code || "";
  if (code.includes("permission-denied")) return "অনুমতি নেই। Firebase Rules ঠিকমতো বসানো হয়েছে কিনা দেখুন।";
  if (code.includes("unavailable")) return "ইন্টারনেট সংযোগ সমস্যা। আবার চেষ্টা করুন।";
  if (code.includes("popup-closed")) return "লগইন উইন্ডো বন্ধ হয়ে গেছে।";
  if (code.includes("unauthorized-domain")) return "এই ডোমেইন Firebase-এ Authorized domains-এ যোগ করুন।";
  return e?.message || "কিছু একটা সমস্যা হয়েছে।";
}
function openModal(html) {
  $modal.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  $modal.querySelector(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) closeModal();
  });
  $modal.querySelectorAll(".close").forEach((b) => { b.onclick = closeModal; });
  if (inTelegram && tg.BackButton) { try { tg.BackButton.show(); } catch {} }
}
function closeModal() {
  $modal.innerHTML = "";
  if (inTelegram && tg.BackButton) { try { tg.BackButton.hide(); } catch {} }
}
if (inTelegram && tg.BackButton) { try { tg.BackButton.onClick(closeModal); } catch {} }

/* ---------------- Firebase ---------------- */
function configReady() {
  const c = window.FIREBASE_CONFIG || {};
  return c.apiKey && !String(c.apiKey).startsWith("PASTE_") && c.projectId && !String(c.projectId).startsWith("PASTE_");
}
function showSetupScreen(msg) {
  $app.innerHTML = `<div class="login-wrap"><div class="login-card">
    <div class="logo-big">⚙️</div><h1>সেটআপ বাকি</h1>
    <p>${esc(msg)}</p>
    <p class="small muted">GitHub-এ <b>firebase-config.js</b> ফাইলটা এডিট করে আপনার Firebase-এর মান বসান।</p>
  </div></div>`;
}

async function initFirebase() {
  const app = initializeApp(window.FIREBASE_CONFIG);
  state.auth = getAuth(app);
  state.db = getFirestore(app);
  try { await setPersistence(state.auth, browserLocalPersistence); } catch {}
  try { await getRedirectResult(state.auth); } catch {}
}

async function ensureUserDoc(fbUser) {
  const ref = doc(state.db, "users", fbUser.uid);
  const snap = await getDoc(ref);
  const tgu = inTelegram ? (tg.initDataUnsafe?.user || null) : null;
  const profile = {
    name: tgu ? [tgu.first_name, tgu.last_name].filter(Boolean).join(" ") : (fbUser.displayName || state.user?.name || "User"),
    username: tgu?.username || "",
    tg_id: tgu ? String(tgu.id) : (state.user?.tg_id || ""),
    photo_url: tgu?.photo_url || fbUser.photoURL || "",
    email: fbUser.email || "",
    provider: fbUser.isAnonymous ? "telegram" : "google",
  };
  if (!snap.exists()) {
    await setDoc(ref, { ...profile, balance: 0, created_at: nowIso() });
  } else {
    await updateDoc(ref, { ...profile, updated_at: nowIso() });
  }
  const fresh = await getDoc(ref);
  state.user = { id: fbUser.uid, ...fresh.data() };
  // Rules-এর মতোই এখানেও email_verified বাধ্যতামূলক
  let admin = !!(fbUser.email && fbUser.emailVerified && OWNER_EMAIL && fbUser.email.toLowerCase() === OWNER_EMAIL);
  if (!admin) {
    try { admin = (await getDoc(doc(state.db, "admins", fbUser.uid))).exists(); } catch {}
  }
  state.isAdmin = admin;
}

async function loadSettings() {
  try {
    const s = await getDoc(doc(state.db, "settings", "main"));
    if (s.exists()) state.settings = { ...state.settings, ...s.data() };
  } catch {}
  document.title = state.settings.store_name || "Bot Script Store";
}
async function loadProducts() {
  const snap = await getDocs(collection(state.db, "products"));
  state.products = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.active !== false)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

/* ---------------- login screen ---------------- */
function renderLogin() {
  const s = state.settings;
  $app.innerHTML = `
    <div class="login-wrap"><div class="login-card">
      <div class="logo-big">🤖</div>
      <h1>${esc(s.store_name || "Bot Script Store")}</h1>
      <p>রেডিমেড Telegram Bot স্ক্রিপ্ট কিনুন।</p>
      <button class="login-btn telegram" id="btn-tg">✈️ Continue with Telegram</button>
      <div class="divider">অথবা</div>
      <button class="login-btn google" id="btn-google">
        <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
        Continue with Google
      </button>
    </div></div>`;

  document.getElementById("btn-tg").onclick = () => {
    const link = state.settings.telegram_app_link;
    if (!link) return toast("অ্যাডমিন এখনো Telegram Mini App লিঙ্ক সেট করেননি।", "error");
    window.location.href = link;
  };
  document.getElementById("btn-google").onclick = doGoogleLogin;
}

/* Google দিয়ে লগইন।
   Telegram-এ ভিতরে থাকলে ইউজার anonymous — তখন Google অ্যাকাউন্টটা
   একই UID-এর সাথে LINK করা হয়, যাতে ব্যালেন্স/অর্ডার হারিয়ে না যায়। */
async function doGoogleLogin() {
  const provider = new GoogleAuthProvider();
  const cur = state.auth.currentUser;
  const linking = !!(cur && cur.isAnonymous);
  try {
    if (linking) await linkWithPopup(cur, provider);
    else await signInWithPopup(state.auth, provider);
    // link করলে UID একই থাকে, তাই নিজে থেকে রিফ্রেশ করতে হয়
    await refreshSession();
    toast("লগইন সফল।", "success");
  } catch (e) {
    const code = String(e?.code || "");
    // এই Google অ্যাকাউন্ট আগে থেকেই আছে → link না করে সরাসরি সাইন-ইন
    if (code.includes("credential-already-in-use") || code.includes("email-already-in-use")) {
      try { await signInWithPopup(state.auth, provider); return; } catch (e3) { toast(friendlyError(e3), "error"); return; }
    }
    if (code.includes("popup") || code.includes("operation-not-supported") || code.includes("web-storage")) {
      try {
        if (linking) await linkWithRedirect(cur, provider);
        else await signInWithRedirect(state.auth, provider);
        return;
      } catch (e2) { toast(friendlyError(e2), "error"); return; }
    }
    toast(friendlyError(e), "error");
  }
}

async function refreshSession() {
  const fbUser = state.auth.currentUser;
  if (!fbUser) return;
  try { await fbUser.getIdToken(true); } catch {}
  state.fbUser = fbUser;
  await ensureUserDoc(fbUser);
  await enterApp();
}

/* ---------------- shell ---------------- */
async function enterApp() {
  await Promise.all([loadSettings(), loadProducts()]);
  renderShell();
}

function renderShell() {
  const u = state.user;
  const avatar = u?.photo_url ? `<img src="${esc(u.photo_url)}" alt="">`
    : `<span class="avatar-fallback">${esc((u?.name || "U")[0])}</span>`;
  const tabs = [["home", "🏠 Home"], ["product", "🛍 Product"], ["deposit", "💰 Deposit"], ["profile", "👤 Profile"]];
  $app.innerHTML = `
    <div class="shell">
      <div class="topbar">
        <div class="brand"><span class="logo">🤖</span> ${esc(state.settings.store_name || "Bot Script Store")}</div>
        <div class="userchip">${avatar}<span>${esc(u?.name || "")}</span>${state.isAdmin ? '<span class="badge admin">Admin</span>' : ""}</div>
      </div>
      <div id="content"></div>
    </div>
    <div class="tabs">
      ${tabs.map(([k, l]) => `<button class="tab ${state.tab === k || (state.tab === "admin" && k === "profile") ? "active" : ""} ${k === "deposit" ? "green" : ""}" data-tab="${k}">${l}</button>`).join("")}
    </div>`;
  $app.querySelectorAll(".tab").forEach((b) => { b.onclick = () => { state.tab = b.dataset.tab; renderShell(); }; });

  const $c = document.getElementById("content");
  if (state.tab === "home") renderHome($c);
  else if (state.tab === "product") renderProductPage($c);
  else if (state.tab === "deposit") renderDeposit($c);
  else if (state.tab === "profile") renderProfile($c);
  else if (state.tab === "admin") renderAdmin($c);
}

function balanceCard() {
  return `<div class="panel balance-card">
    <div class="muted small">বর্তমান ব্যালেন্স</div>
    <div class="balance-amount">${money(state.user?.balance)}</div>
    <div class="row" style="margin-top:10px">
      <button class="btn green sm" data-go="deposit">＋ Deposit</button>
      <button class="btn ghost sm" data-go="product">🛍 Product</button>
    </div></div>`;
}
function bindGo($r) { $r.querySelectorAll("[data-go]").forEach((b) => { b.onclick = () => { state.tab = b.dataset.go; renderShell(); }; }); }
function bindBuy($r) { $r.querySelectorAll("[data-buy]").forEach((b) => { b.onclick = () => openBuyModal(b.dataset.buy); }); }
function productCard(p) {
  return `<div class="card">
    <div class="thumb">${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : "🤖"}</div>
    <div class="body">
      <h3>${esc(p.title)}</h3>
      <div class="desc">${esc(p.description)}</div>
      <div class="row between"><span class="price">${money(p.price, p.currency)}</span></div>
      <button class="btn green block" data-buy="${esc(p.id)}">🛒 কিনুন</button>
    </div></div>`;
}

function renderHome($c) {
  const s = state.settings;
  const latest = state.products.slice(0, 4);
  $c.innerHTML = `
    <div class="hero"><h1>🚀 Telegram Bot Scripts</h1>
      <p>ব্যালেন্স দিয়ে স্ক্রিপ্ট কিনুন, সাথে সাথেই ডাউনলোড।
      ${s.support_url ? ` · <a href="${esc(s.support_url)}" target="_blank">সাপোর্ট</a>` : ""}</p></div>
    ${balanceCard()}
    <div class="section-title"><h2>🆕 প্রোডাক্ট</h2><button class="btn ghost sm" data-go="product">সব দেখুন</button></div>
    ${latest.length ? `<div class="grid">${latest.map(productCard).join("")}</div>` : '<div class="empty">এখনো কোনো প্রোডাক্ট যোগ করা হয়নি।</div>'}`;
  bindGo($c); bindBuy($c);
}
function renderProductPage($c) {
  $c.innerHTML = `<div class="section-title"><h2>🛍 সকল প্রোডাক্ট</h2></div>
    ${state.products.length ? `<div class="grid">${state.products.map(productCard).join("")}</div>` : '<div class="empty">এখনো কোনো প্রোডাক্ট যোগ করা হয়নি।</div>'}`;
  bindBuy($c);
}

/* ---------------- buy ---------------- */
function openBuyModal(pid) {
  const p = state.products.find((x) => x.id === pid);
  if (!p) return;
  const bal = Number(state.user?.balance || 0);
  const enough = bal >= Number(p.price || 0);
  openModal(`
    <button class="close">×</button>
    <h2>🛒 ${esc(p.title)}</h2>
    <p class="muted small">${esc(p.description)}</p>
    <div class="panel row between"><span>দাম</span><b class="price">${money(p.price, p.currency)}</b></div>
    <div class="panel row between"><span>আপনার ব্যালেন্স</span><b>${money(bal)}</b></div>
    ${enough ? `<button class="btn green block" id="confirm-buy">✅ ব্যালেন্স দিয়ে কিনুন</button>`
      : `<div class="empty" style="padding:16px">ব্যালেন্স পর্যাপ্ত নয়। আগে Deposit করুন।</div>
         <button class="btn green block" id="go-deposit">💰 Deposit করুন</button>`}`);
  if (enough) {
    document.getElementById("confirm-buy").onclick = async () => {
      const btn = document.getElementById("confirm-buy");
      btn.disabled = true; btn.textContent = "প্রসেস হচ্ছে…";
      try {
        const license = await purchase(p.id);
        closeModal();
        toast(`কেনাকাটা সফল! License: ${license}`, "success");
        state.tab = "profile"; state.profileTab = "orders";
        renderShell();
      } catch (e) {
        toast(friendlyError(e), "error");
        btn.disabled = false; btn.textContent = "✅ ব্যালেন্স দিয়ে কিনুন";
      }
    };
  } else {
    document.getElementById("go-deposit").onclick = () => { closeModal(); state.tab = "deposit"; renderShell(); };
  }
}

async function purchase(pid) {
  const uid = state.fbUser.uid;
  const license = await runTransaction(state.db, async (tx) => {
    const uRef = doc(state.db, "users", uid);
    const pRef = doc(state.db, "products", pid);
    const oRef = doc(state.db, "orders", `${uid}_${pid}`);
    const [uSnap, pSnap, oSnap] = await Promise.all([tx.get(uRef), tx.get(pRef), tx.get(oRef)]);
    if (!uSnap.exists()) throw new Error("ইউজার ডেটা পাওয়া যায়নি।");
    if (!pSnap.exists() || pSnap.data().active === false) throw new Error("প্রোডাক্ট পাওয়া যায়নি।");
    if (oSnap.exists()) throw new Error("এই প্রোডাক্ট আপনি আগেই কিনেছেন। My Orders দেখুন।");
    const price = Number(pSnap.data().price || 0);
    const bal = Number(uSnap.data().balance || 0);
    if (bal < price) throw new Error("ব্যালেন্স পর্যাপ্ত নয়। আগে Deposit করুন।");
    const lic = "LIC-" + randomHex(6).toUpperCase();
    tx.set(oRef, {
      uid, user_name: state.user?.name || "User", product_id: pid,
      product_title: pSnap.data().title || "", amount: price,
      currency: pSnap.data().currency || state.settings.currency || "BDT",
      status: "approved", license_key: lic, created_at: nowIso(),
    });
    tx.update(uRef, { balance: bal - price, last_order: pid });
    return lic;
  });
  const me = await getDoc(doc(state.db, "users", uid));
  state.user = { id: uid, ...me.data() };
  return license;
}

/* ---------------- deposit ---------------- */
function statusBadge(s) {
  const label = s === "pending" ? "🕘 Pending" : s === "approved" ? "✅ Approved" : "❌ Rejected";
  return `<span class="badge ${esc(s)}">${label}</span>`;
}
function depositItem(d) {
  return `<div class="order-item">
    <div class="row between"><b>${money(d.amount, d.currency)}</b>${statusBadge(d.status)}</div>
    <div class="small muted" style="margin-top:6px">
      ${esc(d.payment_method)} · Trx: <span class="mono">${esc(d.trx_id)}</span><br>
      📅 ${esc(dateText(d.created_at))}${d.admin_note ? `<br>📝 ${esc(d.admin_note)}` : ""}</div></div>`;
}

async function renderDeposit($c) {
  const s = state.settings;
  $c.innerHTML = `
    <div class="section-title"><h2>💰 Deposit</h2></div>
    ${balanceCard()}
    <div class="panel small" style="white-space:pre-wrap">${esc(s.payment_instructions || "অ্যাডমিন এখনো পেমেন্ট নির্দেশনা দেননি।")}</div>
    <div class="panel">
      <label>এমাউন্ট (সর্বনিম্ন ${esc(s.min_deposit || 10)})</label>
      <input id="dep-amount" type="number" min="${esc(s.min_deposit || 10)}" placeholder="যেমন: 500">
      <label>পেমেন্ট মাধ্যম</label>
      <select id="dep-method"><option value="">— নির্বাচন করুন —</option>
        <option>bKash</option><option>Nagad</option><option>Rocket</option><option>Bank</option><option>অন্যান্য</option></select>
      <label>Transaction ID (TrxID)</label>
      <input id="dep-trx" placeholder="যেমন: 9HK2A7XQ1B" autocomplete="off">
      <div style="height:14px"></div>
      <button class="btn green block" id="dep-submit">✅ ডিপোজিট রিকোয়েস্ট জমা দিন</button>
      <p class="small muted" style="margin-top:10px">অ্যাডমিন যাচাই করে approve করলে ব্যালেন্স যোগ হবে।</p>
    </div>
    <div class="section-title"><h2>🧾 ডিপোজিট হিস্ট্রি</h2></div>
    <div id="dep-list"><div class="boot"><div class="spinner"></div></div></div>`;
  bindGo($c);

  document.getElementById("dep-submit").onclick = async () => {
    const amount = Number(document.getElementById("dep-amount").value);
    const payment_method = document.getElementById("dep-method").value;
    const rawTrx = document.getElementById("dep-trx").value.trim();
    const trxKey = rawTrx.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const min = Number(state.settings.min_deposit || 10);
    if (!Number.isFinite(amount) || amount < min) return toast(`সর্বনিম্ন ডিপোজিট ${min}।`, "error");
    if (!payment_method) return toast("পেমেন্ট মাধ্যম নির্বাচন করুন।", "error");
    if (trxKey.length < 4) return toast("সঠিক Transaction ID দিন।", "error");
    const btn = document.getElementById("dep-submit");
    btn.disabled = true; btn.textContent = "জমা হচ্ছে…";
    try {
      await setDoc(doc(state.db, "deposits", trxKey), {
        uid: state.fbUser.uid, user_name: state.user?.name || "User",
        amount, currency: state.settings.currency || "BDT",
        payment_method, trx_id: trxKey, status: "pending", admin_note: "", created_at: nowIso(),
      });
      toast("ডিপোজিট রিকোয়েস্ট জমা হয়েছে।", "success");
      renderDeposit(document.getElementById("content"));
    } catch (e) {
      const msg = String(e?.code || "").includes("permission-denied")
        ? "এই Transaction ID আগেই ব্যবহার হয়েছে।" : friendlyError(e);
      toast(msg, "error");
      btn.disabled = false; btn.textContent = "✅ ডিপোজিট রিকোয়েস্ট জমা দিন";
    }
  };

  try {
    const snap = await getDocs(query(collection(state.db, "deposits"), where("uid", "==", state.fbUser.uid)));
    const rows = snap.docs.map((d) => d.data()).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    document.getElementById("dep-list").innerHTML = rows.length ? rows.map(depositItem).join("") : '<div class="empty">কোনো ডিপোজিট নেই।</div>';
  } catch (e) {
    document.getElementById("dep-list").innerHTML = `<div class="empty">${esc(friendlyError(e))}</div>`;
  }
}

/* ---------------- profile ---------------- */
async function renderProfile($c) {
  const u = state.user;
  $c.innerHTML = `
    <div class="section-title"><h2>👤 Profile</h2></div>
    <div class="panel"><div class="row">
      ${u?.photo_url ? `<img src="${esc(u.photo_url)}" style="width:54px;height:54px;border-radius:50%">`
        : `<span class="avatar-fallback" style="width:54px;height:54px;font-size:22px">${esc((u?.name || "U")[0])}</span>`}
      <div class="grow"><b>${esc(u?.name || "")}</b> ${state.isAdmin ? '<span class="badge admin">Admin</span>' : ""}<br>
        <span class="muted small">${u?.username ? "@" + esc(u.username) : esc(u?.email || "")}</span><br>
        <span class="muted small mono">Telegram ID: ${esc(u?.tg_id || "—")}</span></div>
    </div></div>
    ${balanceCard()}
    <div class="admin-subtabs">
      <button class="admin-subtab ${state.profileTab === "orders" ? "active" : ""}" data-ptab="orders">🧾 My Orders</button>
      <button class="admin-subtab ${state.profileTab === "deposits" ? "active" : ""}" data-ptab="deposits">💰 Deposits</button>
      ${state.isAdmin ? `<button class="admin-subtab" id="open-admin">🛠 Admin Panel</button>`
        : `<button class="admin-subtab" id="admin-login">🔑 Admin Login</button>`}
      ${state.fbUser?.isAnonymous ? `<button class="admin-subtab" id="link-google">🔗 Google যুক্ত করুন</button>`
        : `<button class="admin-subtab" id="logout-btn">⎋ Logout</button>`}
    </div>
    ${state.fbUser?.isAnonymous ? `<div class="panel small muted">⚠️ অ্যাকাউন্টটি এই ডিভাইসের সাথে বাঁধা। ব্যালেন্স ও কেনা স্ক্রিপ্ট সুরক্ষিত রাখতে <b>Google যুক্ত করুন</b> — তাহলে যেকোনো ডিভাইস থেকে একই অ্যাকাউন্ট পাবেন।</div>` : ""}
    <div id="profile-content"><div class="boot"><div class="spinner"></div></div></div>`;
  bindGo($c);
  $c.querySelectorAll("[data-ptab]").forEach((b) => { b.onclick = () => { state.profileTab = b.dataset.ptab; renderProfile($c); }; });
  const $logout = document.getElementById("logout-btn");
  if ($logout) $logout.onclick = async () => { await signOut(state.auth); location.reload(); };
  const $link = document.getElementById("link-google");
  if ($link) $link.onclick = doGoogleLogin;
  if (state.isAdmin) document.getElementById("open-admin").onclick = () => { state.tab = "admin"; renderShell(); };
  else document.getElementById("admin-login").onclick = doGoogleLogin;

  const $pc = document.getElementById("profile-content");
  try {
    if (state.profileTab === "orders") {
      const snap = await getDocs(query(collection(state.db, "orders"), where("uid", "==", state.fbUser.uid)));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      if (!rows.length) { $pc.innerHTML = '<div class="empty">📦 কোনো অর্ডার নেই।</div>'; return; }
      $pc.innerHTML = rows.map((o) => `<div class="order-item">
        <div class="row between"><b>${esc(o.product_title)}</b>${statusBadge(o.status)}</div>
        <div class="small muted" style="margin-top:6px">💰 ${money(o.amount, o.currency)}<br>📅 ${esc(dateText(o.created_at))}
          ${o.admin_note ? `<br>📝 ${esc(o.admin_note)}` : ""}</div>
        ${o.status === "approved" ? `<div class="row" style="margin-top:10px">
          ${o.license_key ? `<span class="small mono badge approved">🔑 ${esc(o.license_key)}</span>` : ""}
          <button class="btn green sm" data-download="${esc(o.product_id)}">⬇️ ডাউনলোড / লিঙ্ক</button></div>` : ""}
      </div>`).join("");
      $pc.querySelectorAll("[data-download]").forEach((b) => { b.onclick = () => downloadProduct(b.dataset.download); });
    } else {
      const snap = await getDocs(query(collection(state.db, "deposits"), where("uid", "==", state.fbUser.uid)));
      const rows = snap.docs.map((d) => d.data()).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      $pc.innerHTML = rows.length ? rows.map(depositItem).join("") : '<div class="empty">কোনো ডিপোজিট নেই।</div>';
    }
  } catch (e) { $pc.innerHTML = `<div class="empty">${esc(friendlyError(e))}</div>`; }
}

async function downloadProduct(pid) {
  try {
    const snap = await getDoc(doc(state.db, "deliveries", pid));
    if (!snap.exists()) return toast("এই প্রোডাক্টের ডেলিভারি এখনো সেট করা হয়নি।", "error");
    const d = snap.data();
    if (d.type === "file" && d.data_b64) {
      const bin = atob(d.data_b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: d.mime || "application/octet-stream" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = d.file_name || "script.zip";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast("ডাউনলোড শুরু হয়েছে।", "success");
    } else if (d.url) {
      if (inTelegram && tg.openLink) tg.openLink(d.url);
      else window.open(d.url, "_blank");
    } else toast("ডেলিভারি লিঙ্ক নেই।", "error");
  } catch (e) { toast(friendlyError(e), "error"); }
}

/* ---------------- admin ---------------- */
async function renderAdmin($c) {
  $c.innerHTML = `
    <div class="section-title"><h2>🛠 Admin Panel</h2><button class="btn ghost sm" id="back-profile">← Profile</button></div>
    <div class="admin-subtabs">
      ${["deposits", "orders", "products", "settings", "users"].map((t) => `
        <button class="admin-subtab ${state.adminTab === t ? "active" : ""}" data-atab="${t}">
          ${{ deposits: "💰 Deposits", orders: "🧾 Orders", products: "📦 Products", settings: "⚙️ Settings", users: "👥 Users" }[t]}
        </button>`).join("")}
    </div>
    <div id="admin-content"><div class="boot"><div class="spinner"></div></div></div>`;
  document.getElementById("back-profile").onclick = () => { state.tab = "profile"; renderShell(); };
  $c.querySelectorAll("[data-atab]").forEach((b) => { b.onclick = () => { state.adminTab = b.dataset.atab; renderAdmin($c); }; });
  const $ac = document.getElementById("admin-content");
  try {
    if (state.adminTab === "deposits") await adminDeposits($ac);
    else if (state.adminTab === "orders") await adminOrders($ac);
    else if (state.adminTab === "products") await adminProducts($ac);
    else if (state.adminTab === "settings") await adminSettings($ac);
    else await adminUsers($ac);
  } catch (e) { $ac.innerHTML = `<div class="empty">${esc(friendlyError(e))}</div>`; }
}

const sortNew = (docs) => docs.map((d) => ({ id: d.id, ...d.data() }))
  .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

async function adminDeposits($ac) {
  const [deps, users, orders] = await Promise.all([
    getDocs(collection(state.db, "deposits")),
    getDocs(collection(state.db, "users")),
    getDocs(collection(state.db, "orders")),
  ]);
  const rows = sortNew(deps.docs);
  const deposited = rows.filter((d) => d.status === "approved").reduce((a, d) => a + Number(d.amount || 0), 0);
  const revenue = orders.docs.map((d) => d.data()).filter((o) => o.status === "approved").reduce((a, o) => a + Number(o.amount || 0), 0);
  $ac.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="n">${users.size}</div><div class="l">ইউজার</div></div>
      <div class="stat"><div class="n">${rows.filter((d) => d.status === "pending").length}</div><div class="l">Pending</div></div>
      <div class="stat"><div class="n">${deposited.toLocaleString()}</div><div class="l">মোট ডিপোজিট</div></div>
      <div class="stat"><div class="n">${revenue.toLocaleString()}</div><div class="l">মোট বিক্রি</div></div>
    </div>
    <div class="scroll-x"><table class="table">
      <thead><tr><th>ইউজার</th><th>এমাউন্ট</th><th>পেমেন্ট</th><th>স্ট্যাটাস</th><th>অ্যাকশন</th></tr></thead>
      <tbody>${rows.map((d) => `<tr>
        <td>${esc(d.user_name || d.uid)}</td>
        <td>${money(d.amount, d.currency)}</td>
        <td>${esc(d.payment_method)}<br><span class="mono small">${esc(d.trx_id)}</span></td>
        <td>${statusBadge(d.status)}</td>
        <td>${d.status === "pending" ? `
          <button class="btn green sm" data-dep-approve="${esc(d.id)}">Approve</button>
          <button class="btn red sm" data-dep-reject="${esc(d.id)}">Reject</button>` : "—"}</td>
      </tr>`).join("")}</tbody></table></div>`;
  $ac.querySelectorAll("[data-dep-approve]").forEach((b) => { b.onclick = () => setDepositStatus(b.dataset.depApprove, "approved"); });
  $ac.querySelectorAll("[data-dep-reject]").forEach((b) => {
    b.onclick = () => setDepositStatus(b.dataset.depReject, "rejected", prompt("Reject কারণ (ঐচ্ছিক):") || "");
  });
}

async function setDepositStatus(id, status, admin_note = "") {
  try {
    await runTransaction(state.db, async (tx) => {
      const dRef = doc(state.db, "deposits", id);
      const dSnap = await tx.get(dRef);
      if (!dSnap.exists()) throw new Error("ডিপোজিট পাওয়া যায়নি।");
      const d = dSnap.data();
      if (d.status !== "pending") throw new Error("এই ডিপোজিট আগেই processed হয়েছে।");
      const uRef = doc(state.db, "users", d.uid);
      if (status === "approved") {
        const uSnap = await tx.get(uRef);
        if (!uSnap.exists()) throw new Error("ইউজার পাওয়া যায়নি।");
        tx.update(uRef, { balance: Number(uSnap.data().balance || 0) + Number(d.amount || 0) });
      }
      tx.update(dRef, { status, admin_note });
    });
    toast(`ডিপোজিট ${status}।`, "success");
    renderAdmin(document.getElementById("content"));
  } catch (e) { toast(friendlyError(e), "error"); }
}

async function adminOrders($ac) {
  const rows = sortNew((await getDocs(collection(state.db, "orders"))).docs);
  $ac.innerHTML = `<div class="scroll-x"><table class="table">
    <thead><tr><th>ইউজার</th><th>প্রোডাক্ট</th><th>দাম</th><th>স্ট্যাটাস</th><th>অ্যাকশন</th></tr></thead>
    <tbody>${rows.map((o) => `<tr>
      <td>${esc(o.user_name || o.uid)}</td>
      <td>${esc(o.product_title)}<br><span class="mono small">${esc(o.license_key || "")}</span></td>
      <td>${money(o.amount, o.currency)}</td>
      <td>${statusBadge(o.status)}</td>
      <td>${o.status === "approved" ? `<button class="btn red sm" data-reject="${esc(o.id)}">Reject + Refund</button>`
        : `<button class="btn green sm" data-approve="${esc(o.id)}">Re-approve</button>`}</td>
    </tr>`).join("")}</tbody></table></div>`;
  $ac.querySelectorAll("[data-approve]").forEach((b) => { b.onclick = () => setOrderStatus(b.dataset.approve, "approved"); });
  $ac.querySelectorAll("[data-reject]").forEach((b) => {
    b.onclick = () => setOrderStatus(b.dataset.reject, "rejected", prompt("Reject কারণ (ঐচ্ছিক):") || "");
  });
}

async function setOrderStatus(id, status, admin_note = "") {
  try {
    await runTransaction(state.db, async (tx) => {
      const oRef = doc(state.db, "orders", id);
      const oSnap = await tx.get(oRef);
      if (!oSnap.exists()) throw new Error("অর্ডার পাওয়া যায়নি।");
      const o = oSnap.data();
      if (o.status === status) throw new Error("অর্ডার আগে থেকেই এই অবস্থায় আছে।");
      const uRef = doc(state.db, "users", o.uid);
      const uSnap = await tx.get(uRef);
      if (!uSnap.exists()) throw new Error("ইউজার পাওয়া যায়নি।");
      const bal = Number(uSnap.data().balance || 0);
      const amt = Number(o.amount || 0);
      if (status === "rejected") tx.update(uRef, { balance: bal + amt });
      else {
        if (bal < amt) throw new Error("ইউজারের ব্যালেন্স নেই, re-approve করা যাচ্ছে না।");
        tx.update(uRef, { balance: bal - amt });
      }
      tx.update(oRef, { status, admin_note });
    });
    toast(`অর্ডার ${status}।`, "success");
    renderAdmin(document.getElementById("content"));
  } catch (e) { toast(friendlyError(e), "error"); }
}

async function adminProducts($ac) {
  const rows = sortNew((await getDocs(collection(state.db, "products"))).docs);
  $ac.innerHTML = `
    <button class="btn green" id="add-product">＋ নতুন প্রোডাক্ট</button><div style="height:12px"></div>
    <div class="scroll-x"><table class="table">
      <thead><tr><th>নাম</th><th>দাম</th><th>ডেলিভারি</th><th>স্ট্যাটাস</th><th>অ্যাকশন</th></tr></thead>
      <tbody>${rows.map((p) => `<tr>
        <td>${esc(p.title)}</td><td>${money(p.price, p.currency)}</td>
        <td class="small">${p.delivery_type === "file" ? "📁 " + esc(p.file_name || "file") : "🔗 URL"}</td>
        <td><span class="badge ${p.active !== false ? "approved" : "rejected"}">${p.active !== false ? "active" : "hidden"}</span></td>
        <td><button class="btn ghost sm" data-edit="${esc(p.id)}">Edit</button>
            <button class="btn red sm" data-del="${esc(p.id)}">Hide</button></td>
      </tr>`).join("")}</tbody></table></div>`;
  document.getElementById("add-product").onclick = () => productForm();
  $ac.querySelectorAll("[data-edit]").forEach((b) => { b.onclick = () => productForm(rows.find((p) => p.id === b.dataset.edit)); });
  $ac.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("প্রোডাক্ট hide করবেন?")) return;
      try {
        await updateDoc(doc(state.db, "products", b.dataset.del), { active: false });
        toast("Hidden।", "success");
        await loadProducts();
        renderAdmin(document.getElementById("content"));
      } catch (e) { toast(friendlyError(e), "error"); }
    };
  });
}

function productForm(p = null) {
  openModal(`
    <button class="close">×</button>
    <h2>${p ? "✏️ প্রোডাক্ট এডিট" : "＋ নতুন প্রোডাক্ট"}</h2>
    <label>নাম</label><input id="pf-title" value="${esc(p?.title || "")}">
    <label>বিবরণ</label><textarea id="pf-desc">${esc(p?.description || "")}</textarea>
    <div class="row">
      <div class="grow"><label>দাম</label><input id="pf-price" type="number" value="${p?.price ?? 0}"></div>
      <div class="grow"><label>মুদ্রা</label><input id="pf-currency" value="${esc(p?.currency || state.settings.currency || "BDT")}"></div>
    </div>
    <label>ছবির URL (ঐচ্ছিক)</label><input id="pf-image" value="${esc(p?.image_url || "")}">
    <label>ডেলিভারি টাইপ</label>
    <select id="pf-dtype">
      <option value="url" ${p?.delivery_type !== "file" ? "selected" : ""}>🔗 লিঙ্ক (Google Drive / ডাউনলোড URL)</option>
      <option value="file" ${p?.delivery_type === "file" ? "selected" : ""}>📁 ফাইল আপলোড (সর্বোচ্চ ৬০০ KB)</option>
    </select>
    <div id="pf-url-wrap"><label>ডেলিভারি লিঙ্ক</label><input id="pf-durl" value="${esc(p?.delivery_url || "")}"></div>
    <div id="pf-file-wrap" style="display:none">
      <label>স্ক্রিপ্ট ফাইল (.py / .zip)</label><input id="pf-file" type="file">
      <p class="small muted">${p?.file_name ? "বর্তমান: " + esc(p.file_name) : "বড় ফাইল হলে লিঙ্ক অপশন ব্যবহার করুন।"}</p>
    </div>
    <label><input type="checkbox" id="pf-active" style="width:auto" ${p?.active !== false ? "checked" : ""}> Active</label>
    <div style="height:14px"></div>
    <button class="btn green block" id="pf-save">💾 সেভ করুন</button>`);
  const dtype = document.getElementById("pf-dtype");
  const toggle = () => {
    document.getElementById("pf-url-wrap").style.display = dtype.value === "url" ? "" : "none";
    document.getElementById("pf-file-wrap").style.display = dtype.value === "file" ? "" : "none";
  };
  dtype.onchange = toggle; toggle();

  document.getElementById("pf-save").onclick = async () => {
    const btn = document.getElementById("pf-save");
    try {
      const title = document.getElementById("pf-title").value.trim();
      if (!title) return toast("নাম দিন।", "error");
      btn.disabled = true; btn.textContent = "সেভ হচ্ছে…";
      const pid = p?.id || doc(collection(state.db, "products")).id;
      const delivery = { type: dtype.value, url: "", file_name: p?.file_name || "", mime: "", data_b64: "" };
      if (dtype.value === "url") {
        delivery.url = document.getElementById("pf-durl").value.trim();
      } else {
        const f = document.getElementById("pf-file").files[0];
        if (f) {
          if (f.size > 600 * 1024) throw new Error("ফাইল অনেক বড়। সর্বোচ্চ ৬০০ KB। বড় হলে লিঙ্ক ব্যবহার করুন।");
          delivery.data_b64 = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(String(r.result).split(",")[1]);
            r.onerror = () => rej(new Error("ফাইল পড়া যায়নি।"));
            r.readAsDataURL(f);
          });
          delivery.file_name = f.name;
          delivery.mime = f.type || "application/octet-stream";
        } else if (p?.delivery_type === "file" && p?.has_file) {
          const old = await getDoc(doc(state.db, "deliveries", pid));
          if (old.exists()) Object.assign(delivery, old.data());
        } else throw new Error("ফাইল নির্বাচন করুন।");
      }
      await setDoc(doc(state.db, "products", pid), {
        title, description: document.getElementById("pf-desc").value.trim(),
        price: Number(document.getElementById("pf-price").value) || 0,
        currency: document.getElementById("pf-currency").value.trim() || "BDT",
        image_url: document.getElementById("pf-image").value.trim(),
        delivery_type: dtype.value, delivery_url: delivery.url,
        file_name: delivery.file_name, has_file: !!delivery.data_b64,
        active: document.getElementById("pf-active").checked,
        created_at: p?.created_at || nowIso(),
      });
      await setDoc(doc(state.db, "deliveries", pid), delivery);
      closeModal();
      toast("সেভ হয়েছে।", "success");
      await loadProducts();
      renderAdmin(document.getElementById("content"));
    } catch (e) {
      toast(friendlyError(e), "error");
      btn.disabled = false; btn.textContent = "💾 সেভ করুন";
    }
  };
}

async function adminSettings($ac) {
  const s = state.settings;
  $ac.innerHTML = `
    <div class="panel">
      <label>স্টোরের নাম</label><input id="set-name" value="${esc(s.store_name || "")}">
      <label>Telegram Mini App লিঙ্ক</label>
      <input id="set-tglink" placeholder="https://t.me/YourBot/appname" value="${esc(s.telegram_app_link || "")}">
      <label>সাপোর্ট লিঙ্ক</label><input id="set-support" placeholder="https://t.me/your_support" value="${esc(s.support_url || "")}">
      <div class="row">
        <div class="grow"><label>মুদ্রা</label><input id="set-currency" value="${esc(s.currency || "BDT")}"></div>
        <div class="grow"><label>সর্বনিম্ন ডিপোজিট</label><input id="set-mindep" type="number" value="${esc(s.min_deposit || 10)}"></div>
      </div>
      <label>ডিপোজিট নির্দেশনা (নম্বর + নিয়ম)</label>
      <textarea id="set-payment" style="min-height:140px">${esc(s.payment_instructions || "")}</textarea>
      <div style="height:14px"></div>
      <button class="btn green block" id="set-save">💾 সেভ করুন</button>
    </div>
    <div class="panel small muted">আপনার Admin UID: <span class="mono">${esc(state.fbUser.uid)}</span></div>`;
  document.getElementById("set-save").onclick = async () => {
    try {
      const data = {
        store_name: document.getElementById("set-name").value.trim(),
        telegram_app_link: document.getElementById("set-tglink").value.trim(),
        support_url: document.getElementById("set-support").value.trim(),
        currency: document.getElementById("set-currency").value.trim(),
        min_deposit: Number(document.getElementById("set-mindep").value) || 10,
        payment_instructions: document.getElementById("set-payment").value,
      };
      await setDoc(doc(state.db, "settings", "main"), data, { merge: true });
      state.settings = { ...state.settings, ...data };
      toast("সেটিংস সেভ হয়েছে।", "success");
    } catch (e) { toast(friendlyError(e), "error"); }
  };
}

async function adminUsers($ac) {
  const rows = sortNew((await getDocs(collection(state.db, "users"))).docs);
  $ac.innerHTML = `<div class="scroll-x"><table class="table">
    <thead><tr><th>নাম</th><th>Telegram / Email</th><th>ব্যালেন্স</th><th>অ্যাকশন</th></tr></thead>
    <tbody>${rows.map((u) => `<tr>
      <td>${esc(u.name)}</td>
      <td class="small">${u.tg_id ? `<span class="mono">${esc(u.tg_id)}</span>${u.username ? " @" + esc(u.username) : ""}` : esc(u.email || "—")}</td>
      <td>${money(u.balance)}</td>
      <td><button class="btn ghost sm" data-addbal="${esc(u.id)}">＋ ব্যালেন্স</button></td>
    </tr>`).join("")}</tbody></table></div>`;
  $ac.querySelectorAll("[data-addbal]").forEach((b) => {
    b.onclick = async () => {
      const v = Number(prompt("কত টাকা যোগ করবেন? (বাদ দিতে ঋণাত্মক সংখ্যা)") || "0");
      if (!v) return;
      try {
        await runTransaction(state.db, async (tx) => {
          const ref = doc(state.db, "users", b.dataset.addbal);
          const snap = await tx.get(ref);
          if (!snap.exists()) throw new Error("ইউজার নেই।");
          tx.update(ref, { balance: Number(snap.data().balance || 0) + v });
        });
        toast("ব্যালেন্স আপডেট হয়েছে।", "success");
        renderAdmin(document.getElementById("content"));
      } catch (e) { toast(friendlyError(e), "error"); }
    };
  });
}

/* ---------------- boot ---------------- */
async function boot() {
  if (inTelegram) {
    try {
      tg.ready(); tg.expand();
      if (tg.setHeaderColor) tg.setHeaderColor("#0f1420");
      if (tg.setBackgroundColor) tg.setBackgroundColor("#0f1420");
    } catch {}
  }
  if (!configReady()) {
    showSetupScreen("Firebase কনফিগ বসানো হয়নি।");
    return;
  }
  try {
    await initFirebase();
  } catch (e) {
    showSetupScreen(friendlyError(e));
    return;
  }

  await loadSettings();

  onAuthStateChanged(state.auth, async (fbUser) => {
    if (!fbUser) {
      state.fbUser = null; state.user = null; state.isAdmin = false;
      if (inTelegram) {
        try { await signInAnonymously(state.auth); } catch (e) { showSetupScreen(friendlyError(e)); }
      } else {
        renderLogin();
      }
      return;
    }
    state.fbUser = fbUser;
    try {
      await ensureUserDoc(fbUser);
      await enterApp();
    } catch (e) {
      $app.innerHTML = `<div class="login-wrap"><div class="login-card">
        <div class="logo-big">⚠️</div><h1>সমস্যা</h1><p>${esc(friendlyError(e))}</p>
        <p class="small muted">Firestore Rules publish করেছেন কিনা দেখুন।</p></div></div>`;
    }
  });
}

boot();
