// =====================================================================
//  admin.js — لوحة المسؤول: الموافقة على الدفع، المتابعة، الرسوم، محاكي الصندوق
// =====================================================================
(() => {
  const $ = id => document.getElementById(id);
  const { esc, money } = FZ;

  // البيانات الأولية للأدوات (تُكتب عند الضغط على "تهيئة الأدوات"). المبالغ بالبيسة.
  const DEFAULT_TOOLS = {
    calculator: {
      name: "آلة حاسبة علمية (Casio fx-991)", compartment: 1, status: "available", lateFeePerHour: 300,
      plans: { h1: { hours: 1, amount: 300 }, h2: { hours: 2, amount: 600 }, h3: { hours: 3, amount: 900 }, day: { hours: 24, amount: 1500 } }
    },
    typec: {
      name: "كيبل شحن 3 في 1 (Type-C / Lightning / Micro)", compartment: 2, status: "available", lateFeePerHour: 200,
      plans: { h1: { hours: 1, amount: 200 }, h2: { hours: 2, amount: 400 }, h3: { hours: 3, amount: 600 }, day: { hours: 24, amount: 1000 } }
    }
  };

  const S = { rentals: {}, users: {}, tools: {}, pins: {}, opened: {}, editingTool: null };
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
  // الدخول بحساب Google
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
        FZ.toast(FZ.authError(err), "error");
      }
    });
  });
  FZ.auth.getRedirectResult().catch(err => FZ.toast(FZ.authError(err), "error"));

  $("forgotBtn").addEventListener("click", async () => {
    const email = $("loginEmail").value.trim();
    if (!email) return FZ.toast("اكتب بريدك الإلكتروني أولاً", "error");
    try {
      await FZ.auth.sendPasswordResetEmail(email);
      FZ.toast("أرسلنا رابط إعادة تعيين كلمة المرور إلى بريدك", "success");
    } catch (err) { FZ.toast(FZ.authError(err), "error"); }
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
    listen("rentals", FZ.db.ref("rentals").limitToLast(300), v => { Object.values(v).forEach(FZ.withDue); S.rentals = v; });
    listen("users", FZ.db.ref("users"), v => S.users = v);
    listen("tools", FZ.db.ref("tools"), v => S.tools = v);
    listen("pins", FZ.db.ref("pins").orderByChild("createdAt").limitToLast(30), v => S.pins = v);
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
    renderFees(); renderTools(); renderHistory(); renderCompartments(); renderUsers(); renderUnlocks();
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
            ${r.paymentClaimedAt ? ` · <span class="badge badge-paid">الطالب أكّد التحويل</span>` : ""}</div>
          ${r.receiptUrl ? `<a class="receipt-link" href="${esc(r.receiptUrl)}" target="_blank" rel="noopener">🧾 عرض الإيصال</a>` : `<div class="muted small">لم يُرفع إيصال بعد</div>`}
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
        <div class="muted small">تمت الموافقة: ${FZ.fmtTime(r.paidAt)} · ${FZ.planLabel(r.hours)} · ${money(r.amount)}
          ${r.approvedBy === "auto-receipt" ? ` · <span class="badge badge-pending">تلقائي بالإيصال</span>` : ""}</div>
        ${r.receiptUrl ? `<a class="receipt-link" href="${esc(r.receiptUrl)}" target="_blank" rel="noopener">🧾 عرض الإيصال</a>` : ""}
        <div class="actions">
          ${r.receiptUrl ? `<button class="btn btn-sm btn-danger" data-action="rejectReceipt" data-id="${r.id}">✖ رفض الإيصال</button>` : ""}
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

  const PLAN_KEYS = [["h1", 1], ["h2", 2], ["h3", 3], ["day", 24]];

  const NEW_TOOL = "__new__";
  function nextCompartment() {
    return Object.values(S.tools).reduce((m, t) => Math.max(m, t.compartment || 0), 0) + 1;
  }

  function toolForm(id, t) {
    const isNew = id === NEW_TOOL;
    const plans = t.plans || {};
    return `<form class="admin-card tool-edit" data-tool-form="${id}">
        <div class="admin-card-top"><b>${isNew ? "➕ أداة جديدة" : "تعديل: " + esc(t.name)}</b>${isNew ? "" : FZ.badge(FZ.TOOL_STATUS, t.status)}</div>
        <div class="form-group">
          <label>اسم الأداة</label>
          <input class="form-control" name="name" value="${esc(t.name || "")}" placeholder="مثال: باور بانك 10000mAh" minlength="2" maxlength="80" required>
        </div>
        <div class="form-group">
          <label>رقم القسم / المكان</label>
          <input class="form-control" type="number" min="1" step="1" name="compartment" value="${t.compartment || nextCompartment()}" required>
        </div>
        <p class="muted small">المبالغ بالبيسة (1000 بيسة = 1 ريال)</p>
        <div class="price-grid">
          ${PLAN_KEYS.map(([k, h]) => `<label>${FZ.planLabel(h)}
              <input class="form-control" type="number" min="0" step="50" name="${k}" value="${plans[k] ? plans[k].amount : ""}" required></label>`).join("")}
          <label>رسوم التأخير / ساعة
            <input class="form-control" type="number" min="0" step="50" name="lateFeePerHour" value="${t.lateFeePerHour ?? 0}" required></label>
        </div>
        <div class="actions">
          <button class="btn btn-sm" type="submit">💾 حفظ</button>
          <button class="btn btn-sm btn-ghost" type="button" data-action="toolEditCancel">إلغاء</button>
          ${!isNew && (t.status === "available" || t.status === "maintenance")
            ? `<button class="btn btn-sm btn-danger" type="button" data-action="toolDelete" data-id="${id}">🗑 حذف الأداة</button>` : ""}
        </div>
      </form>`;
  }

  function renderTools(force) {
    if (S.editingTool && !force) return; // لا نمسح ما يكتبه المسؤول أثناء التعديل
    const ids = Object.keys(S.tools).sort((a, b) => S.tools[a].compartment - S.tools[b].compartment);
    const addBox = S.editingTool === NEW_TOOL
      ? toolForm(NEW_TOOL, { plans: {}, lateFeePerHour: 0 })
      : `<button class="btn btn-accent btn-block" data-action="toolAdd">➕ إضافة أداة جديدة</button>`;
    if (!ids.length) {
      $("secTools").innerHTML = `${empty("لا توجد أدوات في قاعدة البيانات.")}
        <div class="actions mb-12"><button class="btn btn-ghost btn-sm" data-action="seed">تهيئة الأدوات الافتراضية</button></div>${addBox}`;
      return;
    }
    $("secTools").innerHTML = addBox + ids.map(id => {
      const t = S.tools[id];
      if (S.editingTool === id) return toolForm(id, t);
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
          <div class="actions">
            <button class="btn btn-sm btn-accent" data-action="toolEdit" data-id="${id}">✏️ تعديل الاسم والأسعار</button>
            ${toggle}
          </div>
        </div>`;
    }).join("");
  }

  // -------------------- المستخدمون --------------------
  function userRows() {
    const counts = {};
    Object.values(S.rentals).forEach(r => {
      if (!counts[r.uid]) counts[r.uid] = { total: 0, done: 0 };
      counts[r.uid].total++;
      if (r.status === "returned") counts[r.uid].done++;
    });
    return Object.entries(S.users)
      .filter(([, u]) => u.profile)
      .map(([uid, u]) => {
        const p = u.profile, st = u.state || {};
        const ids = Object.values(st.activeByTool || {});
        if (st.activeRental && !ids.includes(st.activeRental)) ids.push(st.activeRental);
        const actives = ids.map(id => S.rentals[id]).filter(Boolean);
        return {
          uid, name: p.name, universityId: p.universityId, phone: p.phone, email: p.email,
          createdAt: p.createdAt, rentals: (counts[uid] || {}).total || 0,
          status: actives.length ? actives.map(x => (FZ.STATUS[x.status] || {}).label + " — " + x.toolName).join(" | ") : "لا يوجد حجز",
          fee: st.lateFeeDue || 0
        };
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function renderUsers() {
    const all = userRows();
    $("usersCount").textContent = all.length;
    const q = ($("usersSearch").value || "").trim().toLowerCase();
    const rows = q ? all.filter(u => [u.name, u.universityId, u.phone, u.email].join(" ").toLowerCase().includes(q)) : all;
    $("usersBody").innerHTML = rows.length ? rows.map(u => `<tr>
        <td><b>${esc(u.name)}</b></td>
        <td>${esc(u.universityId)}</td>
        <td><a href="https://wa.me/968${esc(u.phone)}" target="_blank" rel="noopener">${esc(u.phone)}</a></td>
        <td dir="ltr">${esc(u.email)}</td>
        <td>${FZ.fmtTime(u.createdAt)}</td>
        <td>${u.rentals}</td>
        <td>${esc(u.status)}</td>
        <td class="${u.fee ? "danger-text" : ""}">${u.fee ? money(u.fee) : "—"}</td>
      </tr>`).join("") : `<tr><td colspan="8" class="muted">لا يوجد مستخدمون${q ? " مطابقون للبحث" : ""}.</td></tr>`;
  }
  $("usersSearch").addEventListener("input", renderUsers);

  // ملف CSV بترميز UTF-8 مع BOM حتى يفتح العربي صحيحاً في Excel و Google Sheets
  function downloadCsv(filename, header, rows) {
    const cell = v => {
      const s = String(v ?? "");
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = "\uFEFF" + [header, ...rows].map(r => r.map(cell).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const fmtDate = ts => ts ? new Date(ts).toLocaleString("en-GB", { timeZone: "Asia/Muscat" }) : "";
  const today = () => new Date().toISOString().slice(0, 10);
  const textCell = v => (v ? `\u200E${v}` : ""); // يمنع Excel من حذف الأصفار أو تحويل الأرقام

  function exportUsers() {
    const rows = userRows().map(u => [u.name, textCell(u.universityId), textCell(u.phone), u.email,
      fmtDate(u.createdAt), u.rentals, u.status, (u.fee / 1000).toFixed(3)]);
    downloadCsv(`fazza-users-${today()}.csv`,
      ["الاسم", "الرقم الجامعي", "الهاتف", "الإيميل", "تاريخ التسجيل", "عدد الحجوزات", "الحالة الحالية", "رسوم مستحقة (ر.ع)"], rows);
  }

  function exportRentals() {
    const rows = Object.values(S.rentals).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(r => {
      const p = (S.users[r.uid] && S.users[r.uid].profile) || {};
      return [r.ref, p.name || "", textCell(p.universityId), textCell(p.phone), r.toolName, FZ.planLabel(r.hours),
        (r.amount / 1000).toFixed(3), (FZ.STATUS[r.status] || {}).label || r.status,
        fmtDate(r.createdAt), fmtDate(r.paidAt), fmtDate(r.startAt), fmtDate(r.dueAt), fmtDate(r.returnedAt),
        r.lateFee ? (r.lateFee / 1000).toFixed(3) : "", r.lateFee ? (r.lateFeePaid ? "نعم" : "لا") : ""];
    });
    downloadCsv(`fazza-rentals-${today()}.csv`,
      ["الرمز المرجعي", "الاسم", "الرقم الجامعي", "الهاتف", "الأداة", "المدة", "المبلغ (ر.ع)", "الحالة",
       "تاريخ الطلب", "تاريخ الموافقة", "الاستلام", "موعد الإرجاع", "الإرجاع الفعلي", "رسوم التأخير (ر.ع)", "مسددة؟"], rows);
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
            ...clearActive(r, id)
          });
        } else if (a === "rejectReceipt") {
          if (!confirm(`رفض إيصال ${r.ref}؟ سيُلغى الحجز وتعود الأداة متاحة.`)) return;
          await FZ.db.ref().update({
            [`rentals/${id}/status`]: "rejected",
            [`tools/${r.toolId}/status`]: "available",
            ...clearActive(r, id)
          });
          FZ.toast("تم رفض الإيصال وإلغاء الحجز", "success");
        } else if (a === "cancelPaid") {
          if (!confirm("إلغاء هذا الحجز وإعادة الأداة متاحة؟")) return;
          await FZ.db.ref().update({
            [`rentals/${id}/status`]: "cancelled",
            [`tools/${r.toolId}/status`]: "available",
            ...clearActive(r, id)
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
        } else if (a === "exportUsers") {
          exportUsers();
        } else if (a === "exportRentals") {
          exportRentals();
        } else if (a === "toolAdd") {
          S.editingTool = NEW_TOOL; renderTools(true);
        } else if (a === "toolDelete") {
          const t = S.tools[id];
          if (!t || !(t.status === "available" || t.status === "maintenance")) throw new Error("لا يمكن حذف أداة محجوزة أو مستأجرة");
          if (!confirm(`حذف «${t.name}» نهائياً؟ الحجوزات السابقة تبقى في السجل.`)) return;
          await FZ.db.ref(`tools/${id}`).remove();
          S.editingTool = null; renderTools(true);
          FZ.toast("تم حذف الأداة", "success");
        } else if (a === "toolEdit") {
          S.editingTool = id; renderTools(true);
        } else if (a === "toolEditCancel") {
          S.editingTool = null; renderTools(true);
        } else if (a === "seed") {
          await FZ.db.ref("tools").set(DEFAULT_TOOLS);
          FZ.toast("تمت تهيئة الأدوات", "success");
        }
      });
    } catch (err) {
      FZ.toast(err.message && !err.code ? err.message : FZ.authError(err), "error");
    }
  });

  // حفظ تعديل الأداة (الاسم + الأسعار + رسوم التأخير)
  document.addEventListener("submit", async e => {
    const form = e.target.closest("[data-tool-form]");
    if (!form) return;
    e.preventDefault();
    const isNew = form.dataset.toolForm === NEW_TOOL;
    const id = isNew ? FZ.db.ref("tools").push().key : form.dataset.toolForm;
    const f = new FormData(form);
    const name = String(f.get("name") || "").trim();
    if (name.length < 2) return FZ.toast("اكتب اسم الأداة", "error");
    const compartment = parseInt(f.get("compartment"), 10);
    if (!(compartment >= 1)) return FZ.toast("اكتب رقم القسم", "error");
    const upd = {
      [`tools/${id}/name`]: name,
      [`tools/${id}/compartment`]: compartment,
      [`tools/${id}/lateFeePerHour`]: Math.max(0, parseInt(f.get("lateFeePerHour"), 10) || 0)
    };
    if (isNew) upd[`tools/${id}/status`] = "available";
    for (const [k, h] of PLAN_KEYS) {
      const amount = parseInt(f.get(k), 10);
      if (!(amount >= 0)) return FZ.toast("تأكد من كل الأسعار", "error");
      upd[`tools/${id}/plans/${k}`] = { hours: h, amount };
    }
    await FZ.withBusy(form.querySelector("[type=submit]"), async () => {
      try {
        await FZ.db.ref().update(upd);
        S.editingTool = null; renderTools(true);
        FZ.toast(isNew ? "تمت إضافة الأداة ✅ تظهر للطلاب مباشرة" : "تم حفظ التعديلات ✅ تظهر للطلاب مباشرة", "success");
      } catch (err) { FZ.toast(FZ.authError(err), "error"); }
    });
  });

  // =====================================================================
  //  منطق الصندوق — نفس الخطوات التي يجب أن ينفّذها ESP32 عند إدخال رمز
  // =====================================================================
  // إزالة الحجز من قائمة الحجوزات النشطة للطالب (حجز لكل أداة + دعم الصيغة القديمة)
  function clearActive(r, rid) {
    const out = { [`users/${r.uid}/state/activeByTool/${r.toolId}`]: null };
    const st = (S.users[r.uid] && S.users[r.uid].state) || {};
    if (st.activeRental === rid) out[`users/${r.uid}/state/activeRental`] = null;
    return out;
  }

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
      ...clearActive(r, rid)
    };
    if (fee > 0) {
      upd[`rentals/${rid}/lateFeePaid`] = false;
      upd[`users/${r.uid}/state/lateFeeDue`] = firebase.database.ServerValue.increment(fee);
    }
    await FZ.db.ref().update(upd);
    return fee;
  }

  async function processPin(code) {
    if (!/^\d{6}$/.test(code)) return { ok: false, msg: "طلب غير صالح" };
    if (!FZ.box.online) return { ok: false, msg: "الصندوق غير متصل — لا تُنفَّذ طلبات الفتح" };
    const p = (await FZ.db.ref(`pins/${code}`).get()).val();
    if (!p) return { ok: false, msg: "رمز غير صحيح" };
    if (p.used) return { ok: false, msg: "الرمز مستخدم مسبقاً" };
    const t = FZ.now();
    if (t - p.createdAt > FZ.UNLOCK_TTL) return { ok: false, msg: "انتهت مهلة الطلب (أكثر من دقيقة)" };
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

  // -------------------- طلبات فتح الصندوق --------------------
  const handled = new Set();
  function pendingUnlocks() {
    const t = FZ.now();
    return Object.entries(S.pins || {})
      .filter(([, p]) => p && !p.used && t - p.createdAt <= FZ.UNLOCK_TTL)
      .map(([code, p]) => ({ code, ...p }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  function renderUnlocks() {
    const el = $("unlockList");
    if (!el) return;
    const list = pendingUnlocks();
    el.innerHTML = list.length ? list.map(p => {
      const r = S.rentals[p.rentalId] || {};
      const prof = (S.users[p.uid] && S.users[p.uid].profile) || {};
      return `<div class="unlock-item">
          <div><b>${p.type === "pickup" ? "استلام" : "إرجاع"} — القسم ${p.compartment}</b>
            <div class="small">${esc(prof.name || "")} · ${esc(r.toolName || "")}</div></div>
          <button class="btn btn-sm btn-accent" data-action="runUnlock" data-code="${p.code}">تنفيذ</button>
        </div>`;
    }).join("") : `<div class="muted small unlock-empty">لا توجد طلبات فتح الآن.</div>`;
  }

  async function runUnlock(code) {
    if (handled.has(code)) return;
    handled.add(code);
    const res = await processPin(code).catch(err => ({ ok: false, msg: "خطأ: " + FZ.authError(err) }));
    $("kpResult").textContent = res.msg;
    $("kpResult").className = `keypad-result ${res.ok ? "ok" : "bad"}`;
    if (res.ok) {
      S.opened[res.compartment] = true; renderCompartments();
      setTimeout(() => { S.opened[res.compartment] = false; renderCompartments(); }, 5000); // يُقفل تلقائياً
    }
  }

  document.addEventListener("click", e => {
    const b = e.target.closest('[data-action="runUnlock"]');
    if (b) runUnlock(b.dataset.code);
  });

  // في وضع المحاكاة تُنفَّذ الطلبات تلقائياً كما ستفعل الشريحة
  setInterval(() => {
    renderUnlocks();
    if ($("simBeat") && $("simBeat").checked) pendingUnlocks().forEach(p => runUnlock(p.code));
  }, 1500);

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
