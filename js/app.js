let CFG = {};
let ME = null;
let PRODUCTS = [];
let CURRENT = null;

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 3200);
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    credentials: "same-origin",
    ...opts,
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Ошибка сервера" }));
  if (!res.ok && !data.error) data.error = "Ошибка " + res.status;
  return data;
}

function showPage(name) {
  document.querySelectorAll("main > section").forEach((s) => s.classList.add("hidden"));
  const page = document.getElementById("page-" + name);
  if (page) page.classList.remove("hidden");
  if (name === "login") renderLogin();
  if (name === "orders") renderOrders();
  if (name === "refs") renderRefs();
  if (name === "admin") renderAdmin();
}

window.onTelegramAuth = async function (user) {
  const data = await api("/api/auth/telegram", { method: "POST", body: JSON.stringify(user) });
  if (!data.ok) {
    toast(data.error || "Не удалось войти");
    return;
  }
  ME = data.user;
  paintUser();
  showPage("catalog");
  toast("Вход выполнен");
  syncFirebaseUser(ME);
};

function renderLogin() {
  const box = document.getElementById("tg-widget");
  box.innerHTML = "";
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://telegram.org/js/telegram-widget.js?22";
  s.setAttribute("data-telegram-login", CFG.bot_username || "nexvenstudiobot");
  s.setAttribute("data-size", "large");
  s.setAttribute("data-radius", "12");
  s.setAttribute("data-onauth", "onTelegramAuth(user)");
  s.setAttribute("data-request-access", "write");
  box.appendChild(s);
}

function paintUser() {
  const box = document.getElementById("userbox");
  const adminBtn = document.getElementById("adminBtn");
  if (!ME) {
    box.innerHTML = `<button class="btn btn-main" onclick="showPage('login')">Войти через Telegram</button>`;
    adminBtn.classList.add("hidden");
    return;
  }
  const photo = ME.photo_url
    ? `<img src="${ME.photo_url}" alt="">`
    : "";
  box.innerHTML = `
    ${photo}
    <span>@${ME.username || ME.user_id}<br><b>${Math.round(ME.balance)} ₽</b></span>
    <button class="ghost" onclick="logout()">Выйти</button>`;
  if (ME.is_admin) adminBtn.classList.remove("hidden");
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  ME = null;
  paintUser();
  showPage("home");
}

