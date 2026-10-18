/**
 * صندوق فزعة — مزامنة تلقائية من Firebase إلى Google Sheets
 * يقرأ المستخدمين والحجوزات من قاعدة البيانات ويكتبها في هذا الملف.
 * يعمل بصلاحيات حساب Google المالك لمشروع Firebase (بدون كلمات سر داخل الكود).
 */
const DB_URL = 'https://fazza-33661-default-rtdb.europe-west1.firebasedatabase.app';
const TZ = 'Asia/Muscat';
const SHEET_ID = '1hqoRdqmrzzMYbErI6BeUlHtCy5nRI7ClriH-b4XEDQU'; // ملف «صندوق فزعة - البيانات» في Drive

const STATUS = {
  pending: 'بانتظار تأكيد الدفع', paid: 'تم تأكيد الدفع', active: 'مستأجرة حالياً',
  returned: 'تم الإرجاع', cancelled: 'ملغي', rejected: 'مرفوض'
};

/** شغّلها مرة واحدة: تحدّث البيانات الآن وتجعلها تتحدث تلقائياً كل 15 دقيقة */
function setupAutoSync() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncFazza')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncFazza').timeBased().everyMinutes(15).create();
  syncFazza();
}

function fetchPath_(path) {
  const url = DB_URL + '/' + path + '.json?access_token=' + ScriptApp.getOAuthToken();
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('تعذّر القراءة من Firebase (' + res.getResponseCode() + '): ' + res.getContentText());
  }
  return JSON.parse(res.getContentText()) || {};
}

function fmt_(ts) {
  return ts ? Utilities.formatDate(new Date(ts), TZ, 'yyyy-MM-dd HH:mm') : '';
}
function omr_(baisa) {
  return baisa ? baisa / 1000 : 0;
}
function hoursLabel_(h) {
  if (h === 24) return 'يوم كامل';
  if (h === 1) return 'ساعة واحدة';
  if (h === 2) return 'ساعتان';
  return h + ' ساعات';
}

