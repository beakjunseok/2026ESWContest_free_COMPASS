import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { synthesizeSpeech } from "@/lib/tts";

// 경비실에서 수동으로 특정 층에 스피커 경고 발령.
// message가 있으면 TTS로 변환해 Storage에 올리고 audio_url을 함께 저장한다.
// message가 없으면(=빈 문자열/미전달) 기존과 동일하게 기본 경고음만 재생되는 알림을 만든다.
export async function POST(request: Request) {
  const body = await request.json();
  const floorId = Number(body.floor_id);
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!Number.isFinite(floorId)) {
    return NextResponse.json({ error: "floor_id가 필요합니다" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  let audioUrl: string | null = null;

  if (message) {
    let audioBuffer: Buffer;
    try {
      audioBuffer = await synthesizeSpeech(message);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    const path = `${floorId}/${Date.now()}.wav`;
    const { error: uploadError } = await admin.storage
      .from("alert-audio")
      .upload(path, audioBuffer, { contentType: "audio/wav" });

    if (uploadError) {
      return NextResponse.json({ error: `음성 파일 업로드 실패: ${uploadError.message}` }, { status: 500 });
    }

    audioUrl = admin.storage.from("alert-audio").getPublicUrl(path).data.publicUrl;
  }

  const { data, error } = await admin
    .from("alerts")
    .insert({
      floor_id: floorId,
      event_id: null,
      status: "pending",
      triggered_by: "guard",
      message: message || null,
      audio_url: audioUrl,
    })
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

  const { data, error } = await getSupabaseAdmin()
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
