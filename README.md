# NOISE COMPASS — 층간소음 발생 위치 판정 및 객관적 증빙 시스템
(구 noise-between-floors)

진동센서 + 소리센서로 층간소음이 발생한 **정확한 층**을 판정하고, 법정 층간소음 기준을 넘으면
해당 층 스피커로 즉시 경고하며, 경비실은 웹 대시보드로 전체 층 상태를 실시간 관제합니다.

```
arduino/    각 층에 설치하는 ESP32 노드 펌웨어
supabase/   DB 스키마 + 소음 위치 판정 결과 저장
app/        경비실용 Next.js 웹 대시보드 (Vercel 배포)
lib/        Supabase 클라이언트, 공용 타입
components/ 대시보드 UI 컴포넌트
```

> **데모 프로토타입 참고**: 3개 층 미니어처 축소모형이라 편의상 ESP32 1대가 3개 층의
> 센서를 모두 읽습니다. 실제 건물에 배포한다면 층별로 별도 ESP32 노드를 두는 구조가
> 됩니다.

## 1. 동작 원리

### 1-1. 센서 배치 (현재 구현)

층마다 **소리센서(SoundSM-II) 1개 + 진동센서(SW-420) 1개, 총 1세트**가 설치되어 있습니다
(바닥 쪽 기준). 두 센서 모두 디지털(DO) 출력으로 판독합니다.

당초 설계는 같은 슬라브를 사이에 두고 위층의 바닥 센서와 아래층의 천장 센서를 마주보게
배치해 신호 크기를 대조하는 방식(근접 센서는 크게, 원거리 센서는 감쇠되어 작게 반응하는
차이로 발생 층을 특정)을 구상했습니다. **다만 천장 센서 설치는 아직 향후 계획 단계이며,
현재는 층별 단일 센서 세트만으로 판정합니다.**

### 1-2. 소음 발생 위치 판정 (ESP32 펌웨어, `judgeFloor` 로직)

당초 계획은 Supabase DB 트리거에서 층간 신호를 대조하는 방식이었지만, **현재 실제로
동작하는 판정 로직은 각 ESP32 노드 펌웨어에서 수행**하고, Supabase는 결과를 기록·표시하는
역할만 합니다.

1. 각 층 소리·진동 센서를 20ms 주기로 샘플링, 1초 윈도우(50샘플) 안에 한 번이라도 HIGH가
   있으면 감지로 판단합니다 — 손뼉처럼 짧은 순간 소음도 포착하기 위한 latch 방식입니다
   (기존에는 "1초간 HIGH 비율 15% 이상" 기준이라 순간 소음이 2~4%밖에 안 나와 놓치는
   문제가 있었습니다).
2. 진동·소리가 동시에 감지된 층은 confidence = **높음**(직접충격)으로 우선 판정합니다.
3. 진동만 감지되면 confidence = **보통**(직접충격), 소리만 감지되면 confidence = **낮음**
   (공기전달)으로 차순위 판정합니다.
4. 여러 층이 동시에 감지돼도 감지 비율 합산 점수가 가장 높은 층 하나만 최종 판정 층으로
   선정합니다.
5. 판정 결과(`floor_id`, `noise_type`, `confidence`)를 2초 주기로 Supabase
   (`sensor_readings`, `noise_events`)에 전송해 기록합니다. `floor_id` 기준으로 완전히
   독립 처리되어 여러 층 소음원이 섞이지 않습니다.

> 법정 기준값(아래 1-4)과의 정밀 dB 비교는 향후 개선 과제이며, 현재는 센서 on/off
> 감지 기반(latch)으로 판정합니다.

### 1-3. 경고 전달

- ESP32 노드는 3초마다 `alerts` 테이블에서 **자기 층 앞으로 온 pending 경고**를 조회합니다.
- 부저 없이 **모든 경고를 I2S 스피커의 실제 음성으로** 재생합니다.
  * 경비실이 문구를 선택/입력해 보낸 경고는 서버가 TTS로 음성을 합성해 Supabase Storage에
    올리고, ESP32가 그 wav를 내려받아 재생합니다.
  * 자동 감지 경고나 별도 메시지가 없는 경우에는 미리 준비해 둔 고정 wav
    (`config.h`의 `DEFAULT_ALERT_URL`)를 재생합니다.
  * (자세한 내용은 "1-5. 음성 경고 메시지" 참고)
- 재생 후 상태를 `delivered`로 갱신하며, 경비실은 대시보드에서 경고를 "확인 완료" 처리할 수
  있습니다.
- **스피커 실물 조립 및 재생 검증은 향후 진행 예정**이며, 폴링 로직 자체는 구현 완료된
  상태입니다.

### 1-4. 법정 기준값 (모든 층 공통, 고정값 — 조정 불가)