function syncFazza() {
  const users = fetchPath_('users');
  const rentals = fetchPath_('rentals');
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // عدد الحجوزات لكل مستخدم
  const counts = {};
  Object.keys(rentals).forEach(id => {
    const r = rentals[id];
    counts[r.uid] = (counts[r.uid] || 0) + 1;
  });

  // ---- المستخدمون ----
  const userRows = Object.keys(users)
    .filter(uid => users[uid] && users[uid].profile)
    .map(uid => {
      const p = users[uid].profile, st = users[uid].state || {};
      const ids = Object.keys(st.activeByTool || {}).map(k => st.activeByTool[k]);
      if (st.activeRental && ids.indexOf(st.activeRental) === -1) ids.push(st.activeRental);
      const actives = ids.map(id => rentals[id]).filter(Boolean);
      return [
        p.name || '', String(p.universityId || ''), String(p.phone || ''), p.email || '',
        fmt_(p.createdAt), counts[uid] || 0,
        actives.length ? actives.map(x => (STATUS[x.status] || x.status) + ' — ' + x.toolName).join(' | ') : 'لا يوجد حجز',
        omr_(st.lateFeeDue)
      ];
    })
    .sort((a, b) => (b[4] > a[4] ? 1 : -1));

  writeSheet_(ss, 'المستخدمون',
    ['الاسم', 'الرقم الجامعي', 'الهاتف', 'الإيميل', 'تاريخ التسجيل', 'عدد الحجوزات', 'الحالة الحالية', 'رسوم مستحقة (ر.ع)'],
    userRows, [2, 3]);

  // ---- الحجوزات ----
  const rentalRows = Object.keys(rentals)
    .map(id => {
      const r = rentals[id];
      const p = (users[r.uid] && users[r.uid].profile) || {};
      return [
        r.ref || '', p.name || '', String(p.universityId || ''), String(p.phone || ''),
        r.toolName || '', hoursLabel_(r.hours), omr_(r.amount), STATUS[r.status] || r.status,
        fmt_(r.createdAt), fmt_(r.paidAt), fmt_(r.startAt), fmt_(r.dueAt || (r.startAt ? r.startAt + r.hours * 3600000 : 0)), fmt_(r.returnedAt),
        omr_(r.lateFee), r.lateFee ? (r.lateFeePaid ? 'نعم' : 'لا') : '',
        r.receiptUrl || '', r.approvedBy === 'auto-receipt' ? 'تلقائي (إيصال)' : (r.approvedBy ? 'المسؤول' : '')
      ];
    })
    .sort((a, b) => (b[8] > a[8] ? 1 : -1));

  writeSheet_(ss, 'الحجوزات',
    ['الرمز المرجعي', 'الاسم', 'الرقم الجامعي', 'الهاتف', 'الأداة', 'المدة', 'المبلغ (ر.ع)', 'الحالة',
     'تاريخ الطلب', 'تاريخ الموافقة', 'الاستلام', 'موعد الإرجاع', 'الإرجاع الفعلي', 'رسوم التأخير (ر.ع)', 'مسددة؟',
     'رابط الإيصال', 'طريقة الموافقة'],
    rentalRows, [3, 4]);

  // إزالة الورقة الفارغة الافتراضية إن وُجدت
  const blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('الورقة1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  Logger.log('تم التحديث: ' + userRows.length + ' مستخدم، ' + rentalRows.length + ' حجز');

  // إيميلات التذكير والتأخير والإرجاع (تعمل مع كل تحديث تلقائي كل 15 دقيقة)
  try { notifyRentals_(rentals, users); } catch (e) { Logger.log('notify error: ' + e.message); }
}

function writeSheet_(ss, name, header, rows, textCols) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  sh.setRightToLeft(true);
  const all = [header].concat(rows);
  // أعمدة الأرقام الجامعية والهواتف كنص حتى لا تضيع الأصفار
  textCols.forEach(c => sh.getRange(1, c, Math.max(all.length, 2), 1).setNumberFormat('@'));
  sh.getRange(1, 1, all.length, header.length).setValues(all);
  sh.getRange(1, 1, 1, header.length)
    .setFontWeight('bold').setBackground('#0B192C').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, header.length);
  const note = 'آخر تحديث: ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  sh.getRange(1, 1).setNote(note);
}


/* =====================================================================
 *  استقبال إيصالات التحويل من الموقع (Web App)
 *  - يتحقق من هوية الطالب عبر Firebase ID Token
 *  - يحفظ الإيصال في Drive داخل: فريق / إيصالات
 *  - يؤكد الحجز تلقائياً (paid) إذا كانت الأداة ما زالت متاحة
 * ===================================================================== */
const FIREBASE_API_KEY = 'AIzaSyDGiQUlEJFnUDjJHOtxdtxc7R935bxi5bM';
const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