function cardHtml(p) {
  const img = p.image_url
    ? `<img src="${p.image_url}" alt="${p.name}">`
    : `<div class="ph steel">${(p.name || "").slice(0, 18)}</div>`;
  return `
    <article class="card">
      <div class="pic">${img}</div>
      <div class="body">
        <h3>${escapeHtml(p.name)}</h3>
        <div class="price">${Number(p.price).toFixed(0)} ₽</div>
        <div class="muted">${escapeHtml(p.description || "")}</div>
        <button class="btn btn-main" onclick="openOrder('${p.id}')">Заказать</button>
      </div>
    </article>`;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderGrids() {
  const cat = PRODUCTS.filter((p) => p.category === "catalog");
  const proj = PRODUCTS.filter((p) => p.category === "project");
  const mods = PRODUCTS.filter((p) => p.category === "mod");
  document.getElementById("grid-catalog").innerHTML = cat.map(cardHtml).join("");
  document.getElementById("grid-projects").innerHTML = proj.map(cardHtml).join("");
  document.getElementById("grid-mods").innerHTML = mods.map(cardHtml).join("");
}

function openOrder(id) {
  if (!ME) {
    showPage("login");
    toast("Сначала войдите через Telegram");
    return;
  }
  CURRENT = PRODUCTS.find((p) => p.id === id);
  if (!CURRENT) return;
  document.getElementById("mTitle").textContent = CURRENT.name;
  document.getElementById("mDesc").textContent = CURRENT.description || "";
  document.getElementById("mPrice").textContent = Number(CURRENT.price).toFixed(0) + " ₽";
  document.getElementById("mText").value = "";
  document.getElementById("orderModal").classList.add("show");
}
function closeModal() {
  document.getElementById("orderModal").classList.remove("show");
}

async function submitOrder() {
  if (!CURRENT) return;
  const description = document.getElementById("mText").value.trim();
  const data = await api("/api/orders", {
    method: "POST",
    body: JSON.stringify({ product_id: CURRENT.id, description }),
  });
  if (!data.ok) {
    toast(data.error || "Не вышло оформить");
    return;
  }
  ME.balance = data.balance;
  paintUser();
  closeModal();
  toast("Заказ #" + data.order_id + " создан");
  showPage("orders");
}

async function renderOrders() {
  const box = document.getElementById("ordersPanel");
  if (!ME) {
    box.textContent = "Войдите через Telegram.";
    return;
  }
  const data = await api("/api/orders");
  const rows = (data.orders || []).map((o) => {
    const st = { pending: "ожидает", accepted: "в работе", completed: "готов" }[o.status] || o.status;
    return `<tr><td>#${o.id}</td><td>${escapeHtml(o.product_name)}</td><td>${Number(o.price).toFixed(0)} ₽</td><td><span class="badge">${st}</span></td></tr>`;
  }).join("");
  box.innerHTML = `
    <p>Баланс: <b>${Math.round(ME.balance)} ₽</b></p>
    <p class="muted" style="margin:8px 0 14px">Пополнение — через бота @${CFG.bot_username} звёздами Telegram.</p>
    <table class="table">
      <tr><th>ID</th><th>Товар</th><th>Цена</th><th>Статус</th></tr>
      ${rows || "<tr><td colspan=4>Заказов пока нет</td></tr>"}
    </table>`;
}

function renderRefs() {
  const box = document.getElementById("refsPanel");
  if (!ME) {
    box.textContent = "Войдите через Telegram.";
    return;
  }
  box.innerHTML = `
    <p>За каждого, кто откроет бота по вашей ссылке и нажмёт Start — <b>1 ₽</b>.</p>
    <p style="margin:12px 0">Приглашено: <b>${ME.referrals}</b> · Заработано: <b>${ME.referral_earned} ₽</b></p>
    <label>Ссылка</label>
    <input readonly value="${ME.ref_link}">
    <p class="hint" style="margin-top:10px">Отзывы после заказа: ${CFG.review_link || ""}</p>`;
}

async function renderAdmin() {
  const box = document.getElementById("adminPanel");
  if (!ME || !ME.is_admin) {
    box.textContent = "Нет доступа";
    return;
  }
  const pending = await api("/api/admin/orders");
  const pRows = (pending.orders || []).map((o) => `
    <tr>
      <td>#${o.id}</td><td>${escapeHtml(o.product_name)}</td>
      <td>${escapeHtml(o.description || "")}</td>
      <td><button class="btn" onclick="acceptOrder(${o.id})">Принять</button></td>
    </tr>`).join("");
  const prodRows = PRODUCTS.map((p) => `
    <div class="panel" style="margin:10px 0;padding:14px">
      <b>${escapeHtml(p.name)}</b> — ${Number(p.price).toFixed(0)} ₽
      <div class="row">
        <input type="text" id="n-${p.id}" value="${escapeHtml(p.name)}" style="flex:1">
        <input type="number" id="pr-${p.id}" value="${p.price}" style="width:110px">
      </div>
      <textarea id="d-${p.id}">${escapeHtml(p.description || "")}</textarea>
      <div class="row">
        <button class="btn" onclick="saveProduct('${p.id}')">Сохранить</button>
        <label class="btn">Фото
          <input type="file" accept="image/*" hidden onchange="uploadImg('${p.id}', this)">
        </label>
      </div>
    </div>`).join("");
  box.innerHTML = `
    <h3>Новые заказы</h3>
    <table class="table">${pRows || "<tr><td>Пусто</td></tr>"}</table>
    <h3 style="margin-top:22px">Товары и фото</h3>
    ${prodRows}
    <h3 style="margin-top:22px">Выдать баланс</h3>
    <div class="row">
      <input id="giveId" placeholder="Telegram ID">
      <input id="giveAmt" placeholder="Сумма ₽" type="number">
      <button class="btn btn-main" onclick="giveBal()">Начислить</button>
    </div>`;
}

async function saveProduct(id) {
  const data = await api("/api/products", {
    method: "POST",
    body: JSON.stringify({
      id,
      name: document.getElementById("n-" + id).value,
      price: document.getElementById("pr-" + id).value,
      description: document.getElementById("d-" + id).value,
    }),
  });
  toast(data.ok ? "Сохранено" : (data.error || "Ошибка"));
  await loadProducts();
}

async function uploadImg(id, input) {
  const file = input.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/products/" + id + "/image", { method: "POST", body: fd, credentials: "same-origin" });
  const data = await res.json();
  toast(data.ok ? "Фото прикреплено" : (data.error || "Ошибка"));
  await loadProducts();
  renderAdmin();
}

async function acceptOrder(id) {
  const data = await api("/api/admin/orders/" + id + "/accept", { method: "POST" });
  toast(data.message || (data.ok ? "Принят" : "Ошибка"));
  renderAdmin();
}

async function giveBal() {
  const data = await api("/api/admin/give", {
    method: "POST",
    body: JSON.stringify({
      user_id: document.getElementById("giveId").value,
      amount: document.getElementById("giveAmt").value,
    }),
  });
  toast(data.ok ? "Начислено" : (data.error || "Ошибка"));
}

async function loadProducts() {
  const data = await api("/api/products");
  PRODUCTS = data.products || [];
  renderGrids();
  syncFirebaseProducts(PRODUCTS);
}

function initFirebase(cfg) {
  try {
    if (!cfg || !window.firebase) return;
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    if (firebase.analytics) firebase.analytics();
  } catch (e) {
    console.warn("Firebase:", e);
  }
}

function syncFirebaseProducts(list) {
  try {
    if (!window.firebase || !firebase.apps.length) return;
    const db = firebase.firestore();
    list.forEach((p) => {
      db.collection("products").doc(p.id).set({
        name: p.name, price: p.price, description: p.description || "",
        category: p.category, image_url: p.image_url || null, updated: Date.now(),
      }, { merge: true });
    });
  } catch (e) {}
}

function syncFirebaseUser(u) {
  try {
    if (!window.firebase || !firebase.apps.length || !u) return;
    firebase.firestore().collection("users").doc(String(u.user_id)).set({
      username: u.username || null,
      full_name: u.full_name || null,
      balance: u.balance,
      updated: Date.now(),
    }, { merge: true });
  } catch (e) {}
}

async function boot() {
  CFG = (await api("/api/config")).ok ? await (await fetch("/api/config")).json() : {};
  initFirebase(CFG.firebase);
  const me = await api("/api/me");
  ME = me.user;
  paintUser();
  await loadProducts();
}

boot();
