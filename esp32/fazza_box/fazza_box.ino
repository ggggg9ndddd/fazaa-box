/*
 * =====================================================================
 *  صندوق فزعة — كود ESP32
 *  - يرسل نبضة "أنا متصل" إلى Firebase كل 30 ثانية
 *  - يراقب طلبات الفتح التي ينشئها الطلاب من الموقع
 *  - يتحقق من الطلب ثم يفتح قفل القسم (سيرفو) ويعيد قفله تلقائياً
 *  - يحدّث حالة الحجز: استلام (active) أو إرجاع (returned) مع رسوم التأخير
 *
 *  المكتبات المطلوبة (Arduino IDE > Library Manager):
 *   1) Firebase Arduino Client Library for ESP8266 and ESP32  (Mobizt)  — 4.4.x
 *   2) ArduinoJson  (Benoit Blanchon)  — 7.x
 *   3) ESP32Servo   (Kevin Harrington)
 *  اللوحة: ESP32 Dev Module
 * =====================================================================
 */
#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include <Firebase_ESP_Client.h>
#include <addons/TokenHelper.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// ======================= عدّل هذه القيم =======================
#define WIFI_SSID        "اسم_شبكة_الواي_فاي"
#define WIFI_PASSWORD    "كلمة_مرور_الواي_فاي"

#define API_KEY          "AIzaSyDGiQUlEJFnUDjJHOtxdtxc7R935bxi5bM"
#define DATABASE_URL     "https://fazza-33661-default-rtdb.europe-west1.firebasedatabase.app"

// حساب الصندوق في Firebase Authentication (أنشئه من Firebase Console)
#define DEVICE_EMAIL     "box@fazza.app"
#define DEVICE_PASSWORD  "ضع_كلمة_مرور_حساب_الصندوق"

// أطراف السيرفو: القسم 1 ثم القسم 2
const int  SERVO_PINS[]      = {13, 14};
const int  NUM_COMPARTMENTS  = 2;
const int  LOCKED_ANGLE      = 0;     // زاوية القفل (جرّبها على صندوقك وعدّلها)
const int  OPEN_ANGLE        = 90;    // زاوية الفتح
const unsigned long OPEN_DURATION_MS = 10000;  // مدة بقاء القسم مفتوحاً ثم يُقفل تلقائياً
const int  STATUS_LED        = 2;     // LED اللوحة: يضيء عند الاتصال
// =============================================================

const unsigned long HEARTBEAT_MS = 30000;   // نبضة كل 30 ثانية
const unsigned long POLL_MS      = 2000;    // فحص طلبات الفتح كل ثانيتين
const uint64_t UNLOCK_TTL_MS     = 60000;   // يُنفَّذ الطلب فقط إذا عمره أقل من دقيقة
const uint64_t HOUR_MS           = 3600000ULL;
const uint64_t GRACE_MS          = HOUR_MS; // ساعة سماح قبل رسوم التأخير

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;
Servo servos[NUM_COMPARTMENTS];

unsigned long lastBeat = 0, lastPoll = 0;
unsigned long openUntil[NUM_COMPARTMENTS] = {0};
String handled[16];
int handledIdx = 0;

// ---------------------------------------------------------------
uint64_t nowMs() {
  time_t t = time(nullptr);
  if (t < 1700000000) return 0;           // الوقت لم يُضبط بعد من NTP
  return (uint64_t)t * 1000ULL;
}

bool alreadyHandled(const String &id) {
  for (int i = 0; i < 16; i++) if (handled[i] == id) return true;
  return false;
}
void remember(const String &id) {
  handled[handledIdx] = id;
  handledIdx = (handledIdx + 1) % 16;
}

void lockAll() {
  for (int i = 0; i < NUM_COMPARTMENTS; i++) servos[i].write(LOCKED_ANGLE);
}

