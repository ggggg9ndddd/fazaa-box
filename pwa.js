// تثبيت فزعة كتطبيق على الجوال (PWA)
(() => {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
  const box = document.getElementById("installBox");
  if (!box) return;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone) return;                                   // مثبّت أصلاً

  const btn = document.getElementById("installBtn");
  const hint = document.getElementById("installHint");
  let deferred = null;

  // أندرويد / كروم / إيدج: زر تثبيت مباشر
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); deferred = e;
    box.hidden = false; btn.hidden = false; hint.hidden = true;
  });
  btn.addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    const choice = await deferred.userChoice.catch(() => null);
    deferred = null;
    if (choice && choice.outcome === "accepted") box.hidden = true;
  });
  window.addEventListener("appinstalled", () => { box.hidden = true; });

  // آيفون (سفاري): ما فيه زر تثبيت، نشرح الطريقة
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) {
    box.hidden = false; btn.hidden = true; hint.hidden = false;
  }
})();
