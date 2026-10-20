/*
 * =====================================================================
 *  صندوق فزعة — كود ESP32 (يتصل بـ Firebase مباشرة عبر REST)
 *
 *  كيف يشتغل:
 *   - كل 30 ثانية يكتب box/lastSeen  ← الموقع يعرض «الصندوق متصل»
 *   - الطالب يطلب رمز (6 أرقام) من الموقع ويكتبه في لوحة الأرقام ثم #
 *   - الصندوق يتحقق من الرمز في Firebase، يفتح القسم، ويحدّث الحجز:
 *       استلام  ← status = active (يبدأ وقت الإيجار)
 *       إرجاع   ← status = returning + رسوم التأخير (تبدأ مباشرة بعد انتهاء المدة)
 *                  ثم الطالب يضغط «تم الإرجاع» في الموقع
 *   - *  = مسح الإدخال
 *
 *  المكتبات (Library Manager):  ArduinoJson (7.x) + ESP32Servo + Keypad (Mark Stanley)
 *  اللوحة: ESP32 Dev Module
 * =====================================================================
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <Keypad.h>
#include <time.h>

// ======================= عدّل هذه القيم =======================
const char* WIFI_SSID     = "YOUR_WIFI_NAME";        // شبكة 2.4GHz
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// حساب الصندوق في Firebase Authentication
const char* FIREBASE_EMAIL    = "box@fazza.app";
const char* FIREBASE_PASSWORD = "YOUR_BOX_ACCOUNT_PASSWORD";
// =============================================================

const char* FIREBASE_API_KEY = "AIzaSyDGiQUlEJFnUDjJHOtxdtxc7R935bxi5bM";
const char* DB_URL = "https://fazza-33661-default-rtdb.europe-west1.firebasedatabase.app";

// السيرفوهات (نفس توصيلاتك الحالية)
const int SERVO_PINS[2]   = {18, 19};   // القسم 1 ، القسم 2
const int LOCKED_ANGLE    = 0;
const int UNLOCKED_ANGLE  = 90;
const unsigned long OPEN_TIME = 10000;  // كم يبقى القسم مفتوح (10 ثواني)
const int STATUS_LED = 2;               // LED اللوحة يضيء لما يكون متصل

// لوحة الأرقام 4×3 (نفس توصيلاتك الحالية)
const byte ROWS = 4, COLS = 3;
char keys[ROWS][COLS] = { {'1','2','3'}, {'4','5','6'}, {'7','8','9'}, {'*','0','#'} };
byte rowPins[ROWS] = {13, 14, 27, 26};
byte colPins[COLS] = {25, 33, 32};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);
String entered = "";

const unsigned long HEARTBEAT_MS = 30000;
const unsigned long RELOGIN_MS   = 50UL * 60UL * 1000UL;  // التوكن يعيش ساعة
const long long PIN_TTL_MS       = 10LL * 60LL * 1000LL;   // الرمز صالح 10 دقائق
const long long HOUR_MS          = 3600000LL;

Servo servos[2];
unsigned long openSince[2] = {0, 0};
bool isOpen[2] = {false, false};

WiFiClientSecure tls;
String idToken = "";
unsigned long tokenAt = 0, lastBeat = 0;

// ---------------------------------------------------------------
long long nowMs() {
  time_t t = time(nullptr);
  return t < 1700000000 ? 0 : (long long)t * 1000LL;
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] Connecting");
  unsigned long s = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - s < 20000) { delay(500); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? " connected" : " FAILED");
}

void syncTime() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  unsigned long s = millis();
  while (nowMs() == 0 && millis() - s < 15000) delay(300);
  Serial.println(nowMs() ? "[TIME] synced" : "[TIME] FAILED");
}

// طلب HTTPS عام. يرجع كود HTTP ويحط الرد في out
int request(const String& method, const String& url, const String& body, String& out) {
  HTTPClient http;
  http.setTimeout(8000);
  if (!http.begin(tls, url)) return -1;
  if (body.length()) http.addHeader("Content-Type", "application/json");
  int code = http.sendRequest(method.c_str(), body);
  out = code > 0 ? http.getString() : "";
  http.end();
  return code;
}

bool firebaseLogin() {
  String url = String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=") + FIREBASE_API_KEY;
  JsonDocument req;
  req["email"] = FIREBASE_EMAIL;
  req["password"] = FIREBASE_PASSWORD;
  req["returnSecureToken"] = true;
  String body, resp;
  serializeJson(req, body);
  int code = request("POST", url, body, resp);
  if (code != 200) { Serial.printf("[AUTH] login failed %d\n%s\n", code, resp.c_str()); return false; }
  JsonDocument r;
  if (deserializeJson(r, resp) || r["idToken"].isNull()) return false;
  idToken = r["idToken"].as<String>();
  tokenAt = millis();
  Serial.printf("[AUTH] OK — box UID: %s\n", r["localId"].as<const char*>());
  return true;
}

// عملية على قاعدة البيانات مع إعادة تسجيل الدخول تلقائياً إذا انتهى التوكن
int db(const String& method, const String& path, const String& body, String& out, const String& query = "") {
  if (idToken.isEmpty() || millis() - tokenAt > RELOGIN_MS) firebaseLogin();
  String url = String(DB_URL) + path + ".json?auth=" + idToken + query;
  int code = request(method, url, body, out);
  if (code == 401 || code == 403) {
    if (code == 401 && firebaseLogin()) {
      url = String(DB_URL) + path + ".json?auth=" + idToken + query;
      code = request(method, url, body, out);
    }
  }
  if (code != 200 && code != 204) Serial.printf("[DB] %s %s -> %d %s\n", method.c_str(), path.c_str(), code, out.c_str());
  return code;
}

// ---------------------------------------------------------------
void openCompartment(int c) {
  int i = c - 1;
  servos[i].write(UNLOCKED_ANGLE);
  isOpen[i] = true;
  openSince[i] = millis();
  Serial.printf("[LOCK] Compartment %d OPEN\n", c);
}

void relockTick() {
  for (int i = 0; i < 2; i++) {
    if (isOpen[i] && millis() - openSince[i] >= OPEN_TIME) {
      servos[i].write(LOCKED_ANGLE);
      isOpen[i] = false;
      Serial.printf("[LOCK] Compartment %d locked\n", i + 1);
    }
  }
}

// ---------------------------------------------------------------
bool processCode(const String& id, long long now) {
  String resp;
  if (db("GET", "/pins/" + id, "", resp) != 200) return false;
  JsonDocument pd;
  if (deserializeJson(pd, resp) || pd.isNull()) { Serial.println("[PIN] wrong code"); return false; }
  JsonObject p = pd.as<JsonObject>();
  if (p["used"] | false) { Serial.println("[PIN] code already used"); return false; }
  long long created = p["createdAt"] | 0LL;
  if (!created || now - created > PIN_TTL_MS) { Serial.println("[PIN] code expired"); return false; }

  String rid  = p["rentalId"] | "";
  String type = p["type"] | "";
  int comp    = p["compartment"] | 0;
  if (rid.isEmpty() || comp < 1 || comp > 2) return false;

  if (db("GET", "/rentals/" + rid, "", resp) != 200) return false;
  JsonDocument r;
  if (deserializeJson(r, resp) || r.isNull()) return false;

  if (String(r["currentPin"] | "") != id) { Serial.println("[PIN] old code"); return false; }
  if ((int)(r["compartment"] | 0) != comp) return false;

  String status = r["status"] | "";
  bool pickup = (type == "pickup" && status == "paid");
  bool ret    = (type == "return" && status == "active");
  if (!pickup && !ret) { Serial.println("[PIN] rental state does not allow"); return false; }

  long long start = r["startAt"] | 0LL;
  long long due   = r["dueAt"] | 0LL;
  if (!due && start) due = start + (long long)(r["hours"] | 0) * HOUR_MS;
  if (ret && now < due) { Serial.println("[PIN] return before time ends"); return false; }

  // 1) علّم الرمز مستخدم قبل الفتح (ما ينفتح مرتين)
  if (db("PATCH", "/pins/" + id, "{\"used\":true,\"usedAt\":{\".sv\":\"timestamp\"}}", resp) != 200) {
    Serial.println("[PIN] could not consume code — NOT opening");
    return false;
  }

  // 2) افتح القفل
  openCompartment(comp);

  String toolId = r["toolId"] | "";
  String uid    = r["uid"] | "";
  JsonDocument upd;

  if (pickup) {
    upd["rentals/" + rid + "/status"] = "active";
    upd["rentals/" + rid + "/startAt"][".sv"] = "timestamp";
    upd["tools/" + toolId + "/status"] = "rented";
    Serial.printf("[RENT] pickup %s\n", rid.c_str());
  } else {
    int fee = 0;
    if (due && now > due) {                       // رسوم التأخير تبدأ مباشرة بعد انتهاء المدة
      int perHour = 0;
      if (db("GET", "/tools/" + toolId + "/lateFeePerHour", "", resp) == 200) perHour = resp.toInt();
      long long over = now - due;
      fee = (int)((over + HOUR_MS - 1) / HOUR_MS) * perHour;
    }
    // الطالب يحط الأداة ويضغط «تم الإرجاع» في الموقع ← تصير الأداة متاحة
    upd["rentals/" + rid + "/status"] = "returning";
    upd["rentals/" + rid + "/returnedAt"][".sv"] = "timestamp";
    upd["rentals/" + rid + "/lateFee"] = fee;
    if (fee > 0) upd["rentals/" + rid + "/lateFeePaid"] = false;
    if (fee > 0) {
      int current = 0;
      if (db("GET", "/users/" + uid + "/state/lateFeeDue", "", resp) == 200) current = resp.toInt();
      upd["users/" + uid + "/state/lateFeeDue"] = current + fee;
    }
    Serial.printf("[RENT] return %s — late fee %d baisa\n", rid.c_str(), fee);
  }

  String body;
  serializeJson(upd, body);
  db("PATCH", "", body, resp);   // تحديث كل المسارات مرة وحدة
  return true;
}

void blinkError() {
  for (int i = 0; i < 3; i++) { digitalWrite(STATUS_LED, LOW); delay(150); digitalWrite(STATUS_LED, HIGH); delay(150); }
}

void handleKeypad() {
  char key = keypad.getKey();
  if (key == NO_KEY) return;
  if (key == '*') { entered = ""; Serial.println("\n[KEY] cleared"); return; }
  if (key == '#') {
    Serial.println();
    String code = entered;
    entered = "";
    if (code.length() != 6) { Serial.println("[KEY] enter 6 digits then #"); blinkError(); return; }
    long long now = nowMs();
    if (!now || WiFi.status() != WL_CONNECTED) { Serial.println("[KEY] offline — denied"); blinkError(); return; }
    Serial.println("[KEY] checking code...");
    if (!processCode(code, now)) { Serial.println("[KEY] ACCESS DENIED"); blinkError(); }
    return;
  }
  if (key >= '0' && key <= '9' && entered.length() < 6) { entered += key; Serial.print("*"); }
}

// ---------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(STATUS_LED, OUTPUT);
  for (int i = 0; i < 2; i++) {
    servos[i].setPeriodHertz(50);
    servos[i].attach(SERVO_PINS[i], 500, 2400);
    servos[i].write(LOCKED_ANGLE);     // مقفل دائماً عند التشغيل
  }
  tls.setInsecure();                   // نموذج أولي: بدون التحقق من شهادة الخادم

  connectWiFi();
  if (WiFi.status() == WL_CONNECTED) { syncTime(); firebaseLogin(); }
  Serial.println("=== FAZZA BOX READY — enter 6-digit code then # ===");
}

void loop() {
  relockTick();

  if (WiFi.status() != WL_CONNECTED) {
    digitalWrite(STATUS_LED, LOW);
    static unsigned long lastTry = 0;
    if (millis() - lastTry > 10000) { lastTry = millis(); WiFi.reconnect(); }
    return;   // بدون إنترنت: الأقفال تبقى مسكّرة
  }
  if (nowMs() == 0) { syncTime(); return; }
  digitalWrite(STATUS_LED, idToken.length() ? HIGH : LOW);

  if (lastBeat == 0 || millis() - lastBeat >= HEARTBEAT_MS) {
    lastBeat = millis();
    String resp;
    if (db("PUT", "/box/lastSeen", "{\".sv\":\"timestamp\"}", resp) == 200) Serial.println("[BEAT] online");
  }
  handleKeypad();
}
