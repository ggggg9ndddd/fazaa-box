// =====================================================================
//  إعدادات مشروع Firebase
//  انسخها من: Firebase Console > Project settings > Your apps > Web app
// =====================================================================
const firebaseConfig = {
  apiKey: "",            // ← انسخه من Project settings > Your apps
  authDomain: "fazza-33661.firebaseapp.com",
  databaseURL: "https://fazza-33661-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "fazza-33661",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""              // ← انسخه من Project settings > Your apps
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
