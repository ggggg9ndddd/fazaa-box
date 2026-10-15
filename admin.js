// =====================================================================
//  admin.js — لوحة المسؤول: الموافقة على الدفع، المتابعة، الرسوم، محاكي الصندوق
// =====================================================================
(() => {
  const $ = id => document.getElementById(id);
  const { esc, money } = FZ;

  // البيانات الأولية للأدوات (تُكتب عند الضغط على "تهيئة الأدوات"). المبالغ بالبيسة.
  const DEFAULT_TOOLS = {
    calculator: {
      name: "آلة حاسبة علمية (Casio)", compartment: 1, status: "available", lateFeePerHour: 300,
      plans: { h1: { hours: 1, amount: 300 }, h2: { hours: 2, amount: 600 }, h3: { hours: 3, amount: 900 }, day: { hours: 24, amount: 1500 } }
    },
    typec: {
      name: "وصلة Type-C", compartment: 2, status: "available", lateFeePerHour: 200,
      plans: { h1: { hours: 1, amount: 200 }, h2: { hours: 2, amount: 400 }, h3: { hours: 3, amount: 600 }, day: { hours: 24, amount: 1000 } }
    }
  };

  const S = { rentals: {}, users: {}, tools: {}, pins: {}, opened: {} };
  const refs = [];

  function show(view) {
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === view));
  }
  if (!FZ.ready) { show("view-setup"); return; }

  FZ.watchBox(() => { FZ.renderBoxPill($("boxStatus")); renderStats(); });

  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    await FZ.withBusy(e.submitter, async () => {
      try { await FZ.auth.signInWithEmailAndPassword($("loginEmail").value.trim(), $("loginPassword").value); }
      catch (err) { FZ.toast(FZ.authError(err), "error"); }
    });
  });
  document.querySelectorAll(".js-logout").forEach(b => b.addEventListener("click", () => FZ.auth.signOut()));

  FZ.auth.onAuthStateChanged(async user => {
    refs.forEach(r => r.off()); refs.length = 0;
    if (!user) { show("view-auth"); return; }
    show("view-loading");
    const isAdmin = (await FZ.db.ref(`admins/${user.uid}`).get().catch(() => null))?.val() === true;
    if (!isAdmin) { $("deniedUid").textContent = user.uid; show("view-denied"); return; }
    $("adminEmail").textContent = user.email;
    show("view-main");
    listen("rentals", FZ.db.ref("rentals").limitToLast(300), v => S.rentals = v);
    listen("users", FZ.db.ref("users"), v => S.users = v);
    listen("tools", FZ.db.ref("tools"), v => S.tools = v);
  });

  function listen(name, ref, set) {
    refs.push(ref);
    ref.on("value", s => { set(s.val() || {}); renderAll(); }, err => FZ.toast(FZ.authError(err), "error"));
  }

  // -------------------- العرض --------------------
  const list = status => Object.entries(S.rentals)
    .filter(([, r]) => r.status === status)
    .map(([id, r]) => ({ id, ...r }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  function student(uid) {
    const p = (S.users[uid] && S.users[uid].profile) || {};
    return `<div class="student">
        <b>${esc(p.name || "—")}</b>
        <span class="muted small">رقم جامعي: ${esc(p.universityId || "—")}</span>
        ${p.phone ? `<a class="small" href="https://wa.me/968${esc(p.phone)}" target="_blank" rel="noopener">واتساب ${esc(p.phone)}</a>` : ""}
      </div>`;
  }

  function renderAll() {
    renderStats();
    renderPending(); renderPaid(); renderActive();
    renderFees(); renderTools(); renderHistory(); renderCompartments();
  }

  function renderStats() {
    if (!$("stats")) return;
    const c = s => list(s).length;
    $("stats").innerHTML = `
      <div class="stat"><b>${c("pending")}</b><span>بانتظار الدفع</span></div>
      <div class="stat"><b>${c("paid")}</b><span>بانتظار الاستلام</span></div>
      <div class="stat"><b>${c("active")}</b><span>مستأجرة</span></div>
      <div class="stat ${FZ.box.online ? "ok" : "bad"}"><b>${FZ.box.online ? "متصل" : "غير متصل"}</b><span>الصندوق</span></div>`;
  }

  function empty(msg) { return `<p class="muted small empty">${msg}</p>`; }

  function renderPending() {
    const items = list("pending");
    $("secPending").innerHTML = items.length ? items.map(r => {
      const tool = S.tools[r.toolId] || {};
      const canApprove = tool.status === "available";
      return `<div class="admin-card">
          <div class="admin-card-top">
            <div class="ref-code small-code" dir="ltr">${esc(r.ref)}</div>
            <div class="amount">${money(r.amount)}</div>
          </div>
          ${student(r.uid)}
          <div class="small">${esc(r.toolName)} · ${FZ.planLabel(r.hours)} · القسم ${r.compartment}</div>
          <div class="muted small">طُلب: ${FZ.fmtTime(r.createdAt)}
            ${r.paymentClaimedAt ? ` · <span class="badge badge-paid">الطالب أكّد التحويل</span>` : ` · لم يؤكد التحويل بعد`}</div>
          <div class="actions">
            <button class="btn btn-sm" data-action="approve" data-id="${r.id}" ${canApprove ? "" : "disabled"}>✔ تم استلام المبلغ</button>
            <button class="btn btn-sm btn-ghost" data-action="reject" data-id="${r.id}">✖ رفض</button>
          </div>
          ${canApprove ? "" : `<div class="small danger-text">لا يمكن الموافقة: الأداة حالياً «${esc((FZ.TOOL_STATUS[tool.status] || {}).label || tool.status)}».</div>`}
        </div>`;
    }).join("") : empty("لا توجد طلبات.");
  }

  function renderPaid() {
    const items = list("paid");
    $("secPaid").innerHTML = items.length ? items.map(r => `
      <div class="admin-card">
        <div class="admin-card-top"><b>${esc(r.toolName)}</b><span class="muted small">القسم ${r.compartment}</span></div>
        ${student(r.uid)}
        <div class="muted small">تمت الموافقة: ${FZ.fmtTime(r.paidAt)} · ${FZ.planLabel(r.hours)}</div>
        <div class="actions">
          <button class="btn btn-sm btn-ghost" data-action="cancelPaid" data-id="${r.id}">إلغاء (لم يحضر)</button>
        </div>
      </div>`).join("") : empty("لا يوجد.");
  }

  function renderActive() {
    const t = FZ.now();
    const items = list("active");
    $("secActive").innerHTML = items.length ? items.map(r => {
      let due;
      if (t < r.dueAt) due = `متبقي <b data-to="${r.dueAt}">${FZ.fmtCountdown(r.dueAt - t)}</b>`;
      else if (t < r.dueAt + FZ.GRACE) due = `<span class="warn-text">انتهت المدة — ساعة السماح (<b data-to="${r.dueAt + FZ.GRACE}"></b>)</span>`;
      else due = `<span class="danger-text">متأخر! الرسوم الحالية ${money(FZ.lateFeeFor(r, S.tools[r.toolId], t))}</span>`;
      return `<div class="admin-card ${t > r.dueAt ? "is-late" : ""}">
          <div class="admin-card-top"><b>${esc(r.toolName)}</b><span class="muted small">القسم ${r.compartment}</span></div>
          ${student(r.uid)}
          <div class="small">استُلمت: ${FZ.fmtTime(r.startAt)} · الإرجاع: ${FZ.fmtTime(r.dueAt)}</div>
          <div class="small">${due}</div>
          <div class="actions">
            <button class="btn btn-sm btn-ghost" data-action="manualReturn" data-id="${r.id}">تسجيل إرجاع يدوي</button>
          </div>
        </div>`;
    }).join("") : empty("لا توجد أدوات مستأجرة.");
  }

  function renderFees() {
    const users = Object.entries(S.users).filter(([, u]) => u.state && u.state.lateFeeDue > 0);
    $("secFees").innerHTML = users.length ? users.map(([uid, u]) => `
      <div class="admin-card is-late">
        <div class="admin-card-top">${student(uid)}<div class="amount">${money(u.state.lateFeeDue)}</div></div>
        <div class="actions"><button class="btn btn-sm" data-action="settle" data-uid="${uid}">✔ تمت التسوية</button></div>
      </div>`).join("") : empty("لا توجد رسوم مستحقة.");
  }

  function renderTools() {
    const ids = Object.keys(S.tools).sort((a, b) => S.tools[a].compartment - S.tools[b].compartment);
    if (!ids.length) {
      $("secTools").innerHTML = `${empty("لا توجد أدوات في قاعدة البيانات.")}
        <button class="btn btn-accent btn-sm" data-action="seed">تهيئة الأدوات الافتراضية</button>`;
      return;
    }
    $("secTools").innerHTML = ids.map(id => {
      const t = S.tools[id];
      const plans = Object.values(t.plans || {}).sort((a, b) => a.hours - b.hours)
        .map(p => `${FZ.planLabel(p.hours)}: ${money(p.amount)}`).join(" · ");
      const toggle = t.status === "available"
        ? `<button class="btn btn-sm btn-ghost" data-action="toolStatus" data-id="${id}" data-status="maintenance">إيقاف للصيانة</button>`
        : t.status === "maintenance"
          ? `<button class="btn btn-sm" data-action="toolStatus" data-id="${id}" data-status="available">إتاحة</button>` : "";
      return `<div class="admin-card">
          <div class="admin-card-top"><b>${esc(t.name)}</b>${FZ.badge(FZ.TOOL_STATUS, t.status)}</div>
          <div class="small">القسم ${t.compartment} · رسوم التأخير ${money(t.lateFeePerHour)}/ساعة</div>
          <div class="muted small">${plans}</div>
          <div class="actions">${toggle}</div>
        </div>`;
    }).join("");
  }

  function renderHistory() {
    const items = Object.entries(S.rentals)
      .filter(([, r]) => ["returned", "cancelled", "rejected"].includes(r.status))
      .map(([id, r]) => ({ id, ...r }))
      .sort((a, b) => (b.returnedAt || b.createdAt || 0) - (a.returnedAt || a.createdAt || 0))
      .slice(0, 15);
    $("secHistory").innerHTML = items.length ? `<div class="history">${items.map(r => {
      const p = (S.users[r.uid] && S.users[r.uid].profile) || {};
      return `<div class="history-item">
          <div><b>${esc(r.toolName)}</b><div class="muted small">${esc(p.name || "")} · ${esc(r.ref)}</div></div>
          <div class="text-end">${FZ.badge(FZ.STATUS, r.status)}
            ${r.lateFee ? `<div class="small danger-text">تأخير ${money(r.lateFee)}${r.lateFeePaid ? " ✔" : ""}</div>` : ""}</div>
        </div>`;
    }).join("")}</div>` : empty("لا يوجد سجل بعد.");
  }

  function renderCompartments() {
    const ids = Object.values(S.tools).sort((a, b) => a.compartment - b.compartment);
    $("compartments").innerHTML = ids.map(t =>
      `<div class="compartment ${S.opened[t.compartment] ? "open" : ""}">
         <span>القسم ${t.compartment}</span><b>${S.opened[t.compartment] ? "🔓 مفتوح" : "🔒 مغلق"}</b>
       </div>`).join("");
  }

  // -------------------- إجراءات المسؤول --------------------
  document.addEventListener("click", async e => {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.disabled) return;
    const a = btn.dataset.action, id = btn.dataset.id;
    const r = id ? S.rentals[id] : null;
    try {
      await FZ.withBusy(btn, async () => {
        if (a === "approve") {
          // التحقق مرة أخرى من الخادم بأن الأداة ما زالت متاحة
          const tSnap = await FZ.db.ref(`tools/${r.toolId}/status`).get();
          if (tSnap.val() !== "available") throw new Error("الأداة لم تعد متاحة");
          await FZ.db.ref().update({
            [`rentals/${id}/status`]: "paid",
            [`rentals/${id}/paidAt`]: FZ.TS,
            [`rentals/${id}/approvedBy`]: FZ.auth.currentUser.uid,
            [`tools/${r.toolId}/status`]: "reserved"
          });
          FZ.toast(`تمت الموافقة على ${r.ref}`, "success");
        } else if (a === "reject") {
          if (!confirm(`رفض الطلب ${r.ref}؟`)) return;
          await FZ.db.ref().update({
            [`rentals/${id}/status`]: "rejected",
            [`users/${r.uid}/state/activeRental`]: null
          });
        } else if (a === "cancelPaid") {
          if (!confirm("إلغاء هذا الحجز وإعادة الأداة متاحة؟")) return;
          await FZ.db.ref().update({
            [`rentals/${id}/status`]: "cancelled",
            [`tools/${r.toolId}/status`]: "available",
            [`users/${r.uid}/state/activeRental`]: null
          });
        } else if (a === "manualReturn") {
          if (!confirm("تأكيد أن الأداة أُعيدت إلى الصندوق؟")) return;
          const fee = await completeReturn(id);
          FZ.toast(fee ? `تم تسجيل الإرجاع مع رسوم تأخير ${money(fee)}` : "تم تسجيل الإرجاع", "success");
        } else if (a === "settle") {
          const uid = btn.dataset.uid;
          if (!confirm("تأكيد استلام رسوم التأخير؟")) return;
          const upd = { [`users/${uid}/state/lateFeeDue`]: 0 };
          Object.entries(S.rentals).forEach(([rid, x]) => {
            if (x.uid === uid && x.lateFee > 0 && !x.lateFeePaid) upd[`rentals/${rid}/lateFeePaid`] = true;
          });
          await FZ.db.ref().update(upd);
          FZ.toast("تمت التسوية — يمكن للطالب الاستئجار مجدداً", "success");
        } else if (a === "toolStatus") {
          await FZ.db.ref(`tools/${id}/status`).set(btn.dataset.status);
        } else if (a === "seed") {
          await FZ.db.ref("tools").set(DEFAULT_TOOLS);
          FZ.toast("تمت تهيئة الأدوات", "success");
        }
      });
    } catch (err) {
      FZ.toast(err.message && !err.code ? err.message : FZ.authError(err), "error");
    }
  });

  // =====================================================================
  //  منطق الصندوق — نفس الخطوات التي يجب أن ينفّذها ESP32 عند إدخال رمز
  // =====================================================================
  async function completeReturn(rid) {
    const r = (await FZ.db.ref(`rentals/${rid}`).get()).val();
    if (!r || r.status !== "active") throw new Error("العملية ليست في حالة استئجار نشط");
    const tool = (await FZ.db.ref(`tools/${r.toolId}`).get()).val();
    const t = FZ.now();
    const fee = FZ.lateFeeFor(r, tool, t);
    const upd = {
      [`rentals/${rid}/status`]: "returned",
      [`rentals/${rid}/returnedAt`]: FZ.TS,
      [`rentals/${rid}/lateFee`]: fee,
      [`tools/${r.toolId}/status`]: "available",
      [`users/${r.uid}/state/activeRental`]: null
    };
    if (fee > 0) {
      upd[`rentals/${rid}/lateFeePaid`] = false;
      upd[`users/${r.uid}/state/lateFeeDue`] = firebase.database.ServerValue.increment(fee);
    }
    await FZ.db.ref().update(upd);
    return fee;
  }

  async function processPin(code) {
    if (!/^\d{6}$/.test(code)) return { ok: false, msg: "الرمز يجب أن يكون 6 أرقام" };
    if (!FZ.box.online) return { ok: false, msg: "الصندوق غير متصل — الرموز لا تُقبل" };
    const p = (await FZ.db.ref(`pins/${code}`).get()).val();
    if (!p) return { ok: false, msg: "رمز غير صحيح" };
    if (p.used) return { ok: false, msg: "الرمز مستخدم مسبقاً" };
    const t = FZ.now();
    if (t - p.createdAt > FZ.PIN_TTL) return { ok: false, msg: "انتهت صلاحية الرمز" };
    const r = (await FZ.db.ref(`rentals/${p.rentalId}`).get()).val();
    if (!r || r.currentPin !== code) return { ok: false, msg: "الرمز غير مرتبط بعملية صالحة" };
    if (r.compartment !== p.compartment) return { ok: false, msg: "الرمز لا يخص هذا القسم" };
    if (p.type === "pickup" && r.status !== "paid") return { ok: false, msg: "العملية ليست جاهزة للاستلام" };
    if (p.type === "return" && r.status !== "active") return { ok: false, msg: "لا يوجد استئجار نشط لإرجاعه" };

    // حجز الرمز ذرّياً حتى لا يُستخدم مرتين
    const tx = await FZ.db.ref(`pins/${code}/used`).transaction(u => (u ? undefined : true));
    if (!tx.committed) return { ok: false, msg: "الرمز مستخدم مسبقاً" };
    await FZ.db.ref(`pins/${code}/usedAt`).set(FZ.TS);

    if (p.type === "pickup") {
      await FZ.db.ref().update({
        [`rentals/${p.rentalId}/status`]: "active",
        [`rentals/${p.rentalId}/startAt`]: FZ.TS,
        [`rentals/${p.rentalId}/dueAt`]: t + r.hours * FZ.HOUR,
        [`tools/${r.toolId}/status`]: "rented"
      });
      return { ok: true, compartment: r.compartment, msg: `✅ فُتح القسم ${r.compartment} — استلم الأداة` };
    }
    const fee = await completeReturn(p.rentalId);
    return { ok: true, compartment: r.compartment,
      msg: `✅ فُتح القسم ${r.compartment} — تم تسجيل الإرجاع${fee ? ` (رسوم تأخير ${money(fee)})` : ""}` };
  }

  // -------------------- لوحة الأرقام --------------------
  let entry = "";
  const screen = () => { $("kpScreen").textContent = (entry + "______").slice(0, 6); };
  $("keypad").addEventListener("click", async e => {
    const k = e.target.dataset.k;
    if (!k) return;
    if (k === "*") { entry = ""; screen(); $("kpResult").textContent = "تم المسح"; $("kpResult").className = "keypad-result"; return; }
    if (k === "#") {
      const code = entry; entry = ""; screen();
      $("kpResult").textContent = "جارٍ التحقق…"; $("kpResult").className = "keypad-result";
      try {
        const res = await processPin(code);
        $("kpResult").textContent = res.msg;
        $("kpResult").className = `keypad-result ${res.ok ? "ok" : "bad"}`;
        if (res.ok) {
          S.opened[res.compartment] = true; renderCompartments();
          setTimeout(() => { S.opened[res.compartment] = false; renderCompartments(); }, 5000); // يُقفل تلقائياً
        }
      } catch (err) {
        $("kpResult").textContent = "خطأ: " + FZ.authError(err);
        $("kpResult").className = "keypad-result bad";
      }
      return;
    }
    if (entry.length < 6) { entry += k; screen(); }
  });

  // -------------------- نبضة وهمية (اختبار بدون ESP32) --------------------
  let simTimer = null;
  function beat() { return FZ.db.ref("box/lastSeen").set(FZ.TS); }
  $("simBeat").addEventListener("change", e => {
    clearInterval(simTimer); simTimer = null;
    if (e.target.checked) { beat(); simTimer = setInterval(beat, 30000); }
  });

  FZ.startCountdowns();
  setInterval(() => { if (Object.keys(S.rentals).length) { renderActive(); } }, 30000);
})();
