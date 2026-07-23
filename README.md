# noise-between-floors — 아파트 층간소음 감지/경고 시스템

진동센서 + 소리센서로 층간소음이 발생한 **정확한 층**을 판정하고, 법정 층간소음 기준을 넘으면
해당 층 스피커로 즉시 경고하며, 경비실은 웹 대시보드로 전체 층 상태를 실시간 관제합니다.

```
arduino/    각 층에 설치하는 ESP32 노드 펌웨어
supabase/   DB 스키마 + 소음 위치 판정 트리거 (SQL)
app/        경비실용 Next.js 웹 대시보드 (Vercel 배포)
lib/        Supabase 클라이언트, 공용 타입
components/ 대시보드 UI 컴포넌트
```

## 1. 동작 원리

### 1-1. 센서 배치

층마다 노드 1대, 센서 4개:

| 센서 | 위치 | 감지 대상 |
|---|---|---|
| 천장 소리센서 / 진동센서 | 윗집과 맞닿은 슬라브 쪽 | 윗집에서 전달되는 소음 |
| 바닥 소리센서 / 진동센서 | 아랫집과 맞닿은 슬라브 쪽(=이 집 바닥) | **이 집 자신**이 내는 소음(근접) |

같은 슬라브를 사이에 두고 위층의 "바닥 센서"와 아래층의 "천장 센서"가 마주봅니다. 충격이
위층 바닥에서 발생하면 위층 바닥 센서(근접)가 가장 크게, 아래층 천장 센서(원거리·감쇠)는
그보다 작게 잡힙니다. 이 크기 차이로 **소음이 실제로 발생한 층**을 판정합니다.

### 1-2. 소음 발생 위치 판정 (Supabase DB 트리거)

`supabase/migrations/0001_init.sql`의 `fn_process_sensor_reading()` 트리거가
`sensor_readings`에 새 데이터가 들어올 때마다 자동 실행됩니다.

1. 해당 층의 **바닥 진동센서** 값이 법정 충격소음 기준(주/야간)을 넘으면 "이 층 자신"이
   충격소음 발생지로 1차 판정
2. 바로 아래층의 **천장 진동센서** 값(±2초 이내 최신값)과 대조해, 절반 이상 수준으로 함께
   튀었으면 `confidence = high`, 아니면 `medium`
3. 바닥 소리센서 값이 공기전달 소음 기준을 넘으면 TV/음향기기형 소음(`airborne`)으로 판정
4. 기준 초과 시 `noise_events`에 사건을 기록하고 `alerts`에 해당 층을 대상으로 한 경고를 생성

여러 층에서 동시에 소음이 발생해도 각 이벤트/경고가 `floor_id`로 구분되어 독립적으로
처리되므로, 층별로 서로 다른 소음을 혼동하지 않습니다. 같은 층에서 15초 이내 중복 감지는
새 이벤트를 만들지 않고 기존 미해결 이벤트로 묶어 스피커가 계속 반복 울리지 않게 합니다.

### 1-3. 경고 전달

- ESP32 노드는 3초마다 `alerts` 테이블에서 **자기 층 앞으로 온 pending 경고**를 조회합니다.
- 자동 감지 경고(음성 메시지 없음)는 부저로 3회 경고음(삑삑삑)을 재생합니다.
- 경비실이 층 상세 페이지에서 문구를 선택하거나 직접 입력해 보낸 경고는 서버가 TTS로 음성을
  합성해 Supabase Storage에 올리고, ESP32가 그 wav를 내려받아 I2S 스피커로 재생합니다
  (자세한 내용은 "1-5. 음성 경고 메시지" 참고).
- 재생 후 상태를 `delivered`로 갱신하며, 경비실은 대시보드에서 경고를 "확인 완료" 처리할 수
  있습니다.

### 1-4. 법정 기준값 (모든 층 공통, 고정값 — 조정 불가)