function doGet() {
  return json_({ ok: true, service: 'fazza-receipts' });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const uid = verifyIdToken_(body.idToken);
    const rid = String(body.rentalId || '');
    if (!/^[-A-Za-z0-9_]{10,40}$/.test(rid)) return json_({ ok: false, msg: 'طلب غير صالح' });
    if (ALLOWED.indexOf(body.mimeType) === -1) return json_({ ok: false, msg: 'نوع الملف غير مدعوم (صورة أو PDF فقط)' });
    const bytes = Utilities.base64Decode(body.data || '');
    if (!bytes.length || bytes.length > MAX_BYTES) return json_({ ok: false, msg: 'حجم الملف كبير جداً (الحد 6MB)' });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const r = fetchPath_('rentals/' + rid);
      if (!r || !r.uid) return json_({ ok: false, msg: 'الطلب غير موجود' });
      if (r.uid !== uid) return json_({ ok: false, msg: 'هذا الطلب لا يخصك' });
      if (r.status !== 'pending') return json_({ ok: false, msg: 'هذا الطلب ليس بانتظار الدفع' });
      if (r.receiptUrl) return json_({ ok: false, msg: 'تم رفع إيصال لهذا الطلب مسبقاً' });

      const profile = fetchPath_('users/' + uid + '/profile') || {};
      const ext = body.mimeType === 'application/pdf' ? 'pdf' : (body.mimeType.split('/')[1] || 'jpg');
      const name = [r.ref, profile.universityId || '', profile.name || '', Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd_HH-mm')]
        .join(' _ ') + '.' + ext;
      const file = receiptsFolder_().createFile(Utilities.newBlob(bytes, body.mimeType, name));
      file.setDescription('صندوق فزعة — ' + r.ref + ' — ' + (r.toolName || '') + ' — ' + omr_(r.amount) + ' ر.ع');
      const url = file.getUrl();

      const tool = fetchPath_('tools/' + r.toolId) || {};
      const upd = {};
      upd['rentals/' + rid + '/receiptUrl'] = url;
      upd['rentals/' + rid + '/receiptAt'] = { '.sv': 'timestamp' };
      let autoApproved = false;
      if (tool.status === 'available') {
        upd['rentals/' + rid + '/status'] = 'paid';
        upd['rentals/' + rid + '/paidAt'] = { '.sv': 'timestamp' };
        upd['rentals/' + rid + '/approvedBy'] = 'auto-receipt';
        upd['tools/' + r.toolId + '/status'] = 'reserved';
        autoApproved = true;
      }
      patchRoot_(upd);
      notifyReceipt_(r, profile, url, autoApproved);
      return json_({
        ok: true, autoApproved: autoApproved,
        msg: autoApproved ? 'تم استلام الإيصال وتأكيد الحجز ✅' : 'تم استلام الإيصال، وسيراجعه المسؤول قريباً'
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, msg: 'تعذّر رفع الإيصال: ' + err.message });
  }
}

function verifyIdToken_(idToken) {
  if (!idToken) throw new Error('يجب تسجيل الدخول');
  const res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true
  });
  const data = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200 || !data.users || !data.users[0]) throw new Error('انتهت الجلسة، سجّل الدخول من جديد');
  return data.users[0].localId;
}

function patchRoot_(updates) {
  const res = UrlFetchApp.fetch(DB_URL + '/.json?access_token=' + ScriptApp.getOAuthToken(), {
    method: 'patch', contentType: 'application/json', payload: JSON.stringify(updates), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('تعذّر تحديث قاعدة البيانات (' + res.getResponseCode() + ')');
}

function receiptsFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('RECEIPTS_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* أُنشئ من جديد */ }
  }
  const sheetFile = DriveApp.getFileById(SHEET_ID);
  const parents = sheetFile.getParents();
  const team = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();   // مجلد «فريق»
  const existing = team.getFoldersByName('إيصالات');
  const folder = existing.hasNext() ? existing.next() : team.createFolder('إيصالات');
  props.setProperty('RECEIPTS_FOLDER_ID', folder.getId());
  return folder;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** شغّلها مرة: تنشئ مجلد «إيصالات» داخل «فريق» وتمنح صلاحية Drive */
function setupReceipts() {
  const f = receiptsFolder_();
  Logger.log('مجلد الإيصالات: ' + f.getUrl());
}


/* =====================================================================
 *  الإيميلات التلقائية (مجانية عبر Gmail — حوالي 100 رسالة يومياً)
 * ===================================================================== */
const SITE_URL = 'https://riooo.online/';
const ADMIN_URL = SITE_URL + 'admin.html';

function money_(baisa) {
  baisa = baisa || 0;
  return baisa < 1000 ? baisa + ' بيسة' : (baisa / 1000).toFixed(3) + ' ر.ع';
}
function dueOf_(r) {
  return r.dueAt || (r.startAt ? r.startAt + (r.hours || 0) * 3600000 : 0);
}

function mailHtml_(title, rows, note, btnText, btnUrl) {
  const trs = rows.map(function (x) {
    return '<tr><td style="padding:6px 0;color:#64748B">' + x[0] + '</td><td style="padding:6px 0;font-weight:700;color:#0B192C">' + x[1] + '</td></tr>';
  }).join('');
  return '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden">' +
    '<div style="background:#0B192C;color:#fff;padding:18px;text-align:center;border-bottom:4px solid #FFD700">' +
    '<div style="font-size:20px;font-weight:800">⚡ صندوق فزعة</div></div>' +
    '<div style="padding:18px"><h2 style="margin:0 0 12px;font-size:17px;color:#0B192C">' + title + '</h2>' +
    '<table style="width:100%;font-size:14px;border-collapse:collapse">' + trs + '</table>' +
    (note ? '<p style="font-size:13px;color:#334155;line-height:1.8;margin-top:14px">' + note + '</p>' : '') +
    (btnUrl ? '<p style="text-align:center;margin-top:18px"><a href="' + btnUrl + '" style="background:#FFD700;color:#0B192C;text-decoration:none;font-weight:700;padding:10px 22px;border-radius:8px;display:inline-block">' + btnText + '</a></p>' : '') +
    '</div></div>';
}

function sendMail_(to, subject, html) {
  if (!to) return;
  try {
    MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: 'صندوق فزعة' });
  } catch (e) {
    Logger.log('mail failed to ' + to + ': ' + e.message);
  }
}