void openCompartment(int c) {
  int i = c - 1;
  Serial.printf("[LOCK] فتح القسم %d\n", c);
  servos[i].write(OPEN_ANGLE);
  openUntil[i] = millis() + OPEN_DURATION_MS;
}

void relockTick() {
  for (int i = 0; i < NUM_COMPARTMENTS; i++) {
    if (openUntil[i] && (long)(millis() - openUntil[i]) >= 0) {
      servos[i].write(LOCKED_ANGLE);
      openUntil[i] = 0;
      Serial.printf("[LOCK] قفل القسم %d\n", i + 1);
    }
  }
}

bool readJson(const String &path, JsonDocument &doc) {
  if (!Firebase.RTDB.get(&fbdo, path)) {
    Serial.printf("[FB] قراءة %s فشلت: %s\n", path.c_str(), fbdo.errorReason().c_str());
    return false;
  }
  String payload = fbdo.payload();
  if (payload == "null" || payload.length() == 0) return false;
  return deserializeJson(doc, payload) == DeserializationError::Ok;
}

// ---------------------------------------------------------------
void processRequest(const String &id, JsonObject p, uint64_t now) {
  String rid  = p["rentalId"] | "";
  String type = p["type"] | "";
  int comp    = p["compartment"] | 0;
  if (rid.isEmpty() || comp < 1 || comp > NUM_COMPARTMENTS) return;

  JsonDocument r;
  if (!readJson("/rentals/" + rid, r)) return;
  if (String(r["currentPin"] | "") != id) { Serial.println("[REQ] طلب قديم — تجاهل"); return; }
  if ((int)(r["compartment"] | 0) != comp) return;

  String status = r["status"] | "";
  bool pickup = (type == "pickup" && status == "paid");
  bool ret    = (type == "return" && status == "active");
  if (!pickup && !ret) { Serial.println("[REQ] حالة الحجز لا تسمح — تجاهل"); return; }

  // 1) تعليم الطلب كمستخدم أولاً حتى لا يُنفَّذ مرتين
  FirebaseJson used;
  used.set("used", true);
  used.set("usedAt/.sv", "timestamp");
  if (!Firebase.RTDB.updateNode(&fbdo, "/pins/" + id, &used)) {
    Serial.printf("[FB] فشل تعليم الطلب: %s\n", fbdo.errorReason().c_str());
    return;
  }

  // 2) فتح القفل
  openCompartment(comp);

  // 3) تحديث حالة الحجز
  String toolId = r["toolId"] | "";
  String uid    = r["uid"] | "";

  if (pickup) {
    FirebaseJson upd;
    upd.set("status", "active");
    upd.set("startAt/.sv", "timestamp");   // موعد الإرجاع يحسبه الموقع = startAt + المدة
    Firebase.RTDB.updateNode(&fbdo, "/rentals/" + rid, &upd);
    Firebase.RTDB.setString(&fbdo, "/tools/" + toolId + "/status", "rented");
    Serial.printf("[RENT] استلام %s\n", rid.c_str());
  } else {
    // حساب رسوم التأخير
    uint64_t due = r["dueAt"] | (uint64_t)0;
    if (!due) {
      uint64_t start = r["startAt"] | (uint64_t)0;
      int hours = r["hours"] | 0;
      due = start + (uint64_t)hours * HOUR_MS;
    }
    int fee = 0;
    if (due && now > due + GRACE_MS) {
      JsonDocument t;
      int perHour = 0;
      if (readJson("/tools/" + toolId, t)) perHour = t["lateFeePerHour"] | 0;
      uint64_t over = now - due;
      fee = (int)((over + HOUR_MS - 1) / HOUR_MS) * perHour;
    }

    FirebaseJson upd;
    upd.set("status", "returned");
    upd.set("returnedAt/.sv", "timestamp");
    upd.set("lateFee", fee);
    if (fee > 0) upd.set("lateFeePaid", false);
    Firebase.RTDB.updateNode(&fbdo, "/rentals/" + rid, &upd);
    Firebase.RTDB.setString(&fbdo, "/tools/" + toolId + "/status", "available");
    Firebase.RTDB.deleteNode(&fbdo, "/users/" + uid + "/state/activeByTool/" + toolId);
    if (Firebase.RTDB.getString(&fbdo, "/users/" + uid + "/state/activeRental") && fbdo.stringData() == rid)
      Firebase.RTDB.deleteNode(&fbdo, "/users/" + uid + "/state/activeRental");   // صيغة قديمة
    if (fee > 0) {
      int current = 0;
      if (Firebase.RTDB.getInt(&fbdo, "/users/" + uid + "/state/lateFeeDue")) current = fbdo.intData();
      Firebase.RTDB.setInt(&fbdo, "/users/" + uid + "/state/lateFeeDue", current + fee);
    }
    Serial.printf("[RENT] إرجاع %s — رسوم تأخير: %d بيسة\n", rid.c_str(), fee);
  }
}

