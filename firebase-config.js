// =====================================================================
//  إعدادات مشروع Firebase
//  انسخها من: Firebase Console > Project settings > Your apps > Web app
// =====================================================================
const firebaseConfig = {
  apiKey: "AIzaSyDGiQUlEJFnUDjJHOtxdtxc7R935bxi5bM",
  // على الدومين الخاص نستخدم نفس الدومين لتسجيل الدخول بجوجل (يمرّ عبر vercel.json إلى Firebase)
  authDomain: /(^|\.)riooo\.online$/.test(location.hostname) ? location.hostname : "fazza-33661.firebaseapp.com",
  databaseURL: "https://fazza-33661-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "fazza-33661",
  storageBucket: "fazza-33661.firebasestorage.app",
  messagingSenderId: "223954699755",
  appId: "1:223954699755:web:365a29a2dc5fa8f3f0c5ae"
};

// الحسابات التي يحوّل لها الطالب المبلغ (تظهر في صفحة الدفع)
const PAYMENT_INFO = {
  accounts: [
    { label: "بنك نزوى (تحويل برقم الهاتف)", value: "74193388" }
  ]
};

// رقم واتساب الفريق (للتواصل والاستفسار) — بدون مفتاح الدولة
const CONTACT_WHATSAPP = "74193388";

// رابط استقبال إيصالات التحويل (Google Apps Script Web App).
// إذا تُرك فارغاً يعود الموقع لطريقة «حوّلت المبلغ» وموافقة المسؤول.
const RECEIPT_ENDPOINT = "https://script.google.com/macros/s/AKfycbzLnUSfrtY4VEoObXTG3NiJWNSN_-wiKQHW9Kp9m5jsftKmW6fK6M8k29U4kJAazPNT/exec";

// اتركها false في التشغيل الحقيقي.
// true = الاتصال بمحاكيات Firebase المحلية (للاختبار فقط).
const USE_EMULATORS = false;
