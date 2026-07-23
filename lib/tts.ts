// Gemini API(Google AI Studio 키) 내장 TTS로 경비실이 입력한 메시지를 음성으로 변환한다.
// 필요한 환경변수: GEMINI_API_KEY (aistudio.google.com/apikey 에서 발급한 키)
//
// Gemini TTS는 mp3가 아니라 raw PCM(16bit, 24kHz, mono)을 base64로 반환하므로,
// 여기서 표준 44바이트 WAV 헤더를 붙여 재생 가능한 wav 파일로 만들어 반환한다.
// 다른 TTS 공급자로 바꾸려면 이 파일만 교체하면 된다.

const MAX_MESSAGE_LENGTH = 200;
const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const GEMINI_VOICE_NAME = "Kore"; // 사용 가능한 다른 프리셋 음성: Puck, Charon, Fenrir, Aoede 등
const SAMPLE_RATE = 24000;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

function pcmToWav(pcm: Buffer): Buffer {
  const byteRate = (SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8;
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt 청크 크기
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("메시지가 비어 있습니다");
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`메시지는 ${MAX_MESSAGE_LENGTH}자 이내로 입력해주세요`);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY 환경변수가 설정되지 않았습니다");
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: trimmed }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE_NAME } },
          },
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TTS 요청 실패 (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const base64Audio: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

  if (!base64Audio) {
    throw new Error("TTS 응답에 오디오 데이터가 없습니다");
  }

  return pcmToWav(Buffer.from(base64Audio, "base64"));
}
