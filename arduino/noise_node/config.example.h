// config.example.h 를 복사해 config.h 로 저장한 뒤 아래 값을 채우세요.
// config.h는 .gitignore에 등록되어 있어 git에 커밋되지 않습니다.

#pragma once

#define WIFI_SSID       "여기에_와이파이_이름"
#define WIFI_PASSWORD   "여기에_와이파이_비밀번호"

// Supabase 프로젝트 설정 > API 에서 확인
#define SUPABASE_URL        "https://xxxxxxxxxxxxxxxx.supabase.co"
#define SUPABASE_ANON_KEY   "여기에_anon_public_key"

// 이 노드가 담당하는 층 번호 (floors 테이블의 id와 일치해야 함)
#define FLOOR_ID   1
