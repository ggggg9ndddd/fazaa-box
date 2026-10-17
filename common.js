// =====================================================================
//  common.js — أدوات مشتركة بين صفحة الطالب ولوحة المسؤول
// =====================================================================
const FZ = (() => {
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const PIN_TTL = 10 * MIN;        // أقصى عمر لطلب الفتح في قاعدة البيانات
  const UNLOCK_TTL = 60 * 1000;    // الشريحة تنفّذ طلب الفتح فقط إذا كان عمره أقل من دقيقة
  const BOX_TIMEOUT = 90 * 1000;   // يُعتبر الصندوق غير متصل إذا لم يرسل نبضة خلال 90 ثانية (النبضة كل 30 ثانية)
  const GRACE = HOUR;              // ساعة سماح بعد انتهاء المدة قبل تسجيل رسوم التأخير

  const ready = !!(typeof firebaseConfig !== "undefined" && firebaseConfig.apiKey && firebaseConfig.databaseURL);
  let auth = null, db = null;
  if (ready) {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.database();
    if (typeof USE_EMULATORS !== "undefined" && USE_EMULATORS) {
      auth.useEmulator("http://127.0.0.1:9099", { disableWarnings: true });
      db.useEmulator("127.0.0.1", 9000);
    }
  }
  const TS = firebase.database.ServerValue.TIMESTAMP;

  // ---- وقت الخادم (لا نعتمد على ساعة جهاز المستخدم) ----
  let offset = 0;
  if (db) db.ref(".info/serverTimeOffset").on("value", s => { offset = s.val() || 0; });
  const now = () => Date.now() + offset;

  // ---- حالة اتصال الصندوق ----
  const box = { lastSeen: null, online: false };
  const boxListeners = [];
  function evalBox() {
    const online = typeof box.lastSeen === "number" && now() - box.lastSeen < BOX_TIMEOUT;
    const changed = online !== box.online;
    box.online = online;
    if (changed || box._first !== false) { box._first = false; boxListeners.forEach(fn => fn(box)); }
  }
  function watchBox(fn) {
    boxListeners.push(fn);
    if (boxListeners.length === 1 && db) {
      db.ref("box/lastSeen").on("value", s => { box.lastSeen = s.val(); box._first = true; evalBox(); });
      setInterval(evalBox, 5000);
    }
  }
  function renderBoxPill(el) {
    if (!el) return;
    el.classList.toggle("online", box.online);
    el.classList.toggle("offline", !box.online);
    el.querySelector(".txt").textContent = box.online
      ? "الصندوق متصل"
      : (box.lastSeen ? `الصندوق غير متصل (آخر اتصال ${fmtTime(box.lastSeen)})` : "الصندوق غير متصل");
  }

  // ---- تنسيق ----
  function money(baisa) {
    if (baisa == null || isNaN(baisa)) return "—";
    return baisa < 1000 ? `${baisa} بيسة` : `${(baisa / 1000).toFixed(3)} ر.ع`;
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtTime(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("ar-OM", { weekday: "short", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
  }
  function fmtCountdown(ms) {
    ms = Math.max(0, ms);
    const h = Math.floor(ms / HOUR), m = Math.floor((ms % HOUR) / MIN), s = Math.floor((ms % MIN) / 1000);
    const pad = n => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  function planLabel(hours) {
    if (hours === 24) return "يوم كامل";
    if (hours === 1) return "ساعة واحدة";
    if (hours === 2) return "ساعتان";
    return `${hours} ساعات`;
  }

  // الشريحة تكتب وقت الاستلام فقط (startAt)، وموعد الإرجاع يُحسب منه هنا
  function withDue(r) {
    if (r && !r.dueAt && r.startAt && r.hours) r.dueAt = r.startAt + r.hours * HOUR;
    return r;
  }

  // رسوم التأخير: تُحسب فقط إذا تجاوز التأخير ساعة السماح، بعدد ساعات التأخير (تقريب لأعلى) × سعر الساعة
  function lateFeeFor(rental, tool, at) {
    withDue(rental);
    if (!rental || !rental.dueAt) return 0;
    const over = at - rental.dueAt;
    if (over <= GRACE) return 0;
    return Math.ceil(over / HOUR) * ((tool && tool.lateFeePerHour) || 0);
  }

  const STATUS = {
    pending:   { label: "بانتظار تأكيد الدفع", cls: "pending" },
    paid:      { label: "تم تأكيد الدفع",       cls: "paid" },
    active:    { label: "مستأجرة حالياً",        cls: "active" },
    returned:  { label: "تم الإرجاع",            cls: "returned" },
    cancelled: { label: "ملغي",                  cls: "muted" },
    rejected:  { label: "مرفوض",                 cls: "danger" }
  };
  const TOOL_STATUS = {
    available:   { label: "متاحة",       cls: "active" },
    reserved:    { label: "محجوزة",      cls: "pending" },
    rented:      { label: "مستأجرة",     cls: "paid" },
    maintenance: { label: "صيانة",       cls: "muted" }
  };
  const badge = (map, key) => {
    const s = map[key] || { label: key, cls: "muted" };
    return `<span class="badge badge-${s.cls}">${esc(s.label)}</span>`;
  };

  function authError(e) {
    const code = (e && e.code) || "";
    const map = {
      "auth/invalid-email": "البريد الإلكتروني غير صحيح",
      "auth/email-already-in-use": "هذا البريد مسجّل مسبقاً — سجّل الدخول",
      "auth/weak-password": "كلمة المرور ضعيفة (6 أحرف على الأقل)",
      "auth/user-not-found": "البريد أو كلمة المرور غير صحيحة",
      "auth/wrong-password": "البريد أو كلمة المرور غير صحيحة",
      "auth/invalid-credential": "البريد أو كلمة المرور غير صحيحة",
      "auth/invalid-login-credentials": "البريد أو كلمة المرور غير صحيحة",
      "auth/too-many-requests": "محاولات كثيرة، حاول بعد قليل",
      "auth/network-request-failed": "تحقق من اتصالك بالإنترنت",
      "auth/unauthorized-domain": "هذا الموقع غير مسموح في إعدادات Firebase (Authorized domains)",
      "auth/operation-not-allowed": "الدخول بهذه الطريقة غير مفعّل في Firebase",
      "PERMISSION_DENIED": "العملية مرفوضة من قاعدة البيانات"
    };
    if (map[code]) return map[code];
    if (String(e && e.message).includes("PERMISSION_DENIED")) return map.PERMISSION_DENIED;
    return "حدث خطأ غير متوقع، حاول مرة أخرى";
  }

  let toastTimer = null;
  function toast(msg, type = "info") {
    const el = document.getElementById("toast");
    if (!el) return alert(msg);
    el.textContent = msg;
    el.className = `toast show toast-${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = "toast"; }, 4200);
  }

  // تحديث كل العدّادات التنازلية في الصفحة كل ثانية: <span data-to="timestamp">
  function startCountdowns(onTick) {
    setInterval(() => {
      document.querySelectorAll("[data-to]").forEach(el => {
        el.textContent = fmtCountdown(Number(el.dataset.to) - now());
      });
      document.querySelectorAll("[data-since]").forEach(el => {
        el.textContent = fmtCountdown(now() - Number(el.dataset.since));
      });
      if (onTick) onTick();
    }, 1000);
  }

  async function withBusy(btn, fn) {
    if (btn) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.innerHTML = "…"; }
    try { return await fn(); }
    finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.label; } }
  }

  return {
    ready, auth, db, TS, now, box, watchBox, renderBoxPill,
    money, esc, fmtTime, fmtCountdown, planLabel, lateFeeFor, withDue,
    STATUS, TOOL_STATUS, badge, authError, toast, startCountdowns, withBusy,
    MIN, HOUR, PIN_TTL, UNLOCK_TTL, BOX_TIMEOUT, GRACE
  };
})();
