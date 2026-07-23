import { createClient, SupabaseClient } from "@supabase/supabase-js";

// 서버 전용(API route)에서만 import할 것. service role key는 RLS를 우회하므로
// 클라이언트 컴포넌트/번들에 절대 노출되면 안 된다.
//
// 모듈 로드 시점(빌드의 "Collecting page data" 단계 포함)에 즉시 생성하면 환경변수가
// 아직 없을 때 빌드 자체가 실패하므로, 실제 요청 처리 시점에만 지연 생성한다.
let cachedClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Supabase 서버 환경변수가 설정되지 않았습니다: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 확인하세요."
    );
  }

  cachedClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return cachedClient;
}
