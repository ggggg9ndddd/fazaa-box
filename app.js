// =====================================================================
//  app.js — واجهة الطالب: التسجيل، الاستئجار، رمز الاستلام، الإرجاع
//  ملاحظة: كل القيود (حجز واحد لكل أداة، طلبات الفتح، الحظر بسبب الرسوم...)
//  مفروضة أيضاً في قواعد Firebase (database.rules.json) وليس هنا فقط.
// =====================================================================
(() => {
  const $ = id => document.getElementById(id);
  const { esc, money } = FZ;

  // active: الحجوزات النشطة للطالب (حجز واحد لكل أداة) — { rid: { r, pin, pinCode, rentalRef, pinRef, receiptFile } }
  const S = {
    user: null, profile: null, state: {},
    tools: {}, active: {},
    selectedTool: null, history: [], registering: false
  };
  let userRef = null, historyQuery = null;
  let lastPhase = "";

  // معرّفات الحجوزات النشطة من حالة المستخدم (+ دعم الصيغة القديمة activeRental)
  function activeIds() {
    const ids = Object.values(S.state.activeByTool || {});
    if (S.state.activeRental && !ids.includes(S.state.activeRental)) ids.push(S.state.activeRental);
    return ids;
  }
  const activeList = () => Object.entries(S.active).map(([rid, a]) => ({ rid, ...a })).filter(a => a.r)
    .sort((x, y) => (x.r.compartment || 0) - (y.r.compartment || 0));

  function show(view) {
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === view));
  }

  if (!FZ.ready) { show("view-setup"); return; }

  // رابط واتساب الفريق
  const contactUrl = (text) => FZ.settings.contactWhatsapp
    ? `https://wa.me/968${FZ.settings.contactWhatsapp}${text ? "?text=" + encodeURIComponent(text) : ""}` : null;

  // -------------------- الإعدادات (من لوحة المسؤول) --------------------
  FZ.onSettings(st => {
    const h = document.querySelector(".brand-text h1"), p = document.querySelector(".brand-text p");
    if (h && st.texts.title) h.textContent = st.texts.title;
    if (p) p.textContent = st.texts.tagline || "";
    if (contactUrl()) { $("waContact").href = contactUrl("السلام عليكم، عندي استفسار عن صندوق فزعة"); $("waContact").style.display = ""; }
    else $("waContact").style.display = "none";
    const ann = $("announcement");
    if (ann) { ann.textContent = st.texts.announcement || ""; ann.hidden = !st.texts.announcement; }
    if (typeof S !== "undefined" && S.user) { renderAlerts(); renderRental(); }
  });

  // -------------------- اتصال الصندوق --------------------
  FZ.watchBox(() => {
    FZ.renderBoxPill($("boxStatus"));
    if (S.user) { renderAlerts(); renderRental(); }
  });

  // -------------------- الأدوات --------------------
  FZ.db.ref("tools").on("value", s => {
    S.tools = s.val() || {};
    renderTools();
    if (S.user) renderRental();
  });

  // -------------------- تبويبات الدخول --------------------
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === t));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.dataset.panel === t.dataset.tab));
  }));

  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.submitter;
    await FZ.withBusy(btn, async () => {
      try {
        await FZ.auth.signInWithEmailAndPassword($("loginEmail").value.trim(), $("loginPassword").value);
      } catch (err) { FZ.toast(FZ.authError(err), "error"); }
    });
  });

  $("forgotBtn").addEventListener("click", async () => {
    const email = $("loginEmail").value.trim();
    if (!email) return FZ.toast("اكتب بريدك الإلكتروني أولاً", "error");
    try {
      await FZ.auth.sendPasswordResetEmail(email);
      FZ.toast("أرسلنا رابط إعادة تعيين كلمة المرور إلى بريدك", "success");
    } catch (err) { FZ.toast(FZ.authError(err), "error"); }
  });

  function readProfile(prefix) {
    const p = {
      name: $(prefix + "Name").value.trim(),
      universityId: $(prefix + "Uni").value.trim(),
      phone: $(prefix + "Phone").value.trim().replace(/^(\+?968)/, "")
    };
    p.name = p.name.replace(/\s+/g, " ");
    if (p.name.split(" ").filter(w => w.length > 1).length < 3) throw new Error("اكتب اسمك الثلاثي (الاسم الأول، اسم الأب، اسم العائلة)");
    if (!/^[0-9]{4,12}$/.test(p.universityId)) throw new Error("الرقم الجامعي أرقام فقط");
    if (!/^[0-9]{8}$/.test(p.phone)) throw new Error("رقم الهاتف 8 أرقام بدون مفتاح الدولة");
    return p;
  }

  // ---- الدخول بحساب Google ----
  $("googleBtn").addEventListener("click", async e => {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await FZ.withBusy(e.currentTarget, async () => {
      try {
        await FZ.auth.signInWithPopup(provider);
      } catch (err) {
        if (err && (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment")) {
          return FZ.auth.signInWithRedirect(provider);
        }
        if (err && (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request")) return;
        if (err && err.code === "auth/account-exists-with-different-credential") {
          return FZ.toast("هذا البريد مسجّل بكلمة مرور — ادخل بالبريد وكلمة المرور", "error");
        }
        FZ.toast(FZ.authError(err), "error");
      }
    });
  });
  if (FZ.auth) FZ.auth.getRedirectResult().catch(err => FZ.toast(FZ.authError(err), "error"));

  $("registerForm").addEventListener("submit", async e => {
    e.preventDefault();
    let p;
    try { p = readProfile("reg"); } catch (err) { return FZ.toast(err.message, "error"); }
    const email = $("regEmail").value.trim();
    await FZ.withBusy(e.submitter, async () => {
      S.registering = true;
      try {
        const cred = await FZ.auth.createUserWithEmailAndPassword(email, $("regPassword").value);
        await FZ.db.ref(`users/${cred.user.uid}/profile`).set({ ...p, email, createdAt: FZ.TS });
        FZ.toast("تم إنشاء الحساب بنجاح 🎉", "success");
      } catch (err) { FZ.toast(FZ.authError(err), "error"); }
      finally { S.registering = false; }
    });
  });

  $("profileForm").addEventListener("submit", async e => {
    e.preventDefault();
    let p;
    try { p = readProfile("p"); } catch (err) { return FZ.toast(err.message, "error"); }
    await FZ.withBusy(e.submitter, async () => {
      try {
        await FZ.db.ref(`users/${S.user.uid}/profile`).set({ ...p, email: S.user.email || "", createdAt: FZ.TS });
      } catch (err) { FZ.toast(FZ.authError(err), "error"); }
    });
  });

  document.querySelectorAll(".js-logout").forEach(b => b.addEventListener("click", () => FZ.auth.signOut()));

  // -------------------- حالة المستخدم --------------------
  function detachAll() {
    if (userRef) userRef.off(); userRef = null;
    if (historyQuery) historyQuery.off(); historyQuery = null;
    syncActive([]);
  }

  FZ.auth.onAuthStateChanged(user => {
    detachAll();
    S.user = user; S.profile = null; S.state = {};
    if (!user) { show("view-auth"); return; }
    show("view-loading");

    userRef = FZ.db.ref(`users/${user.uid}`);
    userRef.on("value", snap => {
      const v = snap.val() || {};
      S.profile = v.profile || null;
      S.state = v.state || {};
      if (!S.profile) {
        if (!S.registering) {
          // تعبئة الاسم من حساب Google كبداية (يعدّله الطالب ليكون ثلاثياً)
          if (!$("pName").value && user.displayName) $("pName").value = user.displayName;
          show("view-profile");
        }
        return;
      }
      $("userName").textContent = S.profile.name;
      show("view-main");
      syncActive(activeIds());
      renderAll();
    }, err => { FZ.toast(FZ.authError(err), "error"); });

    historyQuery = FZ.db.ref("rentals").orderByChild("uid").equalTo(user.uid).limitToLast(10);
    historyQuery.on("value", snap => {
      const list = [];
      snap.forEach(c => { list.push({ id: c.key, ...c.val() }); });
      S.history = list.reverse();
      renderHistory();
    }, () => {});
  });

  // متابعة كل حجز نشط (وطلب الفتح الخاص به) لحظياً
  function syncActive(ids) {
    Object.keys(S.active).forEach(rid => {
      if (ids.includes(rid)) return;
      const a = S.active[rid];
      if (a.rentalRef) a.rentalRef.off();
      if (a.pinRef) a.pinRef.off();
      if (a.codeRef) a.codeRef.off();
      delete S.active[rid];
    });
    ids.forEach(rid => {
      if (S.active[rid]) return;
      const a = S.active[rid] = { r: null, pin: null, pinCode: null, rentalRef: FZ.db.ref(`rentals/${rid}`), pinRef: null, receiptFile: null };
      a.rentalRef.on("value", s => {
        const prev = a.r;
        a.r = FZ.withDue(s.val());
        if (prev && a.r && prev.status !== a.r.status) announceStatus(a.r.status, a.r.toolName);
        attachCode(rid);
        renderAll();
      }, () => {});
    });
  }

  // رمز الصندوق الثابت للأداة — يظهر للطالب فقط بعد موافقة المسؤول
  function attachCode(rid) {
    const a = S.active[rid];
    if (!a || !a.r) return;
    const want = ["paid", "active"].includes(a.r.status) ? a.r.toolId : null;
    if (want === (a.codeTool || null)) return;
    if (a.codeRef) a.codeRef.off();
    a.codeRef = null; a.codeTool = want; a.boxCode = null;
    if (!want) return;
    a.codeRef = FZ.db.ref(`toolCodes/${want}`);
    a.codeRef.on("value", s => { a.boxCode = s.val(); renderRental(); }, () => { a.boxCode = null; renderRental(); });
  }

  function attachPin(rid, code) {
    const a = S.active[rid];
    if (!a || (code || null) === a.pinCode) return;
    if (a.pinRef) a.pinRef.off();
    a.pinRef = null; a.pinCode = code || null; a.pin = null;
    if (!code) return;
    a.pinRef = FZ.db.ref(`pins/${code}`);
    a.pinRef.on("value", s => { a.pin = s.val(); renderRental(); }, () => { a.pin = null; renderRental(); });
  }

  function announceStatus(status, toolName) {
    const msgs = {
      paid: "وافق المسؤول على حجزك ✅ رمز الصندوق ظاهر لك الآن",
      active: "تم فتح القسم — استلم أداتك. لا تنسَ موعد الإرجاع ⏰",
      returning: "فُتح القسم — ضع الأداة ثم اضغط «تم الإرجاع»",
      returned: "تم إرجاع الأداة بنجاح، شكراً لك 🌟",
      rejected: "تم رفض طلبك — تواصل مع المسؤول للاستفسار",
      cancelled: "تم إلغاء الطلب"
    };
    if (msgs[status]) FZ.toast((toolName ? toolName + ": " : "") + msgs[status], status === "rejected" ? "error" : "success");
  }

  // -------------------- العرض --------------------
  function renderAll() {
    renderAlerts();
    renderRental();
    renderTools();
    renderHistory();
  }

  function renderAlerts() {
    const out = [];
    const fee = S.state.lateFeeDue || 0;
    if (S.state.blocked) {
      out.push(`<div class="banner banner-danger"><strong>حسابك موقوف عن الحجز.</strong>
        للاستفسار تواصل مع فريق فزعة.</div>`);
    }
    if (fee > 0) {
      out.push(`<div class="banner banner-danger"><strong>عليك رسوم تأخير: ${money(fee)}</strong>
        لا يمكنك استئجار أداة جديدة حتى تسويتها. حوّل المبلغ وتواصل مع الفريق.
        ${contactUrl() ? `<a class="btn btn-whatsapp btn-sm mt-12" target="_blank" rel="noopener" href="${contactUrl("السلام عليكم، أبي أسدد رسوم التأخير — رقمي الجامعي " + (S.profile ? S.profile.universityId : ""))}">تواصل عبر واتساب</a>` : ""}</div>`);
    }
    if (!FZ.box.enabled) {
      out.push(`<div class="banner banner-warn"><strong>الصندوق متوقف مؤقتاً.</strong>
        لا يمكن فتح الأقسام الآن. سيعود للعمل قريباً، وللاستفسار تواصل مع الفريق.</div>`);
    } else if (!FZ.box.online && activeList().some(a => ["paid", "active"].includes(a.r.status))) {
      out.push(`<div class="banner banner-warn"><strong>الصندوق غير متصل حالياً.</strong>
        الأقفال مغلقة ولا يمكن فتح الأقسام حتى يعود الاتصال.</div>`);
    }
    $("alerts").innerHTML = out.join("");
  }

  // رمز الفتح: يتولّد من الموقع والطالب يكتبه في لوحة أرقام الصندوق
  function pinState(a, type) {
    const p = a.pin;
    if (!p || p.type !== type) return "none";
    if (p.used) return "used";
    if (FZ.now() - p.createdAt > FZ.PIN_TTL) return "expired";
    return "valid";
  }

  function openBlock(a, type, compartment) {
    const code = a.boxCode;
    const offline = !FZ.box.online
      ? `<p class="hint warn">${FZ.box.enabled ? "الصندوق غير متصل حالياً، انتظر لين يرجع الاتصال." : "الصندوق متوقف مؤقتاً، لا يمكن فتحه الآن."}</p>` : "";
    if (!code) return `<div class="banner banner-warn">رمز الصندوق لهذه الأداة غير جاهز بعد — تواصل مع فريق فزعة.</div>`;
    return `<div class="pin-container">
        <div class="pin-label">رمز الصندوق — القسم رقم ${compartment}</div>
        <div class="pin-code" dir="ltr">${esc(code)}</div>
        <div class="pin-help">اكتب الرمز في لوحة أرقام الصندوق ثم اضغط <b>#</b></div>
        <div class="pin-exp">${type === "pickup"
          ? "يبدأ وقت الإيجار لحظة إدخال الرمز وفتح القسم."
          : "ضع الأداة داخل القسم وأغلق الباب — يتسجّل الإرجاع تلقائياً."}</div>
      </div>${offline}`;
  }

  // رفع إيصال التحويل (يُحفظ في Google Drive ويؤكد الحجز تلقائياً)
  function receiptBlock(a) {
    const r = a.r;
    if (r.receiptUrl) {
      return `<div class="banner banner-info"><strong>تم استلام إيصالك ✔</strong> (${FZ.fmtTime(r.receiptAt)})<br>
        بانتظار موافقة المسؤول. بعد الموافقة تظهر لك خطوة استلام الأداة هنا.</div>`;
    }
    if (typeof RECEIPT_ENDPOINT === "undefined" || !RECEIPT_ENDPOINT) {
      // احتياطي: بدون رابط رفع الإيصالات نرجع للطريقة القديمة (موافقة المسؤول)
      return r.paymentClaimedAt
        ? `<div class="banner banner-info">تم إبلاغ المسؤول بالتحويل (${FZ.fmtTime(r.paymentClaimedAt)}). سيتم التحقق والموافقة قريباً.</div>`
        : `<button class="btn btn-accent btn-block" data-action="claim" data-rid="${a.rid}">حوّلت المبلغ ✔</button>`;
    }
    const f = a.receiptFile;
    return `
      <div class="receipt-box">
        <label class="receipt-drop">
          <input type="file" class="receipt-input" data-rid="${a.rid}" accept="image/*,application/pdf">
          <span class="receipt-icon">🧾</span>
          <b>${f ? esc(f.name) : "اضغط لإرفاق صورة إيصال التحويل"}</b>
          <span class="muted small">${f ? `${(f.size / 1024 / 1024).toFixed(1)} MB — اضغط للتغيير` : "صورة أو لقطة شاشة أو PDF"}</span>
        </label>
        <button class="btn btn-accent btn-block" data-action="uploadReceipt" data-rid="${a.rid}" ${f ? "" : "disabled"}>رفع الإيصال</button>
        <p class="hint">بعد رفع الإيصال يراجعه المسؤول ويوافق على حجزك.</p>
      </div>`;
  }

  document.addEventListener("change", e => {
    if (!e.target.classList.contains("receipt-input")) return;
    const a = S.active[e.target.dataset.rid];
    if (!a) return;
    a.receiptFile = e.target.files[0] || null;
    renderRental();
  });

  function compressImage(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1600, scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => resolve(b || file), "image/jpeg", 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); }; // صيغة لا يفتحها المتصفح (مثل HEIC) — نرسلها كما هي
      img.src = url;
    });
  }

  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1]);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  async function uploadReceipt(rid) {
    const a = S.active[rid];
    const f = a && a.receiptFile;
    if (!f) return FZ.toast("اختر صورة الإيصال أولاً", "error");
    let blob = f, mime = f.type || "application/octet-stream";
    if (mime.startsWith("image/") && mime !== "image/heic") {
      const out = await compressImage(f);
      if (out !== f) { blob = out; mime = "image/jpeg"; }
    }
    if (blob.size > 6 * 1024 * 1024) return FZ.toast("الملف كبير جداً — الحد 6MB", "error");
    try {
      const idToken = await FZ.auth.currentUser.getIdToken();
      const res = await fetch(RECEIPT_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ idToken, rentalId: rid, mimeType: mime, data: await toBase64(blob) })
      });
      const j = await res.json();
      FZ.toast(j.msg || "تم", j.ok ? "success" : "error");
      if (j.ok && S.active[rid]) S.active[rid].receiptFile = null;
    } catch (err) {
      FZ.toast("تعذّر رفع الإيصال، تحقق من الإنترنت وحاول مرة أخرى", "error");
    }
  }

  function row(k, v) { return `<div class="kv"><span>${k}</span><strong>${v}</strong></div>`; }

  function renderRental() {
    const el = $("rentalPanel");
    const ids = activeIds();
    if (!ids.length) { el.innerHTML = ""; lastPhase = ""; return; }
    lastPhase = phaseKey();
    const list = activeList();
    const loading = ids.length > list.length ? `<div class="card"><div class="loader small"></div></div>` : "";
    el.innerHTML = list.map(rentalCard).join("") + loading;
  }

  function rentalCard(a) {
    const r = a.r;
    const steps = ["الدفع", "الموافقة", "الاستلام", "الإرجاع"];
    const at = { pending: 0, paid: 1, active: 2, returning: 3, returned: 4 }[r.status] ?? 0;
    const track = `<ol class="track" aria-label="مراحل الحجز">${steps.map((s, i) =>
      `<li class="${i < at ? "done" : i === at ? "current" : ""}"><span class="track-dot"></span><span class="track-label">${s}</span></li>`).join("")}</ol>`;
    const head = `<div class="rental-head"><h2 class="section-title">${esc(r.toolName)}</h2>${FZ.badge(FZ.STATUS, r.status)}</div>${track}`;
    const summary = `<div class="kv-list">
        ${row("المدة", FZ.planLabel(r.hours))}
        ${row("المبلغ", money(r.amount))}
        ${row("رقم القسم", r.compartment)}
      </div>`;
    let body = "";

    if (r.status === "pending") {
      const accts = FZ.settings.payment.accounts;
      const accounts = accts.map(x =>
        `<p><strong>${esc(x.label)}:</strong> <span class="account-number">${esc(x.value)}</span></p>`).join("");
      body = `
        <div class="payment-info">
          <p>حوّل <strong>${money(r.amount)}</strong> إلى ${accts.length > 1 ? "أحد الحسابات التالية" : "الحساب التالي"}:</p>
          ${accounts}
          <p class="mt-12">اكتب هذا <strong>الرمز المرجعي</strong> في ملاحظة/وصف التحويل:</p>
          <div class="ref-code" dir="ltr">${esc(r.ref)}</div>
        </div>
        ${receiptBlock(a)}
        <button class="btn btn-whatsapp btn-block" data-action="whatsapp" data-rid="${a.rid}">أرسل بيانات حجزك لفزعة عبر واتساب 📲</button>
        ${r.paymentClaimedAt || r.receiptUrl ? "" : `<button class="btn-link mt-12" data-action="cancel" data-rid="${a.rid}">إلغاء الطلب</button>`}`;
    } else if (r.status === "paid") {
      body = `
        <div class="banner banner-success">وافق المسؤول على حجزك ✅ توجّه إلى الصندوق لاستلام الأداة من <b>القسم رقم ${r.compartment}</b>.</div>
        <p class="hint">مدة الاستئجار تبدأ لحظة فتح القسم.</p>
        ${openBlock(a, "pickup", r.compartment)}
        <button class="btn btn-whatsapp btn-block" data-action="whatsapp" data-rid="${a.rid}">أرسل بيانات حجزك لفزعة عبر واتساب 📲</button>`;
    } else if (r.status === "active") {
      const t = FZ.now();
      let due;
      if (t < r.dueAt) {
        due = `<div class="due-box">
            <div class="pin-label">الوقت المتبقي للإرجاع</div>
            <div class="due-timer" data-to="${r.dueAt}">${FZ.fmtCountdown(r.dueAt - t)}</div>
            <div class="muted small">موعد الإرجاع: ${FZ.fmtTime(r.dueAt)}</div>
          </div>`;
      } else if (t < r.dueAt + FZ.GRACE) {
        due = `<div class="banner banner-warn"><strong>⏰ انتهت مدة الاستئجار — أرجع الأداة الآن</strong>
            تبدأ رسوم التأخير بعد <b data-to="${r.dueAt + FZ.GRACE}">${FZ.fmtCountdown(r.dueAt + FZ.GRACE - t)}</b>.</div>`;
      } else {
        const fee = FZ.lateFeeFor(r, S.tools[r.toolId], t);
        due = `<div class="banner banner-danger"><strong>⏰ انتهت مدة الاستئجار — أرجع الأداة الآن</strong>
            رسوم التأخير حتى الآن: <b>${money(fee)}</b>، وتزيد كل ساعة إلى أن تُرجع الأداة.
            لن تتمكن من الاستئجار مجدداً حتى تسويتها.</div>`;
      }
      const returnSection = `<h3 class="sub-title">إرجاع الأداة</h3>` + (FZ.RETURN_AFTER_DUE && t < r.dueAt
        ? `<p class="hint">الإرجاع يتفعّل بعد انتهاء مدة الاستئجار، وبعدها تكتب نفس الرمز في الصندوق لفتح <b>القسم رقم ${r.compartment}</b> وتضع الأداة داخله.</p>
        <button class="btn btn-primary btn-block btn-lg" disabled>🔒 الإرجاع يتفعّل بعد <span data-to="${r.dueAt}">${FZ.fmtCountdown(r.dueAt - t)}</span></button>`
        : `<p class="hint">اكتب نفس الرمز في لوحة أرقام الصندوق لفتح <b>القسم رقم ${r.compartment}</b> وإرجاع الأداة.</p>
        ${openBlock(a, "return", r.compartment)}`);
      body = `${due}
        ${returnSection}
        <button class="btn btn-whatsapp btn-block" data-action="whatsapp" data-rid="${a.rid}">أرسل بيانات حجزك لفزعة عبر واتساب 📲</button>`;
    } else if (r.status === "returning") {
      body = `
        <div class="banner banner-success"><strong>فُتح القسم رقم ${r.compartment} ✅</strong>
          ضع الأداة داخل القسم وأغلق الباب جيداً، ثم اضغط «تم الإرجاع».</div>
        <button class="btn btn-accent btn-block btn-lg" data-action="confirmReturn" data-rid="${a.rid}">✔ تم الإرجاع</button>`;
    } else {
      body = `<p class="hint">جارٍ التحديث…</p>`;
    }
    return `<div class="card rental-card">${head}${summary}${body}</div>`;
  }

  // مفتاح يتغير عند تجاوز حدّ زمني (انتهاء رمز / انتهاء المدة / انتهاء السماح) لإعادة الرسم
  function phaseKey() {
    const t = FZ.now();
    return activeList().map(a => {
      const r = a.r;
      const pinValid = a.pin && !a.pin.used && t - a.pin.createdAt <= FZ.PIN_TTL;
      const duePhase = r.dueAt ? (t < r.dueAt ? 0 : t < r.dueAt + FZ.GRACE ? 1 : 2) : -1;
      return `${a.rid}:${r.status}|${pinValid}|${duePhase}`;
    }).join(",");
  }

  // أيقونة بسيطة لكل أداة حسب اسمها
  function toolIcon(name) {
    const n = String(name || "");
    if (/حاسب|calc/i.test(n)) return `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="9" y="4" width="30" height="40" rx="6" fill="currentColor" opacity=".14"/><rect x="9" y="4" width="30" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="3"/><rect x="14" y="9" width="20" height="9" rx="2" fill="currentColor"/><g fill="currentColor"><circle cx="17" cy="25" r="2.4"/><circle cx="24" cy="25" r="2.4"/><circle cx="31" cy="25" r="2.4"/><circle cx="17" cy="32" r="2.4"/><circle cx="24" cy="32" r="2.4"/><circle cx="17" cy="39" r="2.4"/><circle cx="24" cy="39" r="2.4"/><rect x="28.6" y="29.6" width="4.8" height="11.8" rx="2.4"/></g></svg>`;
    if (/كيبل|شحن|cable|type/i.test(n)) return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 40c0-9 6-12 14-12s14-4 14-12V9" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><rect x="31" y="2" width="14" height="9" rx="3" fill="currentColor"/><rect x="4" y="36" width="12" height="9" rx="3" fill="currentColor" opacity=".55"/><path d="M26 17l-5 8h5l-2 7 6-9h-5z" fill="#FFC21A"/></svg>`;
    return `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="12" width="36" height="28" rx="5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M6 20h36" stroke="currentColor" stroke-width="3"/><rect x="19" y="8" width="10" height="6" rx="2" fill="currentColor"/></svg>`;
  }

  function renderTools() {
    const grid = $("toolsGrid");
    const ids = Object.keys(S.tools).sort((a, b) => (S.tools[a].compartment || 0) - (S.tools[b].compartment || 0));
    if (!ids.length) { grid.innerHTML = `<p class="muted">لا توجد أدوات بعد.</p>`; return; }
    const blocked = (S.state.lateFeeDue || 0) > 0 || S.state.blocked === true;
    const mine = new Set(activeList().map(a => a.r.toolId).concat(Object.keys(S.state.activeByTool || {})));
    grid.innerHTML = ids.map(id => {
      const t = S.tools[id];
      const plans = Object.values(t.plans || {}).sort((a, b) => a.hours - b.hours);
      const from = plans.length ? plans[0].amount : null;
      const avail = t.status === "available";
      if (mine.has(id)) {
        return `<article class="tool-card is-mine">
            <div class="tool-icon">${toolIcon(t.name)}</div>
            <div class="tool-info"><h3>${esc(t.name)}</h3><p class="tool-note">لديك حجز لهذه الأداة — تجده بالأعلى</p></div>
          </article>`;
      }
      return `<article class="tool-card ${avail ? "" : "is-off"}">
          <div class="tool-icon">${toolIcon(t.name)}</div>
          <div class="tool-info">
            <div class="tool-meta"><span class="comp-tag">القسم ${esc(t.compartment)}</span>${avail ? "" : FZ.badge(FZ.TOOL_STATUS, t.status)}</div>
            <h3>${esc(t.name)}</h3>
            <p class="tool-price"><b>${money(from)}</b> <span>/ ${plans.length ? FZ.planLabel(plans[0].hours) : ""}</span></p>
          </div>
          <button class="btn btn-accent" data-action="select" data-tool="${esc(id)}" ${avail && !blocked ? "" : "disabled"}>احجز</button>
        </article>`;
    }).join("");
  }

  function renderPlans() {
    const t = S.tools[S.selectedTool];
    if (!t) return goTools();
    const plans = Object.entries(t.plans || {}).sort((a, b) => a[1].hours - b[1].hours);
    $("planBox").innerHTML = `
      <div class="form-group">
        <label>الأداة المختارة</label>
        <input type="text" class="form-control selected-tool-input" value="${esc(t.name)}" readonly>
      </div>
      <div class="plan-grid">
        ${plans.map(([k, p], i) => `
          <label class="plan-option">
            <input type="radio" name="plan" value="${esc(k)}" ${i === 0 ? "checked" : ""}>
            <span class="plan-card"><b>${FZ.planLabel(p.hours)}</b><span>${money(p.amount)}</span></span>
          </label>`).join("")}
      </div>
      <ul class="rules-list">
        <li>تقدر تحجز أكثر من أداة، وكل أداة لها حجز ودفع وإرجاع مستقل.</li>
        <li>بعد الدفع ارفع الإيصال، ويؤكد المسؤول حجزك.</li>
        <li>بعد موافقة المسؤول يظهر لك رمز الصندوق. تكتبه في لوحة الأرقام للاستلام، ونفس الرمز للإرجاع.</li>
        <li>${FZ.GRACE ? `بعد انتهاء المدة لديك ${FZ.settings.rules.graceMinutes} دقيقة، بعدها تبدأ` : "تبدأ"} رسوم التأخير (${money(t.lateFeePerHour)} لكل ساعة)، ويُمنع الاستئجار حتى تسويتها.</li>
      </ul>
      <button class="btn btn-block mt-20" data-action="book">تأكيد الطلب والانتقال للدفع</button>`;
  }

  function goTools() {
    S.selectedTool = null;
    $("step-plan").classList.remove("active");
    $("step-tools").classList.add("active");
  }
  $("planBack").addEventListener("click", goTools);

  function renderHistory() {
    const act = activeIds();
    const list = S.history.filter(h => !act.includes(h.id)).slice(0, 5);
    if (!list.length) { $("historyPanel").innerHTML = ""; return; }
    $("historyPanel").innerHTML = `
      <h2 class="section-title mt-24">طلباتي السابقة</h2>
      <div class="history">
        ${list.map(h => `<div class="history-item">
            <div><b>${esc(h.toolName)}</b><div class="muted small">${FZ.fmtTime(h.createdAt)} · ${FZ.planLabel(h.hours)}</div></div>
            <div class="text-end">${FZ.badge(FZ.STATUS, h.status)}
              ${h.lateFee ? `<div class="small danger-text">تأخير: ${money(h.lateFee)}${h.lateFeePaid ? " (مسدّدة)" : ""}</div>` : ""}</div>
          </div>`).join("")}
      </div>`;
  }

  // -------------------- الإجراءات --------------------
  document.addEventListener("click", async e => {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.disabled) return;
    const a = btn.dataset.action, rid = btn.dataset.rid;
    if (a === "select") {
      S.selectedTool = btn.dataset.tool;
      renderPlans();
      $("step-tools").classList.remove("active");
      $("step-plan").classList.add("active");
    } else if (a === "book") {
      await FZ.withBusy(btn, createRental);
    } else if (a === "uploadReceipt") {
      await FZ.withBusy(btn, () => uploadReceipt(rid));
    } else if (a === "claim") {
      await FZ.withBusy(btn, () => FZ.db.ref(`rentals/${rid}/paymentClaimedAt`).set(FZ.TS)
        .then(() => FZ.toast("تم إبلاغ المسؤول، انتظر الموافقة", "success"))
        .catch(err => FZ.toast(FZ.authError(err), "error")));
    } else if (a === "cancel") {
      if (!confirm("هل تريد إلغاء الطلب؟")) return;
      const r = S.active[rid] && S.active[rid].r;
      if (!r) return;
      const upd = { [`rentals/${rid}/status`]: "cancelled" };
      if (S.state.activeByTool && S.state.activeByTool[r.toolId] === rid) upd[`users/${S.user.uid}/state/activeByTool/${r.toolId}`] = null;
      else upd[`users/${S.user.uid}/state/activeRental`] = null;
      await FZ.withBusy(btn, () => FZ.db.ref().update(upd).catch(err => FZ.toast(FZ.authError(err), "error")));
    } else if (a === "open") {
      await FZ.withBusy(btn, () => generatePin(rid, btn.dataset.type));
    } else if (a === "confirmReturn") {
      const r = S.active[rid] && S.active[rid].r;
      if (!r || r.status !== "returning") return;
      if (!confirm("هل وضعت الأداة داخل القسم وأغلقت الباب؟")) return;
      const upd = {
        [`rentals/${rid}/status`]: "returned",
        [`rentals/${rid}/returnConfirmedAt`]: FZ.TS,
        [`tools/${r.toolId}/status`]: "available"
      };
      if (S.state.activeByTool && S.state.activeByTool[r.toolId] === rid) upd[`users/${S.user.uid}/state/activeByTool/${r.toolId}`] = null;
      if (S.state.activeRental === rid) upd[`users/${S.user.uid}/state/activeRental`] = null;
      await FZ.withBusy(btn, () => FZ.db.ref().update(upd).catch(err => FZ.toast(FZ.authError(err), "error")));
    } else if (a === "whatsapp") {
      sendToWhatsApp(rid);
    }
  });

  async function createRental() {
    const toolId = S.selectedTool;
    const t = S.tools[toolId];
    const planKey = (document.querySelector('input[name="plan"]:checked') || {}).value;
    if (!t || !planKey) return FZ.toast("اختر المدة", "error");
    const plan = t.plans[planKey];
    const rid = FZ.db.ref("rentals").push().key;
    const ref = "FZ-" + rid.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, "7");
    try {
      await FZ.db.ref().update({
        [`rentals/${rid}`]: {
          uid: S.user.uid, toolId, toolName: t.name, compartment: t.compartment,
          plan: planKey, hours: plan.hours, amount: plan.amount,
          ref, status: "pending", createdAt: FZ.TS
        },
        [`users/${S.user.uid}/state/activeByTool/${toolId}`]: rid
      });
      goTools();
      FZ.toast("تم إنشاء الطلب — حوّل المبلغ مع الرمز المرجعي", "success");
    } catch (err) {
      FZ.toast("تعذّر إنشاء الطلب: قد تكون الأداة لم تعد متاحة، أو لديك حجز لنفس الأداة أو رسوم غير مسددة.", "error");
    }
  }

  function randomPin() {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return String(a[0] % 1000000).padStart(6, "0");
  }

  async function generatePin(rid, type) {
    const r = S.active[rid] && S.active[rid].r;
    if (!r) return;
    if (!FZ.box.online) return FZ.toast(FZ.box.enabled ? "الصندوق غير متصل حالياً" : "الصندوق متوقف مؤقتاً", "error");
    if (type === "return" && FZ.RETURN_AFTER_DUE && FZ.now() < (r.dueAt || 0)) return FZ.toast("الإرجاع متاح بعد انتهاء مدة الاستئجار", "error");
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = randomPin();
      try {
        await FZ.db.ref().update({
          [`pins/${code}`]: {
            uid: S.user.uid, rentalId: rid, compartment: r.compartment,
            type, createdAt: FZ.TS, used: false
          },
          [`rentals/${rid}/currentPin`]: code
        });
        return; // نجح — المستمع سيعرض الرمز
      } catch (err) { /* غالباً تعارض مع رمز آخر فعّال — نجرب رقماً آخر */ }
    }
    FZ.toast("تعذّر إنشاء الرمز. تأكد أن الصندوق متصل وحاول مجدداً.", "error");
  }

  function sendToWhatsApp(rid) {
    const r = S.active[rid] && S.active[rid].r;
    if (!r || !S.profile) return;
    const msg = `*حجز جديد — صندوق فزعة* ⚡\n\n` +
      `*الاسم:* ${S.profile.name}\n*الرقم الجامعي:* ${S.profile.universityId}\n*الهاتف:* ${S.profile.phone}\n\n` +
      `*الأداة:* ${r.toolName} (القسم ${r.compartment})\n*المدة:* ${FZ.planLabel(r.hours)}\n*المبلغ:* ${money(r.amount)}\n` +
      `*الرمز المرجعي للتحويل:* ${r.ref}\n*الحالة:* ${(FZ.STATUS[r.status] || {}).label || r.status}\n` +
      (r.dueAt ? `*موعد الإرجاع:* ${FZ.fmtTime(r.dueAt)}\n` : "");
    const url = contactUrl(msg);
    if (!url) return FZ.toast("رقم تواصل فزعة غير مضبوط", "error");
    window.open(url, "_blank");
  }

  // -------------------- العدّادات --------------------
  const alerted = new Set();
  FZ.startCountdowns(() => {
    const list = activeList();
    if (!list.length) return;
    if (phaseKey() !== lastPhase) {
      renderRental(); renderAlerts();
      list.forEach(a => {
        if (a.r.status === "active" && FZ.now() >= a.r.dueAt && !alerted.has(a.rid)) {
          alerted.add(a.rid);
          FZ.toast(`⏰ انتهت مدة استئجار ${a.r.toolName} — أرجعها الآن`, "error");
        }
      });
    }
  });
})();