function adminEmails_(users) {
  users = users || fetchPath_('users');
  const admins = fetchPath_('admins') || {};
  const list = [];
  Object.keys(admins).forEach(function (uid) {
    const p = users[uid] && users[uid].profile;
    if (admins[uid] === true && p && p.email) list.push(p.email.toLowerCase());
  });
  const owner = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (owner) list.push(owner);
  return list.filter(function (e, i) { return e && list.indexOf(e) === i; }).join(',');
}

// عند رفع إيصال: إيميل للمشرفين + تأكيد للطالب
function notifyReceipt_(r, profile, receiptUrl, autoApproved) {
  const rows = [
    ['الطالب', profile.name || '—'], ['الرقم الجامعي', profile.universityId || '—'], ['الهاتف', profile.phone || '—'],
    ['الأداة', r.toolName], ['المدة', hoursLabel_(r.hours)], ['المبلغ', money_(r.amount)], ['الرمز المرجعي', r.ref]
  ];
  sendMail_(adminEmails_(),
    (autoApproved ? '🧾 إيصال جديد — ' : '⚠️ إيصال يحتاج مراجعة — ') + r.ref + ' — ' + (profile.name || ''),
    mailHtml_(autoApproved ? 'إيصال جديد وتم تأكيد الحجز تلقائياً' : 'إيصال جديد يحتاج مراجعتك (الأداة كانت محجوزة)',
      rows.concat([['الإيصال', '<a href="' + receiptUrl + '">عرض الإيصال</a>']]),
      'تأكد من وصول المبلغ في حسابك البنكي. إذا الإيصال غير صحيح، ارفضه من لوحة المسؤول.', 'فتح لوحة المسؤول', ADMIN_URL));

  sendMail_(profile.email,
    autoApproved ? '✅ تم تأكيد حجزك — ' + r.toolName : '🧾 استلمنا إيصالك — ' + r.toolName,
    mailHtml_(autoApproved ? 'تم تأكيد حجزك ✅' : 'استلمنا إيصالك وسنراجعه قريباً',
      [['الأداة', r.toolName], ['المدة', hoursLabel_(r.hours)], ['المبلغ', money_(r.amount)], ['الرمز المرجعي', r.ref]],
      autoApproved ? 'ادخل الموقع لاستلام الأداة. مدة الاستئجار تبدأ من لحظة الاستلام، ولا تنسَ موعد الإرجاع.' : 'الأداة كانت محجوزة لحظة رفع الإيصال، وسيتواصل معك الفريق.',
      'فتح الموقع', SITE_URL));
}

