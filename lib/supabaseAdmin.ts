import { createClient } from "@supabase/supabase-js";

// 서버 전용(API route)에서만 import할 것. service role key는 RLS를 우회하므로
// 클라이언트 컴포넌트/번들에 절대 노출되면 안 된다.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});
