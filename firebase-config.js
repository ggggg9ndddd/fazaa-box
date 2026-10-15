// =====================================================================
//  إعدادات مشروع Firebase
//  انسخها من: Firebase Console > Project settings > Your apps > Web app
// =====================================================================
const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",        // مهم: رابط Realtime Database (ينتهي بـ firebaseio.com أو firebasedatabase.app)
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// الحسابات التي يحوّل لها الطالب المبلغ (تظهر في صفحة الدفع)
const PAYMENT_INFO = {
  accounts: [
    { label: "بنك مسقط", value: "0315012345678" },
    { label: "ثواني (Thawani)", value: "91234567" }
  ]
};

// اتركها false في التشغيل الحقيقي.
// true = الاتصال بمحاكيات Firebase المحلية (للاختبار فقط).
const USE_EMULATORS = false;
