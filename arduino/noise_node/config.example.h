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

// 자동 감지 경보 / "정해진 경고 음성 보내기"용 고정 음성 파일의 공개 URL.
// 대시보드(층 상세 페이지)에서 원하는 문구로 메시지를 한 번 보낸 뒤, 경고 이력에 뜨는
// <audio> 재생 버튼을 우클릭 > 오디오 주소 복사(또는 새 탭에서 열어 주소 확인)로 얻은
// wav 공개 URL을 여기에 붙여넣으세요. 모든 노드가 같은 URL을 써도 됩니다.
#define DEFAULT_ALERT_URL   "여기에_기본_경고_음성_wav_공개_URL"