출처: [국가법령정보 생활법령 &middot; 층간소음의 기준](https://easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=1890&ccfNo=2&cciNo=1&cnpClsNo=1)
(「공동주택 층간소음의 범위와 기준에 관한 규칙」, 환경부·국토부).

| 구분 | 측정 지표 | 주간(06~22시) | 야간(22~06시) |
|---|---|---|---|
| 직접충격 소음 | 1분 등가소음도(Leq) | 39 dB | 34 dB |
| 직접충격 소음 | 최고소음도(Lmax) | 57 dB | 52 dB |
| 공기전달 소음 | 5분 등가소음도(Leq) | 45 dB | 40 dB |

이 프로젝트의 센서는 300ms 구간 피크값을 2초마다 전송하는 방식으로, 1분/5분에 걸친
등가소음도(장시간 평균)를 실제로 계산하지 않습니다. 순간 최고값을 보는 방식이 우리
측정 방식과 더 부합하므로, **충격소음 판정에는 최고소음도(Lmax) 57/52dB을 사용**하고,
공기전달 소음은 법령에 Lmax 규정이 없어 유일하게 명시된 **5분 등가소음도 45/40dB을
그대로 사용**합니다 (`supabase/migrations/0002_lock_legal_thresholds.sql`).

이 수치는 모든 층에 동일하게 적용되는 **고정값**이며, DB 트리거 함수에 상수로 박혀
있어 대시보드나 API를 통해 층별로 바꿀 수 없습니다. 실제 법 규정에는 이 외에도
"1시간 내 3회 이상 초과 시 인정" 등 추가 판정 조건이 있습니다. 이 프로젝트는
학습·시연 목적의 근사 구현이며, 실제 민원/제재 근거로 쓰려면 정식 소음측정기와
인증된 절차를 따라야 합니다.

### 1-5. 음성 경고 메시지 (경비실 → 특정 층 스피커)

경비실은 층 상세 페이지(`/floors/[id]`)에서 미리 정해둔 문구를 고르거나 직접 문장을 입력해
해당 층 스피커로 실제 음성 메시지를 보낼 수 있습니다.

1. 경비실이 문구 선택/입력 후 전송 → `/api/alerts`(POST)가 텍스트를 받는다
2. 서버가 **Gemini API**(Google AI Studio 키, `gemini-2.5-flash-preview-tts` 모델)로 음성을
   합성한다. Gemini는 raw PCM을 반환하므로 서버에서 표준 wav 헤더를 붙여 Supabase
   Storage(`alert-audio` 버킷)에 업로드하고, `alerts.message`(원문 텍스트)와
   `alerts.audio_url`(공개 wav URL)을 저장한다
3. 해당 층 ESP32 노드가 폴링 중 이 경고를 발견하면 wav를 LittleFS에 내려받아 I2S 앰프로
   재생한다 (다운로드/재생 실패 시 기본 부저 경고음으로 자동 대체)
4. 메시지 없이 "기본 경고음만 보내기"를 선택하면 기존과 동일하게 부저 알림만 울린다

> Google Cloud Text-to-Speech(`texttospeech.googleapis.com`)와 Gemini API는 서로 다른
> 제품입니다. Google AI Studio에서 발급한 Gemini API 키는 Cloud TTS에는 쓸 수 없지만,
> Gemini 모델 자체의 음성 합성 기능(위 방식)에는 그대로 사용할 수 있습니다.

## 2. 하드웨어 (arduino/noise_node)

- 보드: ESP32 (WiFi 내장)
- 센서: 소리센서 2개(KY-038 등), 진동센서 2개(SW-420 등)
- 출력 1 — 부저: 패시브 부저/스피커 (트랜지스터로 구동 권장). 자동 감지 시 기본 경고음.
- 출력 2 — I2S 오디오 앰프(예: MAX98357A) + 소형 스피커. 경비실이 보낸 음성 메시지 재생용.

핀 배치 (ADC1 채널만 사용 — WiFi 사용 중 ADC2 핀은 불안정):

| 신호 | 핀 |
|---|---|
| 천장 소리센서 | GPIO34 |
| 천장 진동센서 | GPIO35 |
| 바닥 소리센서 | GPIO32 |
| 바닥 진동센서 | GPIO33 |
| 부저(기본 경고음) | GPIO25 |
| I2S BCLK (MAX98357A) | GPIO26 |
| I2S LRC (MAX98357A) | GPIO27 |
| I2S DIN (MAX98357A) | GPIO14 |

### 설정

1. Arduino IDE에 ESP32 보드 패키지 설치, 라이브러리 매니저에서 `ArduinoJson`,
   `ESP8266Audio`(Earle F. Philhower) 설치
2. Tools → Partition Scheme에서 LittleFS가 포함된 옵션(예: "Default 4MB with spiffs") 선택
   — 다운로드한 음성 wav를 임시로 저장하는 데 사용됩니다
3. `arduino/noise_node/config.example.h`를 같은 폴더에 `config.h`로 복사
4. `config.h`에 WiFi 정보, Supabase URL/anon key, `FLOOR_ID`(이 노드가 담당하는 층) 입력
5. 층마다 `FLOOR_ID`만 바꿔서 각 노드에 업로드

### 캘리브레이션 (중요)

`noise_node.ino`의 `SOUND_DB_MIN/MAX`, `VIB_DB_MIN/MAX`는 ADC 값을 dB로 선형 환산하는
**근사치**입니다. 실제 소음측정기(스마트폰 앱이라도)로 현장에서 최소/최대 반응 지점을
측정해 이 값을 재보정해야 판정 정확도가 의미를 가집니다.

## 3. 데이터베이스 (Supabase)

1. [Supabase 대시보드](https://supabase.com/dashboard)에서 프로젝트 생성 (또는 기존 프로젝트 사용)
2. SQL Editor에서 `supabase/migrations/` 아래 파일을 **번호 순서대로** 전체 실행
   - `0001_init.sql` — `floors`, `sensor_readings`, `noise_events`, `alerts` 테이블,
     소음 위치 판정 트리거, RLS 정책, Realtime 발행 등록, 기본 5개 층 시드 데이터
     (필요 시 층 수 조정: `floors` 테이블에 행 추가/삭제)
   - `0002_lock_legal_thresholds.sql` — 층별 소음 기준 컬럼 제거 + 법정 고정값(Lmax
     57/52dB, 공기전달 45/40dB)을 트리거에 상수로 반영 + 층별 기준 수정 권한 제거
   - `0003_alert_messages.sql` — `alerts`에 `message`/`audio_url` 컬럼 추가, 음성 파일을
     저장할 공개 Storage 버킷(`alert-audio`) 생성
3. Project Settings → API 에서 `Project URL`, `anon public key`, `service_role key` 확인

> **보안 참고**: 이 스키마는 시연/교육용으로 anon key에 `sensor_readings` INSERT,
> `alerts` INSERT/UPDATE 권한을 넓게 허용합니다. 실 운영 환경에서는 디바이스별 인증
> (예: Edge Function을 통한 검증, 층별 개별 키)과 더 세분화된 RLS를 적용하세요.

## 4. 웹 대시보드 (경비실용, Vercel 배포)

Next.js App Router 기반이며 **레포 루트**에 위치해 있어 Vercel에서 Root Directory를 따로
지정할 필요 없이 그대로 연결하면 됩니다.

### 로컬 실행

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev
```

### Vercel 배포

1. 이 GitHub 레포를 Vercel 프로젝트로 Import (Framework Preset: Next.js 자동 인식)
2. Environment Variables에 아래 값 등록 (Production/Preview 모두)
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (서버 전용, `NEXT_PUBLIC_` 접두사 없음에 주의)
   - `GEMINI_API_KEY` ([Google AI Studio](https://aistudio.google.com/apikey)에서 발급한
     Gemini API 키. 경비실 음성 메시지 기능에만 사용되며, 없어도 빌드/기본 경고음 기능은
     정상 동작한다)
3. Deploy

### 화면 구성

- `/` : 전체 층 카드 그리드 (실시간 소음 레벨, 정상/경고 상태), 미해결 경고 목록
- `/floors/[id]` : 층별 최근 센서 데이터, 경고 이력(전송된 메시지/음성 재생 포함), 프리셋 선택
  또는 직접 입력으로 음성 경고 메시지 보내기, 적용 중인 법정 기준 표시(읽기 전용 — 모든 층
  공통, 변경 불가)

## 5. 한계 / 개선 여지

- 진동센서 값을 dB로 환산하는 부분은 근사치이며 현장 캘리브레이션이 필요합니다.
- ESP32 → Supabase 통신은 데모 편의를 위해 `setInsecure()`(TLS 인증서 검증 생략)를 사용합니다.
  운영 환경에서는 루트 CA 고정을 권장합니다.
- 경고 폴링 주기(3초)로 인해 최대 수 초의 지연이 있을 수 있습니다. 지연을 더 줄이려면
  ESP32에서 Supabase Realtime(WebSocket) 구독으로 전환할 수 있습니다.
- 음성 메시지는 노드가 wav를 전부 내려받은 뒤 재생을 시작하므로, 메시지 길이와 WiFi 속도에
  따라 몇 초의 지연이 있을 수 있습니다. wav는 24kHz/16bit/mono 비압축이라 메시지가 길수록
  파일 크기와 다운로드 시간이 늘어나니 메시지는 짧게(최대 200자 제한) 쓰는 것을 권장합니다.
- Gemini TTS는 미리보기(preview) 모델이라 요금/쿼터/모델명이 변경될 수 있습니다.
  `GEMINI_API_KEY`가 없거나 호출이 실패하면 해당 요청만 에러를 반환하고, "기본 경고음만
  보내기"와 자동 감지 경고는 영향받지 않습니다.