void pollRequests() {
  uint64_t now = nowMs();
  if (!now) return;

  QueryFilter q;
  q.orderBy("createdAt");
  q.limitToLast(5);
  bool ok = Firebase.RTDB.getJSON(&fbdo, "/pins", &q);
  q.clear();
  if (!ok) { Serial.printf("[FB] قراءة الطلبات فشلت: %s\n", fbdo.errorReason().c_str()); return; }

  JsonDocument doc;
  if (deserializeJson(doc, fbdo.payload())) return;
  for (JsonPair kv : doc.as<JsonObject>()) {
    String id = kv.key().c_str();
    JsonObject p = kv.value().as<JsonObject>();
    if (p["used"] | false) continue;
    uint64_t created = p["createdAt"] | (uint64_t)0;
    if (!created || now > created + UNLOCK_TTL_MS) continue;   // طلب قديم
    if (alreadyHandled(id)) continue;
    remember(id);
    Serial.printf("[REQ] طلب فتح %s (%s)\n", id.c_str(), String(p["type"] | "").c_str());
    processRequest(id, p, now);
  }
}

// ---------------------------------------------------------------
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] جارٍ الاتصال");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? " متصل" : " فشل — سيعيد المحاولة");
}

void setup() {
  Serial.begin(115200);
  pinMode(STATUS_LED, OUTPUT);
  for (int i = 0; i < NUM_COMPARTMENTS; i++) {
    servos[i].setPeriodHertz(50);
    servos[i].attach(SERVO_PINS[i], 500, 2400);
  }
  lockAll();   // الأقفال مغلقة دائماً عند التشغيل

  connectWiFi();
  configTime(0, 0, "pool.ntp.org", "time.google.com");

  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  auth.user.email = DEVICE_EMAIL;
  auth.user.password = DEVICE_PASSWORD;
  config.token_status_callback = tokenStatusCallback;
  Firebase.reconnectWiFi(true);
  fbdo.setResponseSize(4096);
  Firebase.begin(&config, &auth);
}

void loop() {
  relockTick();

  bool online = WiFi.status() == WL_CONNECTED && Firebase.ready();
  digitalWrite(STATUS_LED, online ? HIGH : LOW);

  if (WiFi.status() != WL_CONNECTED) {
    // بدون إنترنت: الأقفال تبقى مغلقة ولا تُنفَّذ أي طلبات
    static unsigned long lastTry = 0;
    if (millis() - lastTry > 10000) { lastTry = millis(); WiFi.reconnect(); }
    return;
  }
  if (!online) return;

  if (millis() - lastBeat >= HEARTBEAT_MS || lastBeat == 0) {
    lastBeat = millis();
    if (!Firebase.RTDB.setTimestamp(&fbdo, "/box/lastSeen"))
      Serial.printf("[FB] النبضة فشلت: %s\n", fbdo.errorReason().c_str());
  }

  if (millis() - lastPoll >= POLL_MS) {
    lastPoll = millis();
    pollRequests();
  }
}
