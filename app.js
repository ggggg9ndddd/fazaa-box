// =====================================================================
//  app.js — واجهة الطالب: التسجيل، الاستئجار، رمز الاستلام، الإرجاع
//  ملاحظة: كل القيود (أداة واحدة، صلاحية الرمز، الحظر بسبب الرسوم...)
//  مفروضة أيضاً في قواعد Firebase (database.rules.json) وليس هنا فقط.
// =====================================================================
(() => {
  const $ = id => document.getElementById(id);
  const { esc, money } = FZ;

  const S = {
    user: null, profile: null, state: {},
    tools: {}, rentalId: null, rental: null,
    pinCode: null, pin: null,
    selectedTool: null, history: [], registering: false
  };
  let userRef = null, rentalRef = null, pinRef = null, historyQuery = null;
  let lastPhase = "";

  function show(view) {
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === view));
  }

  if (!FZ.ready) { show("view-setup"); return; }

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
    if (p.name.length < 3) throw new Error("اكتب اسمك الكامل");
    if (!/^[0-9]{4,12}$/.test(p.universityId)) throw new Error("الرقم الجامعي أرقام فقط");
    if (!/^[0-9]{8}$/.test(p.phone)) throw new Error("رقم الهاتف 8 أرقام بدون مفتاح الدولة");
    return p;
  }

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
    attachRental(null);
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
      if (!S.profile) { if (!S.registering) show("view-profile"); return; }
      $("userName").textContent = S.profile.name;
      show("view-main");
      const rid = S.state.activeRental || null;
      if (rid !== S.rentalId) attachRental(rid);
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

  function attachRental(rid) {
    if (rentalRef) rentalRef.off();
    rentalRef = null; S.rentalId = rid; S.rental = null;
    attachPin(null);
    if (!rid) { renderAll(); return; }
    rentalRef = FZ.db.ref(`rentals/${rid}`);
    rentalRef.on("value", s => {
      const prev = S.rental;
      S.rental = s.val();
      if (prev && S.rental && prev.status !== S.rental.status) announceStatus(S.rental.status);
      attachPin(S.rental && S.rental.currentPin);
      renderAll();
    }, () => {});
  }

  function attachPin(code) {
    if ((code || null) === S.pinCode) return;
    if (pinRef) pinRef.off();
    pinRef = null; S.pinCode = code || null; S.pin = null;
    if (!code) return;
    pinRef = FZ.db.ref(`pins/${code}`);
    pinRef.on("value", s => { S.pin = s.val(); renderRental(); }, () => { S.pin = null; renderRental(); });
  }

  function announceStatus(status) {
    const msgs = {
      paid: "تمت الموافقة على الدفع ✅ يمكنك الآن إنشاء رمز الاستلام عند الصندوق",
      active: "تم فتح القسم — استلم أداتك. لا تنسَ موعد الإرجاع ⏰",
      returned: "تم إرجاع الأداة بنجاح، شكراً لك 🌟",
      rejected: "تم رفض طلبك — تواصل مع المسؤول للاستفسار",
      cancelled: "تم إلغاء الطلب"
    };
    if (msgs[status]) FZ.toast(msgs[status], status === "rejected" ? "error" : "success");
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
    if (fee > 0) {
      out.push(`<div class="banner banner-danger"><strong>عليك رسوم تأخير: ${money(fee)}</strong>
        لا يمكنك استئجار أداة جديدة حتى تسويتها. حوّل المبلغ وتواصل مع المسؤول.</div>`);
    }
    if (!FZ.box.online && (S.rental && ["paid", "active"].includes(S.rental.status))) {
      out.push(`<div class="banner banner-warn"><strong>الصندوق غير متصل حالياً.</strong>
        الأقفال مغلقة ولا يمكن إنشاء رموز أو استخدامها حتى يعود الاتصال.</div>`);
    }
    $("alerts").innerHTML = out.join("");
  }

  function pinState(type) {
    const p = S.pin;
    if (!p || p.type !== type) return { kind: "none" };
    if (p.used) return { kind: "used" };
    const left = p.createdAt + FZ.PIN_TTL - FZ.now();
    if (left <= 0) return { kind: "expired" };
    return { kind: "valid", expiresAt: p.createdAt + FZ.PIN_TTL };
  }

  function pinBlock(type, compartment) {
    const ps = pinState(type);
    const title = type === "pickup" ? "رمز الاستلام" : "رمز الإرجاع";
    if (ps.kind === "valid") {
      return `
        <div class="pin-container">
          <div class="pin-label">${title} — القسم رقم ${compartment}</div>
          <div class="pin-code" dir="ltr">${esc(S.pinCode)}</div>
          <div class="pin-timer">ينتهي خلال <span data-to="${ps.expiresAt}">${FZ.fmtCountdown(ps.expiresAt - FZ.now())}</span></div>
        </div>
        <p class="hint">أدخل الرمز في لوحة أرقام الصندوق ثم اضغط <b>#</b>. الرمز يُستخدم مرة واحدة فقط.</p>`;
    }
    const note = ps.kind === "expired" ? `<p class="hint warn">انتهت صلاحية الرمز السابق — أنشئ رمزاً جديداً.</p>` : "";
    const disabled = FZ.box.online ? "" : "disabled";
    const label = type === "pickup" ? "أنا عند الصندوق — أنشئ رمز الاستلام" : "أنشئ رمز الإرجاع";
    return `${note}
      <button class="btn btn-accent btn-block" data-action="pin" data-type="${type}" ${disabled}>${label}</button>
      ${FZ.box.online ? `<p class="hint">الرمز صالح لمدة 10 دقائق فقط، لذا أنشئه وأنت عند الصندوق.</p>` : `<p class="hint warn">لا يمكن إنشاء رمز والصندوق غير متصل.</p>`}`;
  }

  function row(k, v) { return `<div class="kv"><span>${k}</span><strong>${v}</strong></div>`; }

  function renderRental() {
    const el = $("rentalPanel");
    $("toolsPanel").style.display = S.rentalId ? "none" : "";
    if (!S.rentalId) { el.innerHTML = ""; lastPhase = ""; return; }
    const r = S.rental;
    if (!r) { el.innerHTML = `<div class="card"><div class="loader small"></div></div>`; return; }
    lastPhase = phaseKey();

    const head = `<div class="rental-head"><h2 class="section-title">${esc(r.toolName)}</h2>${FZ.badge(FZ.STATUS, r.status)}</div>`;
    const summary = `<div class="kv-list">
        ${row("المدة", FZ.planLabel(r.hours))}
        ${row("المبلغ", money(r.amount))}
        ${row("رقم القسم", r.compartment)}
      </div>`;
    let body = "";

    if (r.status === "pending") {
      const accounts = (PAYMENT_INFO.accounts || []).map(a =>
        `<p><strong>${esc(a.label)}:</strong> <span class="account-number">${esc(a.value)}</span></p>`).join("");
      body = `
        <div class="payment-info">
          <p>حوّل <strong>${money(r.amount)}</strong> إلى أحد الحسابات التالية:</p>
          ${accounts}
          <p class="mt-12">اكتب هذا <strong>الرمز المرجعي</strong> في ملاحظة/وصف التحويل:</p>
          <div class="ref-code" dir="ltr">${esc(r.ref)}</div>
        </div>
        ${r.paymentClaimedAt
          ? `<div class="banner banner-info">تم إبلاغ المسؤول بالتحويل (${FZ.fmtTime(r.paymentClaimedAt)}). سيتم التحقق والموافقة قريباً.</div>`
          : `<button class="btn btn-accent btn-block" data-action="claim">حوّلت المبلغ ✔</button>`}
        <button class="btn btn-whatsapp btn-block" data-action="whatsapp">احفظ بيانات حجزك عبر واتساب 📲</button>
        ${r.paymentClaimedAt ? "" : `<button class="btn-link mt-12" data-action="cancel">إلغاء الطلب</button>`}`;
    } else if (r.status === "paid") {
      body = `
        <div class="banner banner-success">تم تأكيد الدفع ✅ توجّه إلى الصندوق لاستلام الأداة من <b>القسم رقم ${r.compartment}</b>.</div>
        <p class="hint">مدة الاستئجار تبدأ لحظة فتح القسم.</p>
        ${pinBlock("pickup", r.compartment)}`;
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
        due = `<div class="banner banner-warn"><strong>⏰ انتهت مدة الاستئجار!</strong>
            أرجع الأداة الآن. ستُسجَّل رسوم تأخير بعد
            <b data-to="${r.dueAt + FZ.GRACE}">${FZ.fmtCountdown(r.dueAt + FZ.GRACE - t)}</b>.</div>`;
      } else {
        const fee = FZ.lateFeeFor(r, S.tools[r.toolId], t);
        due = `<div class="banner banner-danger"><strong>متأخر في الإرجاع!</strong>
            رسوم التأخير حتى الآن: <b>${money(fee)}</b> وتزيد كل ساعة.
            لن تتمكن من الاستئجار مجدداً حتى تسويتها.</div>`;
      }
      body = `${due}
        <h3 class="sub-title">إرجاع الأداة</h3>
        <p class="hint">ضع الأداة في <b>القسم رقم ${r.compartment}</b> بعد فتحه بالرمز، ثم أغلق الباب.</p>
        ${pinBlock("return", r.compartment)}`;
    }

    el.innerHTML = `<div class="card rental-card">${head}${summary}${body}</div>`;
  }

  // مفتاح يتغير عند تجاوز حدّ زمني (انتهاء رمز / انتهاء المدة / انتهاء السماح) لإعادة الرسم
  function phaseKey() {
    const r = S.rental; if (!r) return "";
    const t = FZ.now();
    const pinValid = S.pin && !S.pin.used && S.pin.createdAt + FZ.PIN_TTL > t;
    const duePhase = r.dueAt ? (t < r.dueAt ? 0 : t < r.dueAt + FZ.GRACE ? 1 : 2) : -1;
    return `${r.status}|${pinValid}|${duePhase}`;
  }

  function renderTools() {
    const grid = $("toolsGrid");
    const ids = Object.keys(S.tools).sort((a, b) => (S.tools[a].compartment || 0) - (S.tools[b].compartment || 0));
    if (!ids.length) { grid.innerHTML = `<p class="muted">لا توجد أدوات بعد.</p>`; return; }
    const blocked = (S.state.lateFeeDue || 0) > 0;
    grid.innerHTML = ids.map(id => {
      const t = S.tools[id];
      const plans = Object.values(t.plans || {}).sort((a, b) => a.hours - b.hours);
      const from = plans.length ? plans[0].amount : null;
      const avail = t.status === "available";
      return `<div class="tool-card ${avail ? "" : "is-off"}">
          <div class="tool-info">
            <h3>${esc(t.name)}</h3>
            <p class="tool-price">يبدأ من: <span>${money(from)} / ${plans.length ? FZ.planLabel(plans[0].hours) : ""}</span></p>
            ${avail ? "" : `<div class="mt-6">${FZ.badge(FZ.TOOL_STATUS, t.status)}</div>`}
          </div>
          <button class="btn btn-accent" data-action="select" data-tool="${esc(id)}" ${avail && !blocked ? "" : "disabled"}>احجز الآن</button>
        </div>`;
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
        <li>أداة واحدة فقط لكل طالب في نفس الوقت.</li>
        <li>بعد انتهاء المدة لديك ساعة سماح، بعدها تُسجَّل رسوم تأخير (${money(t.lateFeePerHour)} لكل ساعة) ويُمنع الاستئجار حتى تسويتها.</li>
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
    const list = S.history.filter(h => h.id !== S.rentalId).slice(0, 5);
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
    const a = btn.dataset.action;
    if (a === "select") {
      S.selectedTool = btn.dataset.tool;
      renderPlans();
      $("step-tools").classList.remove("active");
      $("step-plan").classList.add("active");
    } else if (a === "book") {
      await FZ.withBusy(btn, createRental);
    } else if (a === "claim") {
      await FZ.withBusy(btn, () => FZ.db.ref(`rentals/${S.rentalId}/paymentClaimedAt`).set(FZ.TS)
        .then(() => FZ.toast("تم إبلاغ المسؤول، انتظر الموافقة", "success"))
        .catch(err => FZ.toast(FZ.authError(err), "error")));
    } else if (a === "cancel") {
      if (!confirm("هل تريد إلغاء الطلب؟")) return;
      await FZ.withBusy(btn, () => FZ.db.ref().update({
        [`rentals/${S.rentalId}/status`]: "cancelled",
        [`users/${S.user.uid}/state/activeRental`]: null
      }).catch(err => FZ.toast(FZ.authError(err), "error")));
    } else if (a === "pin") {
      await FZ.withBusy(btn, () => generatePin(btn.dataset.type));
    } else if (a === "whatsapp") {
      sendToWhatsApp();
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
        [`users/${S.user.uid}/state/activeRental`]: rid
      });
      goTools();
      FZ.toast("تم إنشاء الطلب — حوّل المبلغ مع الرمز المرجعي", "success");
    } catch (err) {
      FZ.toast("تعذّر إنشاء الطلب: قد تكون الأداة لم تعد متاحة، أو لديك طلب قائم أو رسوم غير مسددة.", "error");
    }
  }

  function randomPin() {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return String(a[0] % 1000000).padStart(6, "0");
  }

  async function generatePin(type) {
    const r = S.rental;
    if (!r) return;
    if (!FZ.box.online) return FZ.toast("الصندوق غير متصل حالياً", "error");
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = randomPin();
      try {
        await FZ.db.ref().update({
          [`pins/${code}`]: {
            uid: S.user.uid, rentalId: S.rentalId, compartment: r.compartment,
            type, createdAt: FZ.TS, used: false
          },
          [`rentals/${S.rentalId}/currentPin`]: code
        });
        return; // نجح — المستمع سيعرض الرمز
      } catch (err) { /* غالباً تعارض مع رمز آخر فعّال — نجرب رقماً آخر */ }
    }
    FZ.toast("تعذّر إنشاء الرمز. تأكد أن الصندوق متصل وحاول مجدداً.", "error");
  }

  function sendToWhatsApp() {
    const r = S.rental;
    if (!r || !S.profile) return;
    const msg = `*تفاصيل حجز صندوق فزعة* ⚡\n\n` +
      `*الأداة:* ${r.toolName}\n*الاسم:* ${S.profile.name}\n*الرقم الجامعي:* ${S.profile.universityId}\n` +
      `*المدة:* ${FZ.planLabel(r.hours)}\n*المبلغ:* ${money(r.amount)}\n*الرمز المرجعي للتحويل:* ${r.ref}\n\n` +
      `شكراً لاستخدامك صندوق فزعة!`;
    window.open(`https://wa.me/968${S.profile.phone}?text=${encodeURIComponent(msg)}`, "_blank");
  }

  // -------------------- العدّادات --------------------
  let alerted = "";
  FZ.startCountdowns(() => {
    if (!S.rental) return;
    if (phaseKey() !== lastPhase) {
      renderRental(); renderAlerts();
      const r = S.rental;
      if (r.status === "active" && FZ.now() >= r.dueAt && alerted !== S.rentalId) {
        alerted = S.rentalId;
        FZ.toast("⏰ انتهت مدة الاستئجار — أرجع الأداة الآن", "error");
      }
    }
  });
})();
