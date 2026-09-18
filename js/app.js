let CFG = {};
let ME = null;
let PRODUCTS = [];
let CURRENT = null;
let CURRENCY = localStorage.getItem("nexven_currency") || "RUB";
let SELECTED_METHOD = "stars";

const RATES = { RUB: 1, UAH: 0.54, KZT: 5.5, BYN: 0.036 };
const SYMBOLS = { RUB: "₽", UAH: "₴", KZT: "₸", BYN: "Br" };
const TOPUP_PRESETS = [25, 50, 100, 200, 500, 1000];

function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 3500);
}

async function api(url, opts = {}) {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      credentials: "same-origin",
      ...opts,
    });
    const data = await res.json().catch(() => ({ ok: false, error: "Ошибка сервера" }));
    if (!res.ok && !data.error) data.error = "Ошибка " + res.status;
    return data;
  } catch (e) {
    return { ok: false, error: "Нет связи с сервером. Запустите site_app.py" };
  }
}

function formatMoney(rub) {
  const rate = RATES[CURRENCY] || 1;
  const val = Number(rub || 0) * rate;
  const sym = SYMBOLS[CURRENCY] || "₽";
  if (CURRENCY === "BYN") return val.toFixed(2) + " " + sym;
  return Math.round(val) + " " + sym;
}

function showPage(name) {
  document.querySelectorAll("main > section").forEach((s) => s.classList.add("hidden"));
  const page = document.getElementById("page-" + name);
  if (page) page.classList.remove("hidden");
  if (name === "login") renderLogin();
  if (name === "orders") renderOrders();
  if (name === "refs") renderRefs();
  if (name === "admin") renderAdmin();
  if (name === "topup") renderTopup();
}

window.onTelegramAuth = async function (user) {
  const data = await api("/api/auth/telegram", { method: "POST", body: JSON.stringify(user) });
  if (!data.ok) {
    toast(data.error || "Не удалось войти");
    return;
  }
  ME = data.user;
  if (ME.currency) {
    CURRENCY = ME.currency;
    localStorage.setItem("nexven_currency", CURRENCY);
  }
  paintUser();
  showPage("catalog");
  toast("Вход выполнен");
  syncFirebaseUser(ME);
};

