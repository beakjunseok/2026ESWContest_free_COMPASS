/*
  noise_node.ino
  아파트 층간소음 감지 노드 (ESP32) — 층마다 한 대씩 설치

  센서 4개 (천장 2개 + 바닥 2개):
    - 천장 소리센서 (KY-038 등)   : 윗집과 맞닿은 슬라브 쪽, 공기전달음 감지
    - 천장 진동센서 (SW-420 등)   : 윗집과 맞닿은 슬라브 쪽, 충격 감지
    - 바닥 소리센서               : 아랫집과 맞닿은 슬라브 쪽 (=이 집 바닥), 자기 집 소음 감지
    - 바닥 진동센서               : 아랫집과 맞닿은 슬라브 쪽 (=이 집 바닥), 자기 집 충격 감지

  동작:
    1) 주기적으로 4개 센서를 샘플링해 dB 근사값으로 환산 후 Supabase(sensor_readings)에 전송
    2) 소음 발생 위치 판정과 기준 초과 여부는 Supabase 쪽 DB 트리거가 처리 (supabase/migrations 참고)
    3) 이 노드는 자기 층(FLOOR_ID) 앞으로 대기 중(pending) 경고가 있는지 주기적으로 조회한다.
       - 경비실이 직접 쓴 음성 메시지가 있으면(audio_url 있음) 그 wav를 재생
       - 자동 감지 경보, 또는 경비실이 "정해진 경고 음성 보내기"를 누른 경우(audio_url 없음)는
         config.h의 DEFAULT_ALERT_URL(고정 경고 음성)을 재생
       모든 경고가 부저 삑삑 소리가 아니라 실제 음성으로 재생된다. 재생 후 상태를 delivered로
       갱신한다.

  필요 라이브러리 (Arduino IDE 라이브러리 매니저):
    - ArduinoJson (bblanchon)
    - ESP8266Audio (Earle F. Philhower) — wav 재생 + I2S 출력, ESP32에서도 동작
    - arduino-esp32 코어 2.x 이상 (LittleFS 사용)
    Tools > Partition Scheme 은 LittleFS가 포함된 옵션(예: "Default 4MB with spiffs")을 선택하세요.
    (서버가 보내는 wav는 24kHz/16bit/mono 비압축이라 메시지가 길수록 파일이 커집니다.
    LittleFS 여유 공간과 다운로드 시간을 고려해 메시지를 너무 길게 쓰지 않는 게 좋습니다.)

  주의: 부저를 쓰지 않으므로 모든 경고 재생은 WiFi로 wav를 내려받아야 합니다. 네트워크가
  끊긴 순간에는 경고음 자체가 나오지 않습니다 (README 한계 항목 참고).

  배선 전 반드시 config.h를 만드세요: config.example.h를 복사해 config.h로 저장하고
  WiFi/Supabase 정보를 채워 넣습니다. config.h는 git에 커밋하지 않습니다 (.gitignore 참고).
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <AudioFileSourceLittleFS.h>
#include <AudioGeneratorWAV.h>
#include <AudioOutputI2S.h>
#include "config.h"

// ---- 핀 배치 (ESP32, ADC1 채널만 사용: WiFi 사용 중 ADC2 핀은 불안정) ----
static const int PIN_CEILING_SOUND     = 34;
static const int PIN_CEILING_VIBRATION = 35;
static const int PIN_FLOOR_SOUND       = 32;
static const int PIN_FLOOR_VIBRATION   = 33;

// I2S 오디오 앰프(MAX98357A 등) — 모든 경고 음성 재생용
static const int PIN_I2S_BCLK = 26;
static const int PIN_I2S_LRC  = 27;
static const int PIN_I2S_DOUT = 14;

static const char* VOICE_MSG_PATH = "/msg.wav";

// ---- 센서 dB 환산 보정값 (반드시 현장에서 소음측정기로 실측해 재보정할 것) ----
// ADC 최소/최대값을 실제 소음계 dB 최소/최대값에 선형 매핑한 근사치입니다.
static const int    ADC_MAX_VALUE   = 4095; // ESP32 ADC 12bit
static const float  SOUND_DB_MIN    = 30.0;  // ADC=0 근방일 때의 근사 dB
static const float  SOUND_DB_MAX    = 100.0; // ADC=4095 근방일 때의 근사 dB
static const float  VIB_DB_MIN      = 25.0;
static const float  VIB_DB_MAX      = 90.0;

static const unsigned long SEND_INTERVAL_MS  = 2000; // 센서값 전송 주기
static const unsigned long POLL_INTERVAL_MS  = 3000; // 경고 대기열 조회 주기
static const int    SAMPLE_WINDOW_MS         = 300;   // 한 번 측정 시 피크를 잡기 위한 샘플링 창

unsigned long lastSendAt = 0;
unsigned long lastPollAt = 0;

WiFiClientSecure secureClient;

float adcToDb(int adcPeak, float dbMin, float dbMax) {
  float ratio = constrain((float)adcPeak / (float)ADC_MAX_VALUE, 0.0, 1.0);
  return dbMin + ratio * (dbMax - dbMin);
}

// 짧은 구간 동안 반복 샘플링해 피크값을 잡는다 (순간 충격/소리를 놓치지 않기 위함)
int samplePeak(int pin) {
  unsigned long start = millis();
  int peak = 0;
  while (millis() - start < SAMPLE_WINDOW_MS) {
    int v = analogRead(pin);
    if (v > peak) peak = v;
    delayMicroseconds(500);
  }
  return peak;
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("WiFi 연결 중: %s", WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.printf("\nWiFi 연결됨. IP=%s\n", WiFi.localIP().toString().c_str());
}

void ensureWiFi() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi 끊김, 재연결 시도");
    connectWiFi();
  }
}

// Supabase REST에 센서 측정값 한 건을 INSERT
void sendReading(float ceilingSoundDb, float ceilingVibDb, float floorSoundDb, float floorVibDb) {
  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/sensor_readings";

  http.begin(secureClient, url);
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");

  StaticJsonDocument<256> doc;
  doc["floor_id"] = FLOOR_ID;
  doc["ceiling_sound_db"] = ceilingSoundDb;
  doc["ceiling_vibration"] = ceilingVibDb;
  doc["floor_sound_db"] = floorSoundDb;
  doc["floor_vibration"] = floorVibDb;

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  if (code <= 0 || code >= 300) {
    Serial.printf("[sendReading] 실패 code=%d resp=%s\n", code, http.getString().c_str());
  }
  http.end();
}

struct PendingAlert {
  long alertId;
  String audioUrl; // 비어 있으면 경비실이 직접 쓴 메시지가 없음 (DEFAULT_ALERT_URL 재생)
};

// 이 층(FLOOR_ID) 앞으로 대기 중인 경고가 있는지 확인, 있으면 내용 반환
bool fetchPendingAlert(PendingAlert &alert) {
  HTTPClient http;
  String url = String(SUPABASE_URL) +
               "/rest/v1/alerts?floor_id=eq." + String(FLOOR_ID) +
               "&status=eq.pending&order=created_at.asc&limit=1&select=id,audio_url";

  http.begin(secureClient, url);
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);

  int code = http.GET();
  bool found = false;
  if (code == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(1024);
    if (deserializeJson(doc, payload) == DeserializationError::Ok && doc.is<JsonArray>() && doc.size() > 0) {
      alert.alertId = doc[0]["id"].as<long>();
      alert.audioUrl = doc[0]["audio_url"].isNull() ? "" : String(doc[0]["audio_url"].as<const char*>());
      found = true;
    }
  } else {
    Serial.printf("[fetchPendingAlert] 실패 code=%d\n", code);
  }
  http.end();
  return found;
}

// 경고 상태를 delivered로 갱신
void markAlertDelivered(long alertId) {
  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/alerts?id=eq." + String(alertId);

  http.begin(secureClient, url);
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");

  // delivered_at은 DB 쪽 default now()로 채우도록 두고 status만 갱신한다
  StaticJsonDocument<64> doc;
  doc["status"] = "delivered";
  String body;
  serializeJson(doc, body);

  int code = http.sendRequest("PATCH", body);
  if (code <= 0 || code >= 300) {
    Serial.printf("[markAlertDelivered] 실패 code=%d\n", code);
  }
  http.end();
}

// 재생할 음성(wav)을 LittleFS에 통째로 내려받는다.
// (스트리밍 디코딩 대신 파일로 받아 재생하는 방식이 HTTPS 환경에서 훨씬 안정적이다)
bool downloadAudioToFlash(const String &url, const char *path) {
  HTTPClient http;
  http.begin(secureClient, url);
  int code = http.GET();
  if (code != 200) {
    Serial.printf("[downloadAudioToFlash] 실패 code=%d\n", code);
    http.end();
    return false;
  }

  LittleFS.remove(path);
  File f = LittleFS.open(path, "w");
  if (!f) {
    Serial.println("[downloadAudioToFlash] LittleFS 파일 열기 실패");
    http.end();
    return false;
  }

  int contentLength = http.getSize();
  WiFiClient *stream = http.getStreamPtr();
  uint8_t buf[512];
  int total = 0;
  unsigned long lastByteAt = millis();

  while (http.connected() && (contentLength <= 0 || total < contentLength)) {
    size_t avail = stream->available();
    if (avail > 0) {
      int n = stream->readBytes(buf, avail > sizeof(buf) ? sizeof(buf) : avail);
      f.write(buf, n);
      total += n;
      lastByteAt = millis();
    } else if (millis() - lastByteAt > 8000) {
      Serial.println("[downloadAudioToFlash] 타임아웃");
      break;
    } else {
      delay(5);
    }
  }

  f.close();
  http.end();
  Serial.printf("[downloadAudioToFlash] %d바이트 저장 완료\n", total);
  return total > 0;
}

// url의 wav를 내려받아 I2S 앰프로 재생 (블로킹 — 재생이 끝날 때까지 대기)
void playVoiceMessage(const String &url) {
  Serial.printf(">>> 층간소음 경고: 음성 재생 (%s) <<<\n", url.c_str());

  if (!downloadAudioToFlash(url, VOICE_MSG_PATH)) {
    Serial.println("[playVoiceMessage] 다운로드 실패, 이번 경고는 재생하지 못함");
    return;
  }

  AudioFileSourceLittleFS file(VOICE_MSG_PATH);
  AudioOutputI2S out;
  out.SetPinout(PIN_I2S_BCLK, PIN_I2S_LRC, PIN_I2S_DOUT);
  out.SetGain(0.9);

  AudioGeneratorWAV wav;
  if (!wav.begin(&file, &out)) {
    Serial.println("[playVoiceMessage] wav 재생 시작 실패");
    LittleFS.remove(VOICE_MSG_PATH);
    return;
  }

  while (wav.isRunning()) {
    if (!wav.loop()) {
      wav.stop();
    }
  }

  LittleFS.remove(VOICE_MSG_PATH);
}

void setup() {
  Serial.begin(115200);
  delay(300);

  analogReadResolution(12);

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS 마운트 실패");
  }

  connectWiFi();
  secureClient.setInsecure(); // 데모용: 인증서 검증 생략. 운영 시 루트 CA 고정을 권장
}

void loop() {
  ensureWiFi();

  unsigned long now = millis();

  if (now - lastSendAt >= SEND_INTERVAL_MS) {
    lastSendAt = now;

    int ceilingSoundAdc = samplePeak(PIN_CEILING_SOUND);
    int ceilingVibAdc   = samplePeak(PIN_CEILING_VIBRATION);
    int floorSoundAdc   = samplePeak(PIN_FLOOR_SOUND);
    int floorVibAdc     = samplePeak(PIN_FLOOR_VIBRATION);

    float ceilingSoundDb = adcToDb(ceilingSoundAdc, SOUND_DB_MIN, SOUND_DB_MAX);
    float ceilingVibDb   = adcToDb(ceilingVibAdc, VIB_DB_MIN, VIB_DB_MAX);
    float floorSoundDb   = adcToDb(floorSoundAdc, SOUND_DB_MIN, SOUND_DB_MAX);
    float floorVibDb     = adcToDb(floorVibAdc, VIB_DB_MIN, VIB_DB_MAX);

    Serial.printf("[층 %d] 천장(소리=%.1fdB 진동=%.1fdB) 바닥(소리=%.1fdB 진동=%.1fdB)\n",
                  FLOOR_ID, ceilingSoundDb, ceilingVibDb, floorSoundDb, floorVibDb);

    sendReading(ceilingSoundDb, ceilingVibDb, floorSoundDb, floorVibDb);
  }

  if (now - lastPollAt >= POLL_INTERVAL_MS) {
    lastPollAt = now;

    PendingAlert alert;
    if (fetchPendingAlert(alert)) {
      String urlToPlay = alert.audioUrl.length() > 0 ? alert.audioUrl : String(DEFAULT_ALERT_URL);
      playVoiceMessage(urlToPlay);
      markAlertDelivered(alert.alertId);
    }
  }
}
