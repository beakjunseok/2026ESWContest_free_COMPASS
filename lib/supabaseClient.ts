import { createClient, SupabaseClient } from "@supabase/supabase-js";

// 브라우저용 읽기 전용 클라이언트 (anon key).
//
// 모듈 로드 시점에 즉시 생성하면 서버사이드 프리렌더/빌드 단계에서 환경변수가
// 아직 없을 때 실패할 수 있으므로, 반드시 useEffect 등 실제 실행 시점에서만
// getSupabaseClient()를 호출해 지연 생성한다.
let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase 환경변수가 설정되지 않았습니다: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY를 확인하세요."
    );
  }

  cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
    realtime: {
      params: { eventsPerSecond: 5 },
    },
  });
  return cachedClient;
}
