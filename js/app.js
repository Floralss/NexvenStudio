(function () {
  "use strict";

  const BOT = "nexvenstudiobot";
  const MANAGER = "nexvenstudiomanager";
  const RATES = { RUB: 1, UAH: 0.54, KZT: 5.5, BYN: 0.036 };
  const SYMBOLS = { RUB: "₽", UAH: "₴", KZT: "₸", BYN: "Br" };
  const PRESETS = [25, 50, 100, 200, 500, 1000];

  const PRODUCTS = [
    { id: "bot", name: "Заказать бота", price: 105, description: "Бот будет сделан по вашему описанию и требованиям.", category: "catalog" },
    { id: "site", name: "Заказать сайт", price: 210, description: "Сайт будет сверстан и настроен по вашему ТЗ.", category: "catalog" },
    { id: "prompt", name: "Обучение по промпту для ИИ", price: 25, description: "Обучение по промптам для ИИ — материалы после оплаты.", category: "catalog" },
    { id: "project_crmp", name: "Создать проект CRMP", price: 300, description: "Проект CRMP по вашему ТЗ: системы, моды, оформление.", category: "project" },
    { id: "project_samp", name: "Создать проект SAMP", price: 300, description: "Проект SAMP по вашему ТЗ: системы, моды, оформление.", category: "project" },
    { id: "mod_blackrussia", name: "Мод Black Russia (CRMP)", price: 150, description: "Мод для Black Russia — настройка по вашему описанию.", category: "mod" },
    { id: "mod_arizona", name: "Мод Arizona RP (SAMP)", price: 250, description: "Мод для Arizona RP — настройка по вашему описанию.", category: "mod" },
  ];

  let CURRENCY = localStorage.getItem("nexven_currency") || "RUB";
  let METHOD = "stars";
  let CURRENT = null;

  function $(id) { return document.getElementById(id); }

  function toast(msg) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
    setTimeout(function () { el.style.display = "none"; }, 3500);
  }

  function formatMoney(rub) {
    const rate = RATES[CURRENCY] || 1;
    const val = Number(rub || 0) * rate;
    const sym = SYMBOLS[CURRENCY] || "₽";
    if (CURRENCY === "BYN") return val.toFixed(2) + " " + sym;
    return Math.round(val) + " " + sym;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function showPage(name) {
    document.querySelectorAll("main > section").forEach(function (s) {
      s.classList.add("hidden");
    });
    var page = $("page-" + name);
    if (page) page.classList.remove("hidden");
    if (name === "topup") renderTopup();
    if (name === "catalog" || name === "projects" || name === "mods") renderGrids();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function paintBalance() {
    var bal = $("balanceValue");
    if (bal) bal.textContent = "в боте · " + (SYMBOLS[CURRENCY] || "₽");
    var sel = $("currencySelect");
    if (sel) sel.value = CURRENCY;
  }

  function cardHtml(p) {
    return (
      '<article class="card">' +
      '<div class="pic"><div class="ph steel">' + escapeHtml((p.name || "").slice(0, 18)) + "</div></div>" +
      '<div class="body">' +
      "<h3>" + escapeHtml(p.name) + "</h3>" +
      '<div class="price">' + formatMoney(p.price) + "</div>" +
      '<div class="muted">' + escapeHtml(p.description || "") + "</div>" +
      '<button type="button" class="btn btn-main" data-order="' + escapeHtml(p.id) + '">Заказать</button>' +
      "</div></article>"
    );
  }

  function renderGrids() {
    var cat = PRODUCTS.filter(function (p) { return p.category === "catalog"; });
    var proj = PRODUCTS.filter(function (p) { return p.category === "project"; });
    var mods = PRODUCTS.filter(function (p) { return p.category === "mod"; });
    var gc = $("grid-catalog");
    var gp = $("grid-projects");
    var gm = $("grid-mods");
    if (gc) gc.innerHTML = cat.map(cardHtml).join("");
    if (gp) gp.innerHTML = proj.map(cardHtml).join("");
    if (gm) gm.innerHTML = mods.map(cardHtml).join("");
  }

  function openOrder(id) {
    CURRENT = PRODUCTS.find(function (p) { return p.id === id; });
    if (!CURRENT) return;
    $("mTitle").textContent = CURRENT.name;
    $("mDesc").textContent = CURRENT.description || "";
    $("mPrice").textContent = formatMoney(CURRENT.price);
    $("mText").value = "";
    $("orderModal").classList.add("show");
  }

  function closeModal() {
    $("orderModal").classList.remove("show");
  }

  function submitOrder() {
    if (!CURRENT) return;
    var desc = ($("mText").value || "").trim();
    if (desc.length < 5) {
      toast("Опишите заказ (минимум 5 символов)");
      return;
    }
    var text =
      "Заказ: " + CURRENT.name + "\n" +
      "Цена: " + CURRENT.price + " ₽\n" +
      "Описание:\n" + desc;
    var url = "https://t.me/" + BOT + "?text=" + encodeURIComponent(text);
    window.open(url, "_blank");
    closeModal();
    toast("Откройте бота и отправьте заказ");
  }

  function renderTopup() {
    var presets = $("amountPresets");
    if (presets) {
      presets.innerHTML = PRESETS.map(function (a) {
        return '<button type="button" class="ghost amt-btn" data-amt="' + a + '">' + formatMoney(a) + "</button>";
      }).join("");
    }
    document.querySelectorAll(".pay-card").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-method") === METHOD);
    });
  }

  function doTopup() {
    var amount = Number($("topupAmount").value);
    if (!amount || amount < 10) {
      toast("Минимум 10 ₽");
      return;
    }
    amount = Math.round(amount);
    var res = $("topupResult");
    if (METHOD === "stars") {
      var deep = "https://t.me/" + BOT + "?start=topup_" + amount;
      res.classList.remove("hidden");
      res.innerHTML =
        "<p><b>Пополнение " + formatMoney(amount) + " звёздами</b></p>" +
        '<p class="muted" style="margin:10px 0">Бот сразу откроет оплату на эту сумму. Нажмите Start в боте.</p>' +
        '<a class="btn btn-main" href="' + deep + '" target="_blank" rel="noopener">Оплатить ' + formatMoney(amount) + ' в боте</a>';
      toast("Откройте бота — там счёт на " + amount + " ₽");
      window.open(deep, "_blank");
      return;
    }
    var names = { sbp: "СБП", google_pay: "Google Pay", apple_pay: "Apple Pay" };
    var msg =
      "Пополнение баланса\n" +
      "Сумма: " + amount + " ₽\n" +
      "Способ: " + (names[METHOD] || METHOD);
    res.classList.remove("hidden");
    res.innerHTML =
      "<p><b>Оплата: " + (names[METHOD] || METHOD) + "</b></p>" +
      "<p style=\"margin:8px 0\">Сумма: <b>" + formatMoney(amount) + "</b></p>" +
      '<p class="muted">Напишите менеджеру и укажите сумму. После оплаты баланс начислит админ в боте.</p>' +
      '<a class="btn btn-main" href="https://t.me/' + MANAGER + "?text=" + encodeURIComponent(msg) + '" target="_blank" rel="noopener">Написать @' + MANAGER + "</a>" +
      " &nbsp; " +
      '<a class="ghost btn" href="https://t.me/' + BOT + '" target="_blank" rel="noopener">Открыть бота</a>';
    toast("Напишите менеджеру для оплаты");
  }

  function setCurrency(cur) {
    CURRENCY = cur;
    localStorage.setItem("nexven_currency", cur);
    paintBalance();
    renderGrids();
    if ($("page-topup") && !$("page-topup").classList.contains("hidden")) renderTopup();
  }

  function bind() {
    document.body.addEventListener("click", function (e) {
      var t = e.target.closest("[data-page]");
      if (t) {
        e.preventDefault();
        showPage(t.getAttribute("data-page"));
        return;
      }
      var order = e.target.closest("[data-order]");
      if (order) {
        openOrder(order.getAttribute("data-order"));
        return;
      }
      var amt = e.target.closest("[data-amt]");
      if (amt) {
        $("topupAmount").value = amt.getAttribute("data-amt");
        return;
      }
      var pay = e.target.closest(".pay-card");
      if (pay) {
        METHOD = pay.getAttribute("data-method");
        document.querySelectorAll(".pay-card").forEach(function (el) {
          el.classList.remove("active");
        });
        pay.classList.add("active");
        return;
      }
    });

    var curSel = $("currencySelect");
    if (curSel) {
      curSel.value = CURRENCY;
      curSel.addEventListener("change", function () {
        setCurrency(curSel.value);
      });
    }

    var btnTopup = $("btnDoTopup");
    if (btnTopup) btnTopup.addEventListener("click", doTopup);

    var btnSubmit = $("btnSubmitOrder");
    if (btnSubmit) btnSubmit.addEventListener("click", submitOrder);

    var btnClose = $("btnCloseModal");
    if (btnClose) btnClose.addEventListener("click", closeModal);

    var loginBtn = $("btnLoginBot");
    if (loginBtn) {
      loginBtn.addEventListener("click", function () {
        window.open("https://t.me/" + BOT, "_blank");
      });
    }
  }

  function boot() {
    bind();
    paintBalance();
    renderGrids();
    showPage("home");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