function renderLogin() {
  const box = document.getElementById("tg-widget");
  if (!box) return;
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
  const balEl = document.getElementById("balanceValue");
  const curSel = document.getElementById("currencySelect");
  if (curSel) curSel.value = CURRENCY;

  if (!ME) {
    if (box) box.innerHTML = `<button type="button" class="btn btn-main" data-page="login">Войти через Telegram</button>`;
    if (adminBtn) adminBtn.classList.add("hidden");
    if (balEl) balEl.textContent = "— " + (SYMBOLS[CURRENCY] || "₽");
    return;
  }
  const photo = ME.photo_url ? `<img src="${ME.photo_url}" alt="">` : "";
  if (box) {
    box.innerHTML = `
      ${photo}
      <span>@${ME.username || ME.user_id}<br><b>${formatMoney(ME.balance)}</b></span>
      <button type="button" class="ghost" id="btnLogout">Выйти</button>`;
    const lo = document.getElementById("btnLogout");
    if (lo) lo.addEventListener("click", logout);
  }
  if (adminBtn) {
    if (ME.is_admin) adminBtn.classList.remove("hidden");
    else adminBtn.classList.add("hidden");
  }
  if (balEl) balEl.textContent = formatMoney(ME.balance);
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  ME = null;
  paintUser();
  showPage("home");
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function cardHtml(p) {
  const img = p.image_url
    ? `<img src="${p.image_url}" alt="${escapeHtml(p.name)}">`
    : `<div class="ph steel">${escapeHtml((p.name || "").slice(0, 18))}</div>`;
  return `
    <article class="card">
      <div class="pic">${img}</div>
      <div class="body">
        <h3>${escapeHtml(p.name)}</h3>
        <div class="price">${formatMoney(p.price)}</div>
        <div class="muted">${escapeHtml(p.description || "")}</div>
        <button type="button" class="btn btn-main" data-order="${escapeHtml(p.id)}">Заказать</button>
      </div>
    </article>`;
}

function renderGrids() {
  const cat = PRODUCTS.filter((p) => p.category === "catalog");
  const proj = PRODUCTS.filter((p) => p.category === "project");
  const mods = PRODUCTS.filter((p) => p.category === "mod");
  const gc = document.getElementById("grid-catalog");
  const gp = document.getElementById("grid-projects");
  const gm = document.getElementById("grid-mods");
  if (gc) gc.innerHTML = cat.map(cardHtml).join("") || `<p class="muted">Нет товаров</p>`;
  if (gp) gp.innerHTML = proj.map(cardHtml).join("") || `<p class="muted">Нет проектов</p>`;
  if (gm) gm.innerHTML = mods.map(cardHtml).join("") || `<p class="muted">Нет модов</p>`;
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
  document.getElementById("mPrice").textContent = formatMoney(CURRENT.price);
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
  if (!box) return;
  if (!ME) {
    box.textContent = "Войдите через Telegram.";
    return;
  }
  const data = await api("/api/orders");
  const rows = (data.orders || []).map((o) => {
    const st = { pending: "ожидает", accepted: "в работе", completed: "готов" }[o.status] || o.status;
    return `<tr><td>#${o.id}</td><td>${escapeHtml(o.product_name)}</td><td>${formatMoney(o.price)}</td><td><span class="badge">${st}</span></td></tr>`;
  }).join("");
  box.innerHTML = `
    <p>Баланс: <b>${formatMoney(ME.balance)}</b></p>
    <p class="muted" style="margin:8px 0 14px">
      <button type="button" class="btn btn-main" data-page="topup">Пополнить баланс</button>
    </p>
    <table class="table">
      <tr><th>ID</th><th>Товар</th><th>Цена</th><th>Статус</th></tr>
      ${rows || "<tr><td colspan=4>Заказов пока нет</td></tr>"}
    </table>`;
}

function renderRefs() {
  const box = document.getElementById("refsPanel");
  if (!box) return;
  if (!ME) {
    box.textContent = "Войдите через Telegram.";
    return;
  }
  box.innerHTML = `
    <p>За каждого, кто откроет бота по вашей ссылке и нажмёт Start — <b>1 ₽</b>.</p>
    <p style="margin:12px 0">Приглашено: <b>${ME.referrals}</b> · Заработано: <b>${formatMoney(ME.referral_earned)}</b></p>
    <label>Ссылка</label>
    <input readonly value="${ME.ref_link || ""}">
    <p class="hint" style="margin-top:10px">Отзывы: ${CFG.review_link || ""}</p>`;
}

function renderTopup() {
  const presets = document.getElementById("amountPresets");
  if (presets) {
    presets.innerHTML = TOPUP_PRESETS.map((a) =>
      `<button type="button" class="ghost amt-btn" data-amt="${a}">${formatMoney(a)}</button>`
    ).join("");
  }
  document.querySelectorAll(".pay-card").forEach((el) => {
    el.classList.toggle("active", el.dataset.method === SELECTED_METHOD);
  });
  loadMyTopups();
  if (!ME) {
    const res = document.getElementById("topupResult");
    if (res) {
      res.classList.remove("hidden");
      res.innerHTML = `<p class="muted">Войдите через Telegram, чтобы пополнить баланс.</p>
        <button type="button" class="btn btn-main" data-page="login">Войти</button>`;
    }
  }
}

async function loadMyTopups() {
  const box = document.getElementById("myTopups");
  if (!box || !ME) return;
  const data = await api("/api/topups");
  const rows = (data.topups || []).map((t) => {
    const st = { pending: "ожидает", approved: "зачислено", rejected: "отклонено" }[t.status] || t.status;
    const methods = { sbp: "СБП", google_pay: "Google Pay", apple_pay: "Apple Pay", stars: "Stars" };
    return `<tr><td>#${t.id}</td><td>${formatMoney(t.amount_rub)}</td><td>${methods[t.method] || t.method}</td><td><span class="badge">${st}</span></td></tr>`;
  }).join("");
  if (!rows) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = `
    <h3 style="margin-bottom:10px">Мои заявки</h3>
    <table class="table">
      <tr><th>ID</th><th>Сумма</th><th>Метод</th><th>Статус</th></tr>
      ${rows}
    </table>`;
}

async function doTopup() {
  if (!ME) {
    showPage("login");
    toast("Сначала войдите");
    return;
  }
  const amount = Number(document.getElementById("topupAmount").value);
  if (!amount || amount < 10) {
    toast("Минимум 10 ₽");
    return;
  }
  const data = await api("/api/topup", {
    method: "POST",
    body: JSON.stringify({ amount, method: SELECTED_METHOD }),
  });
  const res = document.getElementById("topupResult");
  if (!data.ok) {
    toast(data.error || "Ошибка");
    return;
  }
  if (data.method === "stars") {
    const amount = Number(document.getElementById("topupAmount").value) || 100;
    const deep = `https://t.me/${CFG.bot_username || "nexvenstudiobot"}?start=topup_${Math.round(amount)}`;
    res.classList.remove("hidden");
    res.innerHTML = `
      <p><b>Пополнение ${formatMoney(amount)} звёздами</b></p>
      <p class="muted" style="margin:10px 0">Бот сразу откроет оплату на эту сумму. Нажмите Start в боте.</p>
      <a class="btn btn-main" href="${deep}" target="_blank" rel="noopener">Оплатить ${formatMoney(amount)} в боте</a>`;
    toast("Откройте бота — счёт на " + Math.round(amount) + " ₽");
    window.open(deep, "_blank");
    return;
  }
  const methodNames = { sbp: "СБП", google_pay: "Google Pay", apple_pay: "Apple Pay" };
  res.classList.remove("hidden");
  res.innerHTML = `
    <p><b>Заявка #${data.request_id} создана</b></p>
    <p style="margin:8px 0">Сумма: <b>${formatMoney(data.amount)}</b> · Способ: <b>${methodNames[data.method] || data.method}</b></p>
    <p class="muted">${escapeHtml(data.message || "")}</p>
    <p style="margin-top:12px">После оплаты напишите менеджеру:
      <a href="https://t.me/${data.manager || CFG.manager || "nexvenstudiomanager"}" target="_blank">@${data.manager || CFG.manager || "nexvenstudiomanager"}</a>
      с номером заявки <b>#${data.request_id}</b></p>`;
  toast("Заявка на пополнение создана");
  loadMyTopups();
}

async function setCurrency(cur) {
  CURRENCY = cur;
  localStorage.setItem("nexven_currency", cur);
  paintUser();
  renderGrids();
  if (ME) {
    await api("/api/currency", { method: "POST", body: JSON.stringify({ currency: cur }) });
    ME.currency = cur;
  }
  if (document.getElementById("page-topup") && !document.getElementById("page-topup").classList.contains("hidden")) {
    renderTopup();
  }
}

async function renderAdmin() {
  const box = document.getElementById("adminPanel");
  if (!box) return;
  if (!ME || !ME.is_admin) {
    box.textContent = "Нет доступа";
    return;
  }
  const pending = await api("/api/admin/orders");
  const topups = await api("/api/admin/topups");
  const pRows = (pending.orders || []).map((o) => `
    <tr>
      <td>#${o.id}</td><td>${escapeHtml(o.product_name)}</td>
      <td>${escapeHtml(o.description || "")}</td>
      <td><button type="button" class="btn" data-accept="${o.id}">Принять</button></td>
    </tr>`).join("");
  const tRows = (topups.topups || []).map((t) => `
    <tr>
      <td>#${t.id}</td><td>${t.user_id}</td><td>${formatMoney(t.amount_rub)}</td><td>${t.method}</td>
      <td>
        <button type="button" class="btn btn-main" data-approve-topup="${t.id}">Одобрить</button>
        <button type="button" class="ghost" data-reject-topup="${t.id}">Отклонить</button>
      </td>
    </tr>`).join("");
  const prodRows = PRODUCTS.map((p) => `
    <div class="panel" style="margin:10px 0;padding:14px">
      <b>${escapeHtml(p.name)}</b> — ${formatMoney(p.price)}
      <div class="row">
        <input type="text" id="n-${p.id}" value="${escapeHtml(p.name)}" style="flex:1">
        <input type="number" id="pr-${p.id}" value="${p.price}" style="width:110px">
      </div>
      <textarea id="d-${p.id}">${escapeHtml(p.description || "")}</textarea>
      <div class="row">
        <button type="button" class="btn" data-save="${p.id}">Сохранить</button>
        <label class="btn">Фото
          <input type="file" accept="image/*" hidden data-upload="${p.id}">
        </label>
      </div>
    </div>`).join("");
  box.innerHTML = `
    <h3>Новые заказы</h3>
    <table class="table">${pRows || "<tr><td>Пусто</td></tr>"}</table>
    <h3 style="margin-top:22px">Заявки на пополнение</h3>
    <table class="table">${tRows || "<tr><td>Пусто</td></tr>"}</table>
    <h3 style="margin-top:22px">Товары и фото</h3>
    ${prodRows}
    <h3 style="margin-top:22px">Выдать баланс</h3>
    <div class="row">
      <input id="giveId" placeholder="Telegram ID">
      <input id="giveAmt" placeholder="Сумма ₽" type="number">
      <button type="button" class="btn btn-main" id="btnGiveBal">Начислить</button>
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

async function approveTopup(id) {
  const data = await api("/api/admin/topups/" + id + "/approve", { method: "POST" });
  toast(data.message || (data.ok ? "Одобрено" : "Ошибка"));
  renderAdmin();
}

async function rejectTopup(id) {
  const data = await api("/api/admin/topups/" + id + "/reject", { method: "POST" });
  toast(data.message || (data.ok ? "Отклонено" : "Ошибка"));
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
      currency: u.currency || CURRENCY,
      updated: Date.now(),
    }, { merge: true });
  } catch (e) {}
}

function bindEvents() {
  document.body.addEventListener("click", (e) => {
    const t = e.target.closest("[data-page]");
    if (t) {
      e.preventDefault();
      showPage(t.getAttribute("data-page"));
      return;
    }
    const order = e.target.closest("[data-order]");
    if (order) {
      openOrder(order.getAttribute("data-order"));
      return;
    }
    const accept = e.target.closest("[data-accept]");
    if (accept) {
      acceptOrder(Number(accept.getAttribute("data-accept")));
      return;
    }
    const save = e.target.closest("[data-save]");
    if (save) {
      saveProduct(save.getAttribute("data-save"));
      return;
    }
    const appr = e.target.closest("[data-approve-topup]");
    if (appr) {
      approveTopup(Number(appr.getAttribute("data-approve-topup")));
      return;
    }
    const rej = e.target.closest("[data-reject-topup]");
    if (rej) {
      rejectTopup(Number(rej.getAttribute("data-reject-topup")));
      return;
    }
    const amt = e.target.closest("[data-amt]");
    if (amt) {
      document.getElementById("topupAmount").value = amt.getAttribute("data-amt");
      return;
    }
    const pay = e.target.closest(".pay-card");
    if (pay) {
      SELECTED_METHOD = pay.getAttribute("data-method");
      document.querySelectorAll(".pay-card").forEach((el) => el.classList.remove("active"));
      pay.classList.add("active");
      return;
    }
  });

  document.body.addEventListener("change", (e) => {
    if (e.target.matches("[data-upload]")) {
      uploadImg(e.target.getAttribute("data-upload"), e.target);
    }
  });

  const curSel = document.getElementById("currencySelect");
  if (curSel) {
    curSel.value = CURRENCY;
    curSel.addEventListener("change", () => setCurrency(curSel.value));
  }

  const btnTopup = document.getElementById("btnDoTopup");
  if (btnTopup) btnTopup.addEventListener("click", doTopup);

  const btnSubmit = document.getElementById("btnSubmitOrder");
  if (btnSubmit) btnSubmit.addEventListener("click", submitOrder);

  const btnClose = document.getElementById("btnCloseModal");
  if (btnClose) btnClose.addEventListener("click", closeModal);

  document.body.addEventListener("click", (e) => {
    if (e.target.id === "btnGiveBal") giveBal();
  });
}

async function boot() {
  bindEvents();
  try {
    const cfg = await api("/api/config");
    CFG = cfg.ok ? cfg : {};
  } catch (e) {
    CFG = {};
  }
  initFirebase(CFG.firebase);
  const me = await api("/api/me");
  ME = me.user || null;
  if (ME && ME.currency) {
    CURRENCY = ME.currency;
    localStorage.setItem("nexven_currency", CURRENCY);
  }
  paintUser();
  await loadProducts();
  showPage("home");
}

boot();
