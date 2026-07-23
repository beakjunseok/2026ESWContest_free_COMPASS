import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// 경비실에서 수동으로 특정 층에 스피커 경고 발령
export async function POST(request: Request) {
  const body = await request.json();
  const floorId = Number(body.floor_id);

  if (!Number.isFinite(floorId)) {
    return NextResponse.json({ error: "floor_id가 필요합니다" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("alerts")
    .insert({ floor_id: floorId, event_id: null, status: "pending", triggered_by: "guard" })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// 경고 확인 처리 (경비실이 조치 완료로 표시)
export async function PATCH(request: Request) {
  const body = await request.json();
  const id = Number(body.id);
  const status = body.status as string;

  if (!Number.isFinite(id) || !["acknowledged", "cancelled", "delivered"].includes(status)) {
    return NextResponse.json({ error: "id와 유효한 status가 필요합니다" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { status };
  if (status === "acknowledged") patch.acknowledged_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("alerts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
