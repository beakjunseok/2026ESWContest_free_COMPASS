// Google Cloud Text-to-Speech REST API 호출 (경비실이 입력한 메시지를 mp3 음성으로 변환)
// 필요한 환경변수: GOOGLE_TTS_API_KEY
// 다른 TTS 공급자로 바꾸려면 이 함수 하나만 교체하면 된다.

const MAX_MESSAGE_LENGTH = 200;

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("메시지가 비어 있습니다");
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`메시지는 ${MAX_MESSAGE_LENGTH}자 이내로 입력해주세요`);
  }

  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_TTS_API_KEY 환경변수가 설정되지 않았습니다");
  }

  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: trimmed },
        voice: { languageCode: "ko-KR", name: "ko-KR-Neural2-A" },
        audioConfig: { audioEncoding: "MP3" },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TTS 요청 실패 (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { audioContent?: string };
  if (!data.audioContent) {
    throw new Error("TTS 응답에 오디오 데이터가 없습니다");
  }

  return Buffer.from(data.audioContent, "base64");
}
