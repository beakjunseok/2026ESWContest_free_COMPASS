/*
 * noise_node - 층간소음 센서 노드 (ESP32)
 *
 * 보드 1대가 3개 층의 바닥 센서(소리 + 진동)를 읽어 Supabase 의 sensor_readings 에
 * 층별 1행씩, 총 3행을 2초마다 배치 INSERT 한다. 기준 초과 판정과 noise_events /
 * alerts 생성은 DB 트리거 fn_process_sensor_reading() 이 담당하므로 노드는 원시
 * 측정값만 올린다 (RLS 상 노드가 직접 INSERT 할 수 있는 테이블도 sensor_readings 뿐).
 *
 * 핀 배치 (전부 ADC1 — WiFi 사용 중 ADC2 핀은 불안정하므로 사용 금지)
 *   1층 SOUND1 GPIO34 / VIB1 GPIO36
 *   2층 SOUND2 GPIO35 / VIB2 GPIO39
 *   3층 SOUND3 GPIO32 / VIB3 GPIO33
 *
 * 측정 방식
 *   300ms 를 한 윈도우로 6채널을 번갈아 고속 샘플링하며 채널별 피크투피크(max-min)를 구한다.
 *   업로드 주기(2초) 동안 나온 윈도우 피크들의 최댓값을 전송한다. 300ms 한 구간만 떠서
 *   보내면 나머지 시간에 발생한 충격을 통째로 놓치므로, 주기 내내 연속 측정해 최댓값을
 *   보낸다. 순간 최고값을 보는 방식이라 DB 트리거가 쓰는 최고소음도(Lmax) 판정과 맞는다.
 *
 * 전송 값의 스케일 (중요)
 *   floor_sound_db     소리센서 피크투피크를 dB 로 선형 환산한 값
 *   floor_vibration    진동센서 피크투피크를 "같은 dB 스케일"로 선형 환산한 값
 *   트리거가 floor_vibration 을 충격소음 기준(주간 57 / 야간 52 dB)과 직접 비교하므로,
 *   진동값도 0~100 같은 임의 지수가 아니라 반드시 dB 스케일이어야 한다.
 *   아래 SOUND_* / VIB_* 상수는 근사치이며 현장 캘리브레이션이 필요하다 (README 참고).
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ═══════════════════════════════════════════════════════════════════════════
//  설정 — 업로드 전에 이 블록만 채우면 된다
//
//  주의: 여기에 적은 WiFi 비밀번호와 anon key 는 이 .ino 파일에 그대로 남는다.
//  .gitignore 는 arduino/ ** /config.h 만 제외하므로 이 파일은 커밋 대상이다.
//  레포를 공개할 거라면 커밋 전에 값을 비우거나 이 블록을 별도 헤더로 분리할 것.
// ═══════════════════════════════════════════════════════════════════════════

// ── WiFi ────────────────────────────────────────────────────────────────────
#define WIFI_SSID       "여기에_WiFi_이름"
#define WIFI_PASS       "여기에_WiFi_비밀번호"

// ── Supabase ────────────────────────────────────────────────────────────────
// Project Settings > API 에서 확인. URL 끝에 / 를 붙이지 말 것.
#define SUPABASE_URL       "https://xxxxxxxxxxxxxxxx.supabase.co"
#define SUPABASE_ANON_KEY  "여기에_anon_public_key"

// ── 이 노드가 담당하는 층 ───────────────────────────────────────────────────
// floors 테이블에 실제로 존재하는 id 여야 한다 (없으면 FK 위반으로 INSERT 실패).
// 배열 순서 = 아래 PIN_SOUND / PIN_VIB 인덱스 순서
#define FLOOR_ID_1  1   // SOUND1(GPIO34) + VIB1(GPIO36)
#define FLOOR_ID_2  2   // SOUND2(GPIO35) + VIB2(GPIO39)
#define FLOOR_ID_3  3   // SOUND3(GPIO32) + VIB3(GPIO33)

// ── 타이밍 ──────────────────────────────────────────────────────────────────
static const uint32_t SAMPLE_WINDOW_MS   = 300;    // 피크 측정 구간
static const uint32_t UPLOAD_INTERVAL_MS = 2000;   // 전송 주기

// ── 캘리브레이션 (현장에서 반드시 재측정) ───────────────────────────────────
// ADC 피크투피크 값을 dB 로 선형 환산한다.
//   pp <= *_ADC_PP_MIN  ->  *_DB_MIN
//   pp >= *_ADC_PP_MAX  ->  *_DB_MAX
// 조정 방법: 조용한 상태에서 시리얼에 찍히는 pp 를 읽어 *_ADC_PP_MIN 으로,
// 기준을 확실히 넘는 소음/충격을 줬을 때의 pp 를 *_ADC_PP_MAX 로 넣는다.
// 그 다음 소음측정기(스마트폰 앱 가능)와 dB 출력을 비교하며 *_DB_MIN/MAX 를 미세조정한다.
static const int    SOUND_ADC_PP_MIN = 30;
static const int    SOUND_ADC_PP_MAX = 2200;
static const double SOUND_DB_MIN     = 30.0;
static const double SOUND_DB_MAX     = 100.0;

static const int    VIB_ADC_PP_MIN   = 20;
static const int    VIB_ADC_PP_MAX   = 1800;
static const double VIB_DB_MIN       = 30.0;
static const double VIB_DB_MAX       = 90.0;

// ═══════════════════════════════════════════════════════════════════════════
//  설정 끝
// ═══════════════════════════════════════════════════════════════════════════

// ── 핀맵 (인덱스 = 층 순서) ─────────────────────────────────────────────────
const int PIN_SOUND[3] = {34, 35, 32};  // SOUND1, SOUND2, SOUND3
const int PIN_VIB[3]   = {36, 39, 33};  // VIB1,   VIB2,   VIB3

const int FLOOR_ID[3]  = {FLOOR_ID_1, FLOOR_ID_2, FLOOR_ID_3};

// ── 상태 ────────────────────────────────────────────────────────────────────
static double peakSoundDb[3];
static double peakVibDb[3];
static uint32_t lastUploadMs = 0;

static WiFiClientSecure tlsClient;

// GPIO36(ADC1_CH0) / GPIO39(ADC1_CH3) 는 채널 전환 직후 첫 샘플이 낮게 튀는 알려진
// 이슈가 있어 한 번 읽고 버린다. 나머지 핀은 그대로 읽는다.
static inline int adcRead(int pin) {
  if (pin == 36 || pin == 39) analogRead(pin);
  return analogRead(pin);
}

// 피크투피크(ADC) -> dB 선형 환산
static double ppToDb(int pp, int ppMin, int ppMax, double dbMin, double dbMax) {
  if (pp <= ppMin) return dbMin;
  if (pp >= ppMax) return dbMax;
  return dbMin + (double)(pp - ppMin) * (dbMax - dbMin) / (double)(ppMax - ppMin);
}

// ── WiFi ────────────────────────────────────────────────────────────────────
static void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.printf("[WiFi] connecting to %s ...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] connected, ip=%s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("[WiFi] connect timeout, will retry");
  }
}

// ── 한 윈도우(300ms) 샘플링 -> 층별 피크 갱신 ───────────────────────────────
static void sampleWindow() {
  int sMin[3], sMax[3], vMin[3], vMax[3];
  for (int i = 0; i < 3; i++) {
    sMin[i] = 4095; sMax[i] = 0;
    vMin[i] = 4095; vMax[i] = 0;
  }

  uint32_t start = millis();
  while (millis() - start < SAMPLE_WINDOW_MS) {
    for (int i = 0; i < 3; i++) {
      int s = adcRead(PIN_SOUND[i]);
      if (s < sMin[i]) sMin[i] = s;
      if (s > sMax[i]) sMax[i] = s;

      int v = adcRead(PIN_VIB[i]);
      if (v < vMin[i]) vMin[i] = v;
      if (v > vMax[i]) vMax[i] = v;
    }
  }

  for (int i = 0; i < 3; i++) {
    double sdb = ppToDb(sMax[i] - sMin[i],
                        SOUND_ADC_PP_MIN, SOUND_ADC_PP_MAX, SOUND_DB_MIN, SOUND_DB_MAX);
    double vdb = ppToDb(vMax[i] - vMin[i],
                        VIB_ADC_PP_MIN, VIB_ADC_PP_MAX, VIB_DB_MIN, VIB_DB_MAX);

    if (sdb > peakSoundDb[i]) peakSoundDb[i] = sdb;
    if (vdb > peakVibDb[i])   peakVibDb[i]   = vdb;
  }
}

static void resetPeaks() {
  for (int i = 0; i < 3; i++) {
    peakSoundDb[i] = SOUND_DB_MIN;
    peakVibDb[i]   = VIB_DB_MIN;
  }
}

// ── Supabase REST POST ──────────────────────────────────────────────────────
static int supabasePost(const char* path, const String& body) {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    if (WiFi.status() != WL_CONNECTED) return -1;
  }

  HTTPClient http;
  String url = String(SUPABASE_URL) + path;
  if (!http.begin(tlsClient, url)) {
    Serial.println("[HTTP] begin failed");
    return -1;
  }

  http.setTimeout(8000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Prefer", "return=minimal");   // 응답 본문 생략

  int code = http.POST(body);
  if (code <= 0) {
    Serial.printf("[HTTP] POST %s failed: %s\n", path, http.errorToString(code).c_str());
  } else if (code < 200 || code >= 300) {
    Serial.printf("[HTTP] POST %s -> %d %s\n", path, code, http.getString().c_str());
  } else {
    Serial.printf("[HTTP] POST %s -> %d OK\n", path, code);
  }
  http.end();
  return code;
}

// ── sensor_readings 배치 INSERT (3층 = 3행을 한 번에) ───────────────────────
// created_at 은 보내지 않고 DB 의 default now() 를 쓴다.
static void uploadReadings() {
  String body = "[";
  for (int i = 0; i < 3; i++) {
    char row[128];
    snprintf(row, sizeof(row),
             "%s{\"floor_id\":%d,\"floor_sound_db\":%.2f,\"floor_vibration\":%.2f}",
             (i == 0 ? "" : ","), FLOOR_ID[i], peakSoundDb[i], peakVibDb[i]);
    body += row;
  }
  body += "]";

  Serial.printf("[TX] %s\n", body.c_str());

  int code = supabasePost("/rest/v1/sensor_readings", body);
  if (code < 200 || code >= 300) {
    delay(300);
    supabasePost("/rest/v1/sensor_readings", body);   // 1회 재시도
  }
}

// ── setup / loop ────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);

  analogReadResolution(12);          // 0 ~ 4095
  analogSetAttenuation(ADC_11db);    // 입력 범위 0 ~ 약 3.1V
  for (int i = 0; i < 3; i++) {
    pinMode(PIN_SOUND[i], INPUT);
    pinMode(PIN_VIB[i],   INPUT);
  }

  resetPeaks();
  connectWiFi();

  // 데모 편의를 위해 TLS 인증서 검증을 생략한다.
  // 운영 시에는 tlsClient.setCACert(...) 로 루트 CA 를 고정할 것 (README 5장).
  tlsClient.setInsecure();

  lastUploadMs = millis();
}

void loop() {
  sampleWindow();

  if (millis() - lastUploadMs >= UPLOAD_INTERVAL_MS) {
    lastUploadMs = millis();

    for (int i = 0; i < 3; i++) {
      Serial.printf("  floor_id=%d  sound=%.1f dB  vib=%.1f dB\n",
                    FLOOR_ID[i], peakSoundDb[i], peakVibDb[i]);
    }
    uploadReadings();
    resetPeaks();
  }
}
