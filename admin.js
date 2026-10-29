// =====================================================================
//  admin.js — لوحة المسؤول: الموافقة على الدفع، المتابعة، الرسوم، محاكي الصندوق
// =====================================================================
(() => {
  const $ = id => document.getElementById(id);
  const { esc, money } = FZ;

  // البيانات الأولية للأدوات (تُكتب عند الضغط على "تهيئة الأدوات"). المبالغ بالبيسة.
  const DEFAULT_TOOLS = {
    calculator: {
      name: "آلة حاسبة علمية (Casio fx-991)", compartment: 1, status: "available", lateFeePerHour: 1000,
      plans: { h1: { hours: 1, amount: 300 }, h2: { hours: 2, amount: 600 }, h3: { hours: 3, amount: 900 }, day: { hours: 24, amount: 1500 } }
    },
    typec: {
      name: "كيبل شحن 3 في 1 (Type-C / Lightning / Micro)", compartment: 2, status: "available", lateFeePerHour: 1000,
      plans: { h1: { hours: 1, amount: 200 }, h2: { hours: 2, amount: 400 }, h3: { hours: 3, amount: 600 }, day: { hours: 24, amount: 1000 } }
    }
  };

  const S = { rentals: {}, users: {}, tools: {}, pins: {}, admins: {}, opened: {}, editingTool: null };
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
    listen("admins", FZ.db.ref("admins"), v => S.admins = v);
    listen("toolCodes", FZ.db.ref("toolCodes"), v => S.codes = v);
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
    renderFees(); renderTools(); renderHistory(); renderCompartments(); renderUsers(); renderUnlocks(); renderAdmins();
  }

  function renderStats() {
    if (!$("stats")) return;
    const c = s => list(s).length;
    $("stats").innerHTML = `
      <div class="stat"><b>${c("pending")}</b><span>بانتظار الدفع</span></div>
      <div class="stat"><b>${c("paid")}</b><span>بانتظار الاستلام</span></div>
      <div class="stat"><b>${c("active")}</b><span>مستأجرة</span></div>
      <div class="stat ${FZ.box.online ? "ok" : "bad"}"><b>${!FZ.box.enabled ? "متوقف" : FZ.box.connected ? "متصل" : "غير متصل"}</b><span>الصندوق</span></div>`;
    renderBoxControl();
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
</div>
        ${r.receiptUrl ? `<a class="receipt-link" href="${esc(r.receiptUrl)}" target="_blank" rel="noopener">🧾 عرض الإيصال</a>` : ""}
        <div class="actions">
          ${r.receiptUrl ? `<button class="btn btn-sm btn-danger" data-action="rejectReceipt" data-id="${r.id}">✖ رفض الإيصال</button>` : ""}
          <button class="btn btn-sm btn-ghost" data-action="cancelPaid" data-id="${r.id}">إلغاء (لم يحضر)</button>
        </div>
      </div>`).join("") : empty("لا يوجد.");
  }

  function renderActive() {
    const t = FZ.now();
    const items = list("active").concat(list("returning"));
    $("secActive").innerHTML = items.length ? items.map(r => {
      let due;
      if (r.status === "returning") due = `<span class="warn-text">فُتح القسم للإرجاع ${FZ.fmtTime(r.returnedAt)} — بانتظار ضغط الطالب «تم الإرجاع»${r.lateFee ? ` · رسوم ${money(r.lateFee)}` : ""}</span>`;
      else if (t < r.dueAt) due = `متبقي <b data-to="${r.dueAt}">${FZ.fmtCountdown(r.dueAt - t)}</b>`;
      else due = `<span class="danger-text">متأخر! الرسوم الحالية ${money(FZ.lateFeeFor(r, S.tools[r.toolId], t))}</span>`;
      return `<div class="admin-card ${t > r.dueAt ? "is-late" : ""}">
          <div class="admin-card-top"><b>${esc(r.toolName)}</b><span class="muted small">القسم ${r.compartment}</span></div>
          ${student(r.uid)}
          <div class="small">استُلمت: ${FZ.fmtTime(r.startAt)} · الإرجاع: ${FZ.fmtTime(r.dueAt)}</div>
          <div class="small">${due}</div>
          <div class="actions">
            ${r.status === "active" ? `<button class="btn btn-sm btn-ghost" data-action="extend" data-id="${r.id}">⏱ تمديد / تقليل الوقت</button>` : ""}
            <button class="btn btn-sm btn-ghost" data-action="manualReturn" data-id="${r.id}">${r.status === "returning" ? "تأكيد الإرجاع" : "تسجيل إرجاع يدوي"}</button>
          </div>
        </div>`;
    }).join("") : empty("لا توجد أدوات مستأجرة.");
  }

  // -------------------- المشرفون --------------------
  function renderAdmins() {
    const me = FZ.auth.currentUser && FZ.auth.currentUser.uid;
    const ids = Object.keys(S.admins || {}).filter(id => S.admins[id] === true);
    $("secAdmins").innerHTML = ids.map(uid => {
      const p = (S.users[uid] && S.users[uid].profile) || {};
      const label = p.name ? `<b>${esc(p.name)}</b> <span class="muted small" dir="ltr">${esc(p.email || "")}</span>`
        : `<span class="muted small" dir="ltr">${esc(uid)}</span>`;
      return `<div class="admin-card admin-row">
          <div>${label}${uid === me ? ` <span class="badge badge-active">أنت</span>` : ""}</div>
          ${uid === me ? "" : `<button class="btn btn-sm btn-ghost" data-action="removeAdmin" data-uid="${esc(uid)}">إزالة</button>`}
        </div>`;
    }).join("") || empty("لا يوجد مشرفون.");
  }

  $("addAdminForm").addEventListener("submit", async e => {
    e.preventDefault();
    const q = $("adminInput").value.trim();
    if (!q) return;
    let uid = null;
    if (q.includes("@")) {
      const found = Object.entries(S.users).find(([, u]) => u.profile && (u.profile.email || "").toLowerCase() === q.toLowerCase());
      if (!found) return FZ.toast("ما لقيت مستخدم بهذا الإيميل — خلّه يسجّل دخول في موقع الحجز ويكمل بياناته أولاً", "error");
      uid = found[0];
    } else if (/^[A-Za-z0-9]{20,40}$/.test(q)) {
      uid = q;
    } else {
      return FZ.toast("اكتب إيميل صحيح أو رقم UID", "error");
    }
    if (S.admins && S.admins[uid] === true) return FZ.toast("هذا الشخص مشرف أصلاً", "error");
    const p = (S.users[uid] && S.users[uid].profile) || {};
    if (!confirm(`إضافة ${p.name || uid} كمشرف؟ بيقدر يشوف كل البيانات ويوافق ويرفض الحجوزات.`)) return;
    await FZ.withBusy(e.submitter, async () => {
      try {
        await FZ.db.ref(`admins/${uid}`).set(true);
        $("adminInput").value = "";
        FZ.toast("تمت إضافة المشرف ✅ يدخل من صفحة لوحة المسؤول", "success");
      } catch (err) { FZ.toast(FZ.authError(err), "error"); }
    });
  });

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
        <div class="form-group">
          <label>رمز الصندوق لهذه الأداة (4 إلى 8 أرقام — نفس الرمز المبرمج في الصندوق)</label>
          <input class="form-control" name="boxCode" inputmode="numeric" dir="ltr" pattern="[0-9]{4,8}" value="${esc((S.codes || {})[id] || "")}" required>
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
          <div class="small">القسم ${t.compartment} · رسوم التأخير ${money(t.lateFeePerHour)}/ساعة · رمز الصندوق: <b dir="ltr">${esc((S.codes || {})[id] || "— غير محدد")}</b></div>
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
          fee: st.lateFeeDue || 0, blocked: st.blocked === true
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
        <td><b>${esc(u.name)}</b>${u.blocked ? ` <span class="badge badge-danger">موقوف</span>` : ""}</td>
        <td>${esc(u.universityId)}</td>
        <td><a href="https://wa.me/968${esc(u.phone)}" target="_blank" rel="noopener">${esc(u.phone)}</a></td>
        <td dir="ltr">${esc(u.email)}</td>
        <td>${FZ.fmtTime(u.createdAt)}</td>
        <td>${u.rentals}</td>
        <td>${esc(u.status)}</td>
        <td class="${u.fee ? "danger-text" : ""}">${u.fee ? money(u.fee) : "—"}</td>
        <td class="nowrap">
          <button class="btn btn-sm ${u.blocked ? "btn-accent" : "btn-ghost"}" data-action="toggleBlock" data-uid="${esc(u.uid)}">${u.blocked ? "إلغاء الإيقاف" : "إيقاف"}</button>
          <button class="btn btn-sm btn-ghost" data-action="editFee" data-uid="${esc(u.uid)}">الغرامة</button>
        </td>
      </tr>`).join("") : `<tr><td colspan="9" class="muted">لا يوجد مستخدمون${q ? " مطابقون للبحث" : ""}.</td></tr>`;
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
            [`tools/${r.toolId}/status`]: "reserved",
            [`tools/${r.toolId}/currentRental`]: id
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
        } else if (a === "extend") {
          const v = prompt("كم دقيقة تبي تضيف لموعد الإرجاع؟\nاكتب رقم سالب للتقليل — مثلاً 30 أو 60 أو -59", "60");
          if (v === null) return;
          const m = Number(String(v).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace("−", "-").trim());
          if (!isFinite(m) || m === 0) throw new Error("اكتب عدد الدقائق (مثلاً 30 أو -59)");
          const due = (r.dueAt || ((r.startAt || 0) + r.hours * FZ.HOUR)) + Math.round(m * FZ.MIN);
          await FZ.db.ref(`rentals/${id}`).update({ dueAt: due, extendedBy: FZ.auth.currentUser.uid });
          FZ.toast(`موعد الإرجاع الجديد: ${FZ.fmtTime(due)}`, "success");
        } else if (a === "toggleBlock") {
          const uid = btn.dataset.uid;
          const u = S.users[uid] || {}, st = u.state || {}, name = (u.profile || {}).name || uid;
          const block = st.blocked !== true;
          if (!confirm(block ? `إيقاف ${name} عن الحجز؟` : `إلغاء إيقاف ${name}؟`)) return;
          await FZ.db.ref(`users/${uid}/state/blocked`).set(block ? true : null);
          FZ.toast(block ? "تم إيقاف الطالب عن الحجز" : "تم إلغاء الإيقاف", "success");
        } else if (a === "editFee") {
          const uid = btn.dataset.uid;
          const cur = ((S.users[uid] || {}).state || {}).lateFeeDue || 0;
          const v = prompt("الغرامة المستحقة بالبيسة (0 = إعفاء كامل):", String(cur));
          if (v === null) return;
          const n = Math.round(Number(v));
          if (!isFinite(n) || n < 0) throw new Error("اكتب رقم صحيح (بالبيسة)");
          const upd = { [`users/${uid}/state/lateFeeDue`]: n };
          if (n === 0) Object.entries(S.rentals).forEach(([rid, x]) => {
            if (x.uid === uid && x.lateFee > 0 && !x.lateFeePaid) upd[`rentals/${rid}/lateFeePaid`] = true;
          });
          await FZ.db.ref().update(upd);
          FZ.toast(n ? `الغرامة الآن ${money(n)}` : "تم إعفاء الطالب من الغرامة", "success");
        } else if (a === "acctAdd") {
          readAccts(); acctDraft.push({ label: "", value: "" }); renderAccts();
        } else if (a === "acctDel") {
          readAccts(); acctDraft.splice(Number(btn.dataset.i), 1); renderAccts();
        } else if (a === "toolStatus") {
          await FZ.db.ref(`tools/${id}/status`).set(btn.dataset.status);
        } else if (a === "exportUsers") {
          exportUsers();
        } else if (a === "exportRentals") {
          exportRentals();
        } else if (a === "removeAdmin") {
          const uid = btn.dataset.uid;
          const p = (S.users[uid] && S.users[uid].profile) || {};
          if (!confirm(`إزالة ${p.name || uid} من المشرفين؟`)) return;
          await FZ.db.ref(`admins/${uid}`).remove();
          FZ.toast("تمت إزالة المشرف", "success");
        } else if (a === "toolAdd") {
          S.editingTool = NEW_TOOL; renderTools(true);
        } else if (a === "toolDelete") {
          const t = S.tools[id];
          if (!t || !(t.status === "available" || t.status === "maintenance")) throw new Error("لا يمكن حذف أداة محجوزة أو مستأجرة");
          if (!confirm(`حذف «${t.name}» نهائياً؟ الحجوزات السابقة تبقى في السجل.`)) return;
          await FZ.db.ref().update({ [`tools/${id}`]: null, [`toolCodes/${id}`]: null });
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
    const boxCode = String(f.get("boxCode") || "").trim();
    if (!/^[0-9]{4,8}$/.test(boxCode)) return FZ.toast("رمز الصندوق لازم من 4 إلى 8 أرقام", "error");
    const dup = Object.entries(S.codes || {}).find(([k, c]) => k !== id && c === boxCode);
    if (dup) return FZ.toast(`هذا الرمز مستخدم لأداة ثانية (${(S.tools[dup[0]] || {}).name || dup[0]})`, "error");
    const upd = {
      [`toolCodes/${id}`]: boxCode,
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
    if ((S.tools[r.toolId] || {}).currentRental === rid) out[`tools/${r.toolId}/currentRental`] = null;
    return out;
  }

  async function completeReturn(rid) {
    const r = (await FZ.db.ref(`rentals/${rid}`).get()).val();
    if (!r || (r.status !== "active" && r.status !== "returning")) throw new Error("العملية ليست في حالة استئجار نشط");
    const upd = {
      [`rentals/${rid}/status`]: "returned",
      [`tools/${r.toolId}/status`]: "available",
      ...clearActive(r, rid)
    };
    if (r.status === "returning") {           // الصندوق فتح للإرجاع والرسوم مسجّلة — فقط نؤكد
      upd[`rentals/${rid}/returnConfirmedAt`] = FZ.TS;
      await FZ.db.ref().update(upd);
      return r.lateFee || 0;
    }
    const tool = (await FZ.db.ref(`tools/${r.toolId}`).get()).val();
    const fee = FZ.lateFeeFor(r, tool, FZ.now());
    upd[`rentals/${rid}/returnedAt`] = FZ.TS;
    upd[`rentals/${rid}/lateFee`] = fee;
    if (fee > 0) {
      upd[`rentals/${rid}/lateFeePaid`] = false;
      upd[`users/${r.uid}/state/lateFeeDue`] = firebase.database.ServerValue.increment(fee);
    }
    await FZ.db.ref().update(upd);
    return fee;
  }

  // نفس اللي يسويه الصندوق: رمز ثابت لكل أداة ← الحجز الحالي للأداة ← استلام أو إرجاع
  async function processPin(code) {
    if (!/^\d{4,8}$/.test(code)) return { ok: false, msg: "اكتب الرمز (4 إلى 8 أرقام)" };
    if (!FZ.box.enabled) return { ok: false, msg: "الصندوق متوقف من لوحة المسؤول — شغّله أولاً" };
    if (!FZ.box.online) return { ok: false, msg: "الصندوق غير متصل — لا يُنفَّذ أي رمز" };
    const codes = (await FZ.db.ref("toolCodes").get()).val() || {};
    const toolId = Object.keys(codes).find(k => String(codes[k]) === code);
    if (!toolId) return { ok: false, msg: "رمز غير صحيح" };
    const tool = (await FZ.db.ref(`tools/${toolId}`).get()).val() || {};
    const rid = tool.currentRental;
    const r = rid ? FZ.withDue((await FZ.db.ref(`rentals/${rid}`).get()).val()) : null;
    if (!r) return { ok: false, msg: "لا يوجد حجز مؤكد لهذه الأداة الآن" };
    const t = FZ.now();
    if (r.status === "paid") {
      await FZ.db.ref().update({
        [`rentals/${rid}/status`]: "active",
        [`rentals/${rid}/startAt`]: FZ.TS,
        [`rentals/${rid}/dueAt`]: t + r.hours * FZ.HOUR,
        [`tools/${toolId}/status`]: "rented"
      });
      return { ok: true, compartment: tool.compartment, msg: `✅ فُتح القسم ${tool.compartment} — بدأ وقت الإيجار` };
    }
    if (r.status !== "active") return { ok: false, msg: "حالة الحجز لا تسمح بفتح الصندوق" };
    if (FZ.RETURN_AFTER_DUE && t < r.dueAt) return { ok: false, msg: "الإرجاع متاح بعد انتهاء مدة الاستئجار فقط" };
    const fee = await completeReturn(rid);
    return { ok: true, compartment: tool.compartment,
      msg: `✅ فُتح القسم ${tool.compartment} — تم الإرجاع${fee ? ` (رسوم تأخير ${money(fee)})` : ""}` };
  }


  // -------------------- الإعدادات --------------------
  let acctDraft = [], settingsDirty = false;
  function renderAccts() {
    $("acctRows").innerHTML = acctDraft.map((x, i) => `
      <div class="acct-row">
        <input class="form-control acct-label" placeholder="اسم الحساب (مثلاً: بنك نزوى)" value="${esc(x.label)}">
        <input class="form-control acct-value" placeholder="الرقم" dir="ltr" value="${esc(x.value)}">
        <button type="button" class="btn btn-sm btn-ghost" data-action="acctDel" data-i="${i}">حذف</button>
      </div>`).join("") || `<p class="hint text-start">لا يوجد حساب تحويل — أضف واحد على الأقل.</p>`;
  }
  function readAccts() {
    acctDraft = [...document.querySelectorAll("#acctRows .acct-row")].map(row => ({
      label: row.querySelector(".acct-label").value.trim(), value: row.querySelector(".acct-value").value.trim()
    }));
  }
  function fillSettings(st) {
    if (settingsDirty) return;           // لا نمسح تعديلات المسؤول وهو يكتب
    acctDraft = st.payment.accounts.map(a => ({ label: a.label || "", value: a.value || "" }));
    renderAccts();
    $("setWhatsapp").value = st.contactWhatsapp || "";
    $("setOpen").value = st.rules.openSeconds;
    $("setGrace").value = st.rules.graceMinutes;
    $("setReturnAfter").checked = st.rules.returnOnlyAfterDue !== false;
    $("setTitle").value = st.texts.title || "";
    $("setTagline").value = st.texts.tagline || "";
    $("setAnnounce").value = st.texts.announcement || "";
  }
  FZ.onSettings(fillSettings);
  $("settingsForm").addEventListener("input", () => { settingsDirty = true; });
  $("settingsForm").addEventListener("submit", async e => {
    e.preventDefault();
    readAccts();
    const accounts = acctDraft.filter(a => a.value);
    const wa = $("setWhatsapp").value.trim();
    const num = (id, min, max) => { const n = Number($(id).value); if (!isFinite(n) || n < min || n > max) throw new Error(`القيمة في «${$(id).labels[0].textContent}» لازم بين ${min} و ${max}`); return n; };
    try {
      if (!accounts.length) throw new Error("أضف رقم تحويل واحد على الأقل");
      if (wa && !/^[0-9]{8}$/.test(wa)) throw new Error("رقم الواتساب لازم 8 أرقام");
      const val = {
        payment: { accounts },
        contactWhatsapp: wa,
        rules: {
          openSeconds: num("setOpen", 3, 120), pinMinutes: Number(FZ.settings.rules.pinMinutes) || 10,
          graceMinutes: num("setGrace", 0, 1440), returnOnlyAfterDue: $("setReturnAfter").checked
        },
        texts: { title: $("setTitle").value.trim() || "صندوق فزعة", tagline: $("setTagline").value.trim(), announcement: $("setAnnounce").value.trim() },
        updatedAt: FZ.TS, updatedBy: FZ.auth.currentUser.uid
      };
      const btn = e.submitter;
      await FZ.withBusy(btn, () => FZ.db.ref("settings").set(val));
      settingsDirty = false;
      FZ.toast("تم حفظ الإعدادات ✅", "success");
    } catch (err) {
      FZ.toast(err.message && !String(err.message).includes("PERMISSION") ? err.message : FZ.authError(err), "error");
    }
  });

  // -------------------- تشغيل / إيقاف الصندوق --------------------
  function renderBoxControl() {
    const el = $("boxControl");
    if (!el) return;
    const on = FZ.box.enabled;
    el.innerHTML = `
      <div class="box-ctl ${on ? "is-on" : "is-off"}">
        <div>
          <b>${on ? "الصندوق شغّال" : "الصندوق متوقف"}</b>
          <div class="small muted">${on
            ? (FZ.box.connected ? "متصل ويستقبل الرموز." : "مشغّل، لكنه غير متصل بالإنترنت الآن.")
            : "لا يقبل رموز ولا يمكن للطلاب طلب رموز. الحجوزات والدفع تبقى شغّالة."}</div>
        </div>
        <button class="btn btn-sm ${on ? "btn-danger" : "btn-accent"}" data-action="toggleBox">${on ? "إيقاف الصندوق" : "تشغيل الصندوق"}</button>
      </div>`;
  }
  document.addEventListener("click", async e => {
    const b = e.target.closest('[data-action="toggleBox"]');
    if (!b) return;
    const turnOff = FZ.box.enabled;
    if (!confirm(turnOff ? "إيقاف الصندوق؟ لن يُفتح أي قسم حتى تشغّله من جديد." : "تشغيل الصندوق؟")) return;
    await FZ.withBusy(b, () => FZ.db.ref("box/enabled").set(!turnOff)
      .then(() => FZ.toast(turnOff ? "تم إيقاف الصندوق" : "تم تشغيل الصندوق", "success"))
      .catch(err => FZ.toast(FZ.authError(err), "error")));
  });

  // -------------------- طلبات فتح الصندوق --------------------
  const handled = new Set();
  // الأدوات اللي عليها حجز ينتظر الصندوق (استلام أو إرجاع)
  function renderUnlocks() {
    const el = $("unlockList");
    if (!el) return;
    const t = FZ.now();
    const rows = Object.entries(S.tools || {}).map(([tid, tool]) => {
      const r = tool.currentRental && S.rentals[tool.currentRental];
      if (!r || !["paid", "active"].includes(r.status)) return "";
      const prof = (S.users[r.uid] && S.users[r.uid].profile) || {};
      const code = (S.codes || {})[tid] || "";
      const what = r.status === "paid" ? "بانتظار الاستلام"
        : (FZ.RETURN_AFTER_DUE && t < r.dueAt ? "مستأجرة — الإرجاع بعد انتهاء الوقت" : "جاهزة للإرجاع");
      return `<div class="unlock-item">
          <div><b>القسم ${tool.compartment} — ${what}</b>
            <div class="small">${esc(prof.name || "")} · ${esc(tool.name || "")} · الرمز <b dir="ltr">${esc(code)}</b></div></div>
          ${code ? `<button class="btn btn-sm btn-accent" data-action="runUnlock" data-code="${esc(code)}">إدخال الرمز</button>` : ""}
        </div>`;
    }).join("");
    el.innerHTML = rows || `<div class="muted small unlock-empty">لا توجد أدوات بانتظار الصندوق الآن.</div>`;
  }

  async function runUnlock(code) {
    const res = await processPin(code).catch(err => ({ ok: false, msg: "خطأ: " + FZ.authError(err) }));
    $("kpResult").textContent = res.msg;
    $("kpResult").className = `keypad-result ${res.ok ? "ok" : "bad"}`;
    if (res.ok) {
      S.opened[res.compartment] = true; renderCompartments();
      setTimeout(() => { S.opened[res.compartment] = false; renderCompartments(); }, (Number(FZ.settings.rules.openSeconds) || 10) * 1000); // يُقفل تلقائياً
    }
  }

  document.addEventListener("click", e => {
    const b = e.target.closest('[data-action="runUnlock"]');
    if (b) runUnlock(b.dataset.code);
  });

  setInterval(renderUnlocks, 1500);

  // محاكاة لوحة الأرقام: المسؤول يكتب الرمز كما يكتبه الطالب عند الصندوق
  document.addEventListener("submit", e => {
    if (e.target.id !== "kpForm") return;
    e.preventDefault();
    const code = $("kpInput").value.trim();
    $("kpInput").value = "";
    runUnlock(code);
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
