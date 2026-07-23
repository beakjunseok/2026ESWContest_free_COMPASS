import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const EDITABLE_FIELDS = [
  "day_impact_limit_db",
  "night_impact_limit_db",
  "day_airborne_limit_db",
  "night_airborne_limit_db",
] as const;

// 층별 소음 기준(dB) 수정
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const floorId = Number(params.id);
  if (!Number.isFinite(floorId)) {
    return NextResponse.json({ error: "잘못된 층 id" }, { status: 400 });
  }

  const body = await request.json();
  const patch: Record<string, number> = {};
  for (const field of EDITABLE_FIELDS) {
    if (typeof body[field] === "number") {
      patch[field] = body[field];
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "수정할 값이 없습니다" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("floors")
    .update(patch)
    .eq("id", floorId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
