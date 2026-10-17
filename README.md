# صندوق فزعة — دليل التشغيل

## الملفات

| الملف | الوظيفة |
|---|---|
| `index.html` + `app.js` | موقع الطالب: التسجيل، اختيار الأداة والمدة، الدفع بالتحويل، رمز الاستلام، الإرجاع |
| `admin.html` + `admin.js` | لوحة المسؤول: الموافقة على الدفع، المتابعة، رسوم التأخير، الأدوات، ومحاكي لوحة الأرقام |
| `common.js` | أدوات مشتركة (وقت الخادم، حالة الصندوق، التنسيق) |
| `style.css` | التصميم (نفس تصميمك الأصلي مع إضافات) |
| `firebase-config.js` | **ضع هنا إعدادات مشروعك** وأرقام الحسابات البنكية |
| `database.rules.json` | قواعد الأمان: هنا يتم التحقق الفعلي من الرموز والصلاحيات |
| `firebase.json` | إعداد النشر على Firebase Hosting |

> الملفات القديمة `index (1).html` و `script (1).js` و `style (1).css` لم تعد مستخدمة ويمكنك حذفها.

---

## خطوات الإعداد (مرة واحدة)

1. **أنشئ مشروعاً** في [Firebase Console](https://console.firebase.google.com).
2. **Authentication ← Sign-in method ← فعّل Email/Password.**
3. **Realtime Database ← Create database** (اختر أقرب منطقة، ابدأ بـ *locked mode*).
4. **Realtime Database ← Rules**: الصق محتوى `database.rules.json` كاملاً واضغط **Publish**.
5. **Project settings ← Your apps ← أضف Web app**، وانسخ القيم إلى `firebase-config.js` (تأكد من وجود `databaseURL`).
6. عدّل أرقام الحسابات في `PAYMENT_INFO` داخل `firebase-config.js`.
7. **حساب المسؤول**:
   - سجّل حساباً عادياً من `index.html`، ثم افتح `admin.html` وسجّل الدخول به. ستظهر رسالة «ليس مسؤولاً» ومعها المعرّف (UID).
   - في Realtime Database أضف: `admins / <UID> = true` (القيمة boolean وليست نصاً).
8. من لوحة المسؤول اضغط **«تهيئة الأدوات الافتراضية»** (الآلة الحاسبة في القسم 1، وصلة Type-C في القسم 2).
   الأسعار بالبيسة ويمكن تعديلها من قاعدة البيانات تحت `tools/<id>/plans`.
9. **حساب ESP32**: من Authentication ← Users ← Add user أنشئ حساباً للجهاز (مثل `box@fazza.local`)، ثم أضف `devices / <UID> = true`.

### التشغيل
- **الأفضل:** النشر على Firebase Hosting (`npm i -g firebase-tools` ثم `firebase login` ثم `firebase init` ثم `firebase deploy`).
- **للتجربة على جهازك:** افتح المجلد في VS Code وشغّله عبر إضافة **Live Server**.

### الاختبار بدون ESP32
في لوحة المسؤول فعّل **«محاكاة اتصال الصندوق»**، ثم استخدم **محاكي لوحة الأرقام**. المحاكي ينفّذ نفس الخطوات المطلوبة من ESP32 بالضبط.

---

## هيكل قاعدة البيانات

```
admins/{uid}: true
devices/{uid}: true
box/lastSeen: <server timestamp>                ← يكتبه ESP32 كل 30 ثانية
tools/{toolId}: { name, compartment, status, lateFeePerHour, plans: { h1:{hours,amount}, ... } }
     status: available | reserved | rented | maintenance
users/{uid}/profile: { name, universityId, phone, email, createdAt }
users/{uid}/state:   { activeRental, lateFeeDue }   ← لا يعدّلها الطالب إلا بحالات محددة في القواعد
rentals/{rid}: { uid, toolId, toolName, compartment, plan, hours, amount, ref, status,
                 createdAt, paymentClaimedAt, paidAt, startAt, dueAt, returnedAt,
                 currentPin, lateFee, lateFeePaid }
     status: pending → paid → active → returned   (أو cancelled / rejected)
pins/{6 أرقام}: { uid, rentalId, compartment, type: pickup|return, createdAt, used, usedAt }
```

## ما تضمنه قواعد Firebase (وليس الموقع فقط)

- لا يستطيع الطالب إنشاء طلب إذا كان لديه طلب قائم (**أداة واحدة فقط**)، أو عليه **رسوم تأخير**، أو كانت الأداة غير متاحة.
- **المبلغ والمدة** يجب أن تطابق الأسعار المسجلة في `tools`، فلا يمكن التلاعب بالسعر من المتصفح.
- لا يمكن للطالب تغيير الحالة إلى `paid` أو `active` أو `returned`. يستطيع فقط إلغاء طلبه وهو `pending`.
- **رمز الاستلام** لا يُنشأ إلا والطلب `paid`، و**رمز الإرجاع** لا يُنشأ إلا والطلب `active`، ولنفس القسم.
- لا يُنشأ أي رمز إذا كان **الصندوق غير متصل** (آخر نبضة أقدم من 90 ثانية).
- `createdAt` للرمز يأتي من **وقت الخادم**، فلا يمكن تمديد صلاحيته.
- الطالب لا يقرأ إلا بياناته ورموزه، وتعديل الرسوم والحالات مقصور على المسؤول وجهاز ESP32.

---

## المطلوب من الشريحة داخل الصندوق (عقد التكامل)

لا توجد لوحة أرقام: الطالب يضغط «افتح القسم» في الموقع، فيُكتب **طلب فتح** في `pins/{id}`، والشريحة تنفّذه مباشرة.

**النبضة:** كل 30 ثانية اكتب `box/lastSeen = {".sv":"timestamp"}` (بدونها الموقع يعرض «الصندوق غير متصل» ويعطّل زر الفتح).
**عند انقطاع Wi-Fi:** تبقى الأقفال مغلقة.
**الوقت:** استخدم NTP.

استمع لـ `pins` (مثلاً `orderByChild("createdAt").limitToLast(20)`)، ولكل طلب جديد:

1. إذا `used == true` أو `now - createdAt > 60000` (أقدم من دقيقة) ← **تجاهله**.
2. اقرأ `rentals/{rentalId}`: يجب `currentPin == id` و `compartment` مطابق، و `type == "pickup"` مع حالة `paid` أو `type == "return"` مع حالة `active`.
3. اكتب `pins/{id}/used = true` و `usedAt` (يفضّل transaction)، ثم **افتح قفل القسم** وأعد قفله بعد ثوانٍ أو بعد إغلاق الباب.
4. **استلام:** `rentals/{rid}`: `status="active"`, `startAt=now`, `dueAt=now + hours×3600000`، و`tools/{toolId}/status="rented"`.
5. **إرجاع:** احسب رسوم التأخير (بعد ساعة سماح: عدد الساعات المتأخرة مقرّبة لأعلى × `lateFeePerHour`)، ثم `status="returned"`, `returnedAt`, `lateFee`، والأداة `available`، و`users/{uid}/state/activeRental = null`، وأضف الرسوم إلى `lateFeeDue`.

> نفس المنطق مكتوب في `processPin` داخل `admin.js`، وقسم «طلبات فتح الصندوق» في لوحة المسؤول يحاكيه للاختبار.

---

## قائمة اختبار سريعة
- [ ] تسجيل طالب ← طلب ← «حوّلت المبلغ» ← موافقة المسؤول ← رمز استلام ← المحاكي يفتح القسم.
- [ ] إدخال نفس الرمز مرة ثانية يُرفض. ورمز مضى عليه أكثر من 10 دقائق يُرفض.
- [ ] محاولة طلب أداة ثانية والطلب الأول قائم ← مرفوضة.
- [ ] تأخير أكثر من ساعة ← تُسجّل رسوم ← يُمنع الطالب من الطلب ← «تمت التسوية» ← يعود متاحاً.
- [ ] إيقاف النبضة ← بعد 90 ثانية يظهر «غير متصل» ويتعطل زر الرمز.