// تذكير قبل الموعد بساعة، تنبيه عند التأخير، وتأكيد بعد الإرجاع — كل إيميل يُرسل مرة واحدة فقط
function notifyRentals_(rentals, users) {
  const now = Date.now(), HOUR = 3600000;
  const upd = {};
  let admins = null;
  Object.keys(rentals).forEach(function (rid) {
    const r = rentals[rid];
    const p = (users[r.uid] && users[r.uid].profile) || {};
    if (r.status === 'active') {
      const due = dueOf_(r);
      if (!due) return;
      if (!r.remindSent && due > now && due - now <= HOUR) {
        sendMail_(p.email, '⏰ تذكير: موعد إرجاع ' + r.toolName + ' بعد أقل من ساعة',
          mailHtml_('موعد الإرجاع قرّب ⏰', [['الأداة', r.toolName], ['موعد الإرجاع', fmt_(due)]],
            'أرجع الأداة قبل الموعد. بعد انتهاء المدة لديك ساعة سماح، وبعدها تُسجَّل رسوم تأخير.', 'فتح الموقع', SITE_URL));
        upd['rentals/' + rid + '/remindSent'] = true;
      }
      if (!r.overdueSent && now > due) {
        sendMail_(p.email, '🚨 انتهت مدة استئجار ' + r.toolName,
          mailHtml_('انتهت مدة الاستئجار — أرجع الأداة الآن', [['الأداة', r.toolName], ['كان موعد الإرجاع', fmt_(due)]],
            'لديك ساعة سماح من موعد الإرجاع، بعدها تُحسب رسوم تأخير عن كل ساعة ويُمنع الحجز حتى تسويتها.', 'فتح الموقع', SITE_URL));
        admins = admins || adminEmails_(users);
        sendMail_(admins, '🚨 تأخير في الإرجاع — ' + (p.name || '') + ' — ' + r.toolName,
          mailHtml_('طالب متأخر في الإرجاع', [['الطالب', p.name || '—'], ['الرقم الجامعي', p.universityId || '—'], ['الهاتف', p.phone || '—'],
            ['الأداة', r.toolName], ['كان موعد الإرجاع', fmt_(due)]], '', 'فتح لوحة المسؤول', ADMIN_URL));
        upd['rentals/' + rid + '/overdueSent'] = true;
      }
    } else if (r.status === 'returned' && !r.returnNotified && r.returnedAt && now - r.returnedAt < 24 * HOUR) {
      sendMail_(p.email, '✅ تم إرجاع ' + r.toolName,
        mailHtml_('تم تسجيل الإرجاع، شكراً لك 🌟', [['الأداة', r.toolName], ['وقت الإرجاع', fmt_(r.returnedAt)],
          ['رسوم التأخير', r.lateFee ? money_(r.lateFee) : 'لا يوجد']],
          r.lateFee ? 'عليك رسوم تأخير، ولن تتمكن من الحجز مجدداً حتى تسويتها. تواصل مع الفريق عبر واتساب 74193388.' : 'تقدر تحجز مرة ثانية متى ما احتجت.', 'فتح الموقع', SITE_URL));
      upd['rentals/' + rid + '/returnNotified'] = true;
    }
  });
  if (Object.keys(upd).length) patchRoot_(upd);
}

/** للتجربة: يرسل إيميل تجريبي لك (ويطلب صلاحية إرسال الإيميل أول مرة) */
function testEmail() {
  sendMail_(Session.getEffectiveUser().getEmail(), '✅ تجربة إيميلات صندوق فزعة',
    mailHtml_('الإيميلات التلقائية شغّالة', [['الحالة', 'تمام']], 'بتوصلك إيميلات الإيصالات الجديدة والتأخير على هذا البريد.', 'فتح لوحة المسؤول', ADMIN_URL));
}