출처: [국가법령정보 생활법령 · 층간소음의 기준](https://easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=1890&ccfNo=2&cciNo=1&cnpClsNo=1) (「공동주택 층간소음의 범위와 기준에 관한 규칙」, 환경부·국토부).

| 구분      | 측정 지표         | 주간(06~22시) | 야간(22~06시) |
| ------- | ------------- | ---------- | ---------- |
| 직접충격 소음 | 1분 등가소음도(Leq) | 39 dB      | 34 dB      |
| 직접충격 소음 | 최고소음도(Lmax)   | 57 dB      | 52 dB      |
| 공기전달 소음 | 5분 등가소음도(Leq) | 45 dB      | 40 dB      |

이 프로젝트는 장시간 평균인 등가소음도(1분/5분 Leq)를 실제로 계산하지 않고, 센서
on/off(HIGH/LOW) 감지 기반으로 판정합니다. 따라서 위 수치는 판정 로직에 직접 대입되는
값이 아니라 **"우리가 조작할 수 없는 객관적 기준선이 존재한다"는 근거 및 향후 정밀 dB
보정의 목표값**으로 사용합니다. 실제 법 규정에는 "1시간 내 3회 이상 초과 시 인정" 등
추가 판정 조건도 있습니다. 이 프로젝트는 학습·시연 목적의 근사 구현이며, 실제 민원/제재
근거로 쓰려면 정식 소음측정기와 인증된 절차를 따라야 합니다.

### 1-5. 음성 경고 메시지 (경비실 → 특정 층 스피커)

경비실은 층 상세 페이지(`/floors/[id]`)에서 미리 정해둔 문구를 고르거나 직접 문장을 입력해
해당 층 스피커로 실제 음성 메시지를 보낼 수 있습니다. 과거에 직접 입력해 보낸 메시지는
`alerts.message`에 그대로 남아 있으므로, "최근 보낸 메시지" 목록으로 자동 노출되어 다음에도
다시 클릭 한 번으로 재사용할 수 있습니다 (최근 200건 중 중복/프리셋과 겹치지 않는 최대 10개).

1. 경비실이 문구 선택/입력 후 전송 → `/api/alerts`(POST)가 텍스트를 받습니다.
2. 서버가 **Gemini API**(Google AI Studio 키, `gemini-2.5-flash-preview-tts` 모델)로 음성을
   합성합니다. Gemini는 raw PCM을 반환하므로 서버에서 표준 wav 헤더를 붙여 Supabase
   Storage(`alert-audio` 버킷)에 업로드하고, `alerts.message`(원문 텍스트)와
   `alerts.audio_url`(공개 wav URL)을 저장합니다.
3. 해당 층 ESP32 노드가 폴링 중 이 경고를 발견하면 wav를 내려받아 I2S 앰프로 재생합니다.
4. 메시지 없이 자동 감지 경고이거나 "정해진 경고 음성 보내기"를 선택하면 `audio_url`이
   비어 있는 채로 저장되고, ESP32는 그 경우 `config.h`의 `DEFAULT_ALERT_URL`(고정 경고
   음성)을 대신 재생합니다.

> Google Cloud Text-to-Speech와 Gemini API는 서로 다른 제품입니다. Google AI Studio에서
> 발급한 Gemini API 키는 Cloud TTS에는 쓸 수 없지만, Gemini 모델 자체의 음성 합성
> 기능(위 방식)에는 그대로 사용할 수 있습니다. 별도 결제 계정 설정이 필요한 Cloud TTS
> 대신 이미 보유한 Gemini 키를 재사용해 개발 속도를 높였습니다.

## 2. 하드웨어 (arduino/noise_node)

- 보드: ESP32-WROOM-32 (WiFi 내장, ADC1 채널만 사용 — WiFi 구동 중 ADC2 핀 불안정 회피)
- 센서: 소리센서 **3개**(SoundSM-II), 진동센서 **3개**(SW-420) — 3개 층에 각 1세트.
  두 센서 모두 디지털(DO) 출력으로 판독합니다.
- 출력: I2S 오디오 앰프(MAX98357A) + 소형 스피커 1조. 부저 없이 자동 감지 경고와 경비실
  음성 메시지 모두 이 스피커 하나로 재생할 예정입니다(실물 조립은 향후 계획).
- 하우징: 3D 모델링한 케이스 목업 기반 1차 프로토타입 조립 완료. 3단 랙 형태의 판이
  흔들려서 앞쪽에 나무 막대(dowel) 기둥을 보강 설치했습니다.

핀 배치 (ADC1 그룹 input-only 핀만 사용):

| 신호               | 핀      |
| ---------------- | ------ |
| 1층 소리센서 (SOUND1) | GPIO34 |
| 1층 진동센서 (VIB1)   | GPIO36 |
| 2층 소리센서 (SOUND2) | GPIO35 |
| 2층 진동센서 (VIB2)   | GPIO39 |
| 3층 소리센서 (SOUND3) | GPIO32 |
| 3층 진동센서 (VIB3)   | GPIO33 |

### 설정

1. Arduino IDE에 ESP32 보드 패키지 설치
2. `arduino/noise_node/config.example.h`를 같은 폴더에 `config.h`로 복사
3. `config.h`에 WiFi 정보, Supabase URL/anon key, `FLOOR_IDS`,
   `DEFAULT_ALERT_URL`(고정 경고 음성 wav URL) 입력
4. 데모 프로토타입은 ESP32 1대가 3개 층 센서를 모두 처리하므로 `FLOOR_IDS` 배열에 세
   층의 id를 순서대로 채웁니다 (실제 건물 배포 시에는 층마다 별도 노드로 분리하고
   `FLOOR_ID` 단일값으로 전환).

### 캘리브레이션 (중요)

센서 DO 출력의 on/off 임계값(민감도 트리머)은 실측 환경에서 재조정이 필요합니다. 정밀한
dB 환산은 아직 근사치이며, 향후 개선 과제입니다.

## 3. 데이터베이스 (Supabase)

1. [Supabase 대시보드](https://supabase.com/dashboard)에서 프로젝트 생성 (또는 기존 프로젝트 사용)
2. SQL Editor에서 `supabase/migrations/` 아래 파일을 **번호 순서대로** 전체 실행
   - `0001_init.sql` — `floors`, `sensor_readings`, `noise_events`, `alerts` 테이블,
     RLS 정책, Realtime 발행 등록, 기본 층 시드 데이터
   - `0002_lock_legal_thresholds.sql` — 층별 소음 기준 컬럼 제거 + 법정 고정값을
     참고 상수로 반영 + 층별 기준 수정 권한 제거
   - `0003_alert_messages.sql` — `alerts`에 `message`/`audio_url` 컬럼 추가, 음성 파일을
     저장할 공개 Storage 버킷(`alert-audio`) 생성
   - 이후 마이그레이션 — `ceiling_sound_db`/`ceiling_vibration` 컬럼 제거
     (천장 센서 미구현으로 불필요해진 필드 정리)
3. Project Settings → API 에서 `Project URL`, `anon public key`, `service_role key` 확인

> **보안 참고**: 이 스키마는 시연/교육용으로 anon key에 `sensor_readings` INSERT, `alerts`
> INSERT/UPDATE 권한을 넓게 허용합니다. 실 운영 환경에서는 디바이스별 인증과 더 세분화된
> RLS를 적용하세요.

## 4. 웹 대시보드 (경비실용, Vercel 배포)

Next.js App Router 기반이며 **레포 루트**에 위치해 있어 Vercel에서 Root Directory를 따로
지정할 필요 없이 그대로 연결하면 됩니다.

### 로컬 실행

```
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
   - `GEMINI_API_KEY` (Google AI Studio에서 발급. 경비실이 직접 문구를 입력해 보내는
     음성 메시지 기능에만 사용되며, 없어도 빌드와 `DEFAULT_ALERT_URL` 기반 고정 경고
     음성 재생은 정상 동작합니다)
3. Deploy

### 화면 구성

- `/` : 전체 층 카드 그리드 (실시간 소음 레벨, 정상/경고 상태), 미해결 경고 목록
- `/floors/[id]` : 층별 최근 센서 데이터, 경고 이력, 프리셋 선택 또는 직접 입력으로 음성
  경고 메시지 보내기, 적용 중인 법정 기준 표시(읽기 전용 — 모든 층 공통, 변경 불가)

## 5. 한계 / 개선 여지

- 데모는 3개 층 미니어처 축소모형(ESP32 1대가 전 층 겸임)으로 촬영되어, 층수가 적어
  실험 결과가 실제 다층 건물 환경만큼 뚜렷하게 나오지 못했습니다.
- 천장 센서 대조 기반 이중 판정은 아직 미구현이며 향후 계획입니다 — 현재는 층별 단일
  센서 세트(소리+진동)만으로 판정합니다.
- 센서 값을 정밀 dB로 환산하는 부분은 아직 근사치이며 현장 캘리브레이션이 필요합니다.
- 스피커(I2S) 실물 조립과 음성 재생 end-to-end 검증은 아직 진행 중입니다.
- ESP32 → Supabase 통신은 데모 편의를 위해 `setInsecure()`(TLS 인증서 검증 생략)를
  사용합니다. 운영 환경에서는 루트 CA 고정을 권장합니다.
- 경고 폴링 주기(3초)로 인해 최대 수 초의 지연이 있을 수 있습니다.
- Gemini TTS는 미리보기(preview) 모델이라 요금/쿼터/모델명이 변경될 수 있습니다.

## 참고 자료

- [국가법령정보 생활법령 · 층간소음의 기준](https://easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=1890&ccfNo=2&cciNo=1&cnpClsNo=1)
- [층간소음 이웃사이센터](https://floor.noiseinfo.or.kr/) (환경부·한국환경공단)
