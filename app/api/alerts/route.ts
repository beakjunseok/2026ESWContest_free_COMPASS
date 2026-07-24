import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { synthesizeSpeech } from "@/lib/tts";

const MAX_AUDIO_FILE_BYTES = 4 * 1024 * 1024; // 4MB — Vercel 서버리스 함수 요청 크기 한도 여유

function isWavBuffer(buf: Buffer): boolean {
  return buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE";
}

async function uploadAudio(admin: ReturnType<typeof getSupabaseAdmin>, floorId: number, buf: Buffer): Promise<string> {
  const path = `${floorId}/${Date.now()}.wav`;
  const { error: uploadError } = await admin.storage
    .from("alert-audio")
    .upload(path, buf, { contentType: "audio/wav" });

  if (uploadError) {
    throw new Error(`음성 파일 업로드 실패: ${uploadError.message}`);
  }

  return admin.storage.from("alert-audio").getPublicUrl(path).data.publicUrl;
}

// 경비실에서 수동으로 특정 층에 스피커 경고 발령. 두 가지 방식을 지원한다.
//
// 1) JSON 요청 { floor_id, message } — message를 TTS로 변환해 Storage에 올리고
//    audio_url을 함께 저장한다. message가 없으면(=빈 문자열/미전달) audio_url도 null로
//    저장되며, ESP32가 이를 보고 config.h의 DEFAULT_ALERT_URL(고정 경고 음성)을 재생한다.
//
// 2) multipart/form-data 요청 { floor_id, audio(File), message?(선택, 표시용 라벨) } —
//    guard가 고른 wav 파일을 AI 변환 없이 그대로 Storage에 올려 audio_url로 저장한다.
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const admin = getSupabaseAdmin();

  let floorId: number;
  let message = "";
  let audioUrl: string | null = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    floorId = Number(form.get("floor_id"));
    message = typeof form.get("message") === "string" ? String(form.get("message")).trim() : "";
    const file = form.get("audio");

    if (!Number.isFinite(floorId)) {
      return NextResponse.json({ error: "floor_id가 필요합니다" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "audio 파일이 필요합니다" }, { status: 400 });
    }
    if (file.size > MAX_AUDIO_FILE_BYTES) {
      return NextResponse.json({ error: "오디오 파일은 4MB 이하만 업로드할 수 있습니다" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (!isWavBuffer(buf)) {
      return NextResponse.json({ error: "wav 파일만 업로드할 수 있습니다 (노드가 wav만 재생 가능)" }, { status: 400 });
    }

    try {
      audioUrl = await uploadAudio(admin, floorId, buf);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  } else {
    const body = await request.json();
    floorId = Number(body.floor_id);
    message = typeof body.message === "string" ? body.message.trim() : "";

    if (!Number.isFinite(floorId)) {
      return NextResponse.json({ error: "floor_id가 필요합니다" }, { status: 400 });
    }

    if (message) {
      let audioBuffer: Buffer;
      try {
        audioBuffer = await synthesizeSpeech(message);
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
      }

      try {
        audioUrl = await uploadAudio(admin, floorId, audioBuffer);
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
      }
    }
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
