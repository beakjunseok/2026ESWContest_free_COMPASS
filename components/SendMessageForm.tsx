"use client";

import { useState } from "react";

const PRESET_MESSAGES = [
  "층간소음이 발생하고 있습니다. 주의를 부탁드립니다.",
  "야간 시간대 소음 기준을 초과했습니다. 조용히 해주시기 바랍니다.",
  "지속적인 소음으로 민원이 접수되었습니다. 협조 부탁드립니다.",
  "TV 또는 음향기기 소리를 줄여주시기 바랍니다.",
  "늦은 시간 발걸음 소리, 뛰는 소리에 주의해 주시기 바랍니다.",
];

export default function SendMessageForm({ floorId }: { floorId: number }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);

  async function send(message: string) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ floor_id: floorId, message }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "전송 실패");
      }
      setSentAt(Date.now());
      setText("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card">
      <h3 className="floor-title" style={{ margin: 0 }}>
        스피커 경고 메시지 보내기
      </h3>
      <p className="muted" style={{ marginTop: 8 }}>
        아래 문구를 선택하거나 직접 입력해 이 층 스피커로 음성 메시지를 보낼 수 있습니다. 빈
        메시지로 보내면 이 노드에 미리 등록해둔 고정 경고 음성이 재생됩니다.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" }}>
        {PRESET_MESSAGES.map((preset) => (
          <button
            key={preset}
            type="button"
            className="btn"
            onClick={() => setText(preset)}
            disabled={sending}
          >
            {preset}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="직접 메시지를 입력하세요 (최대 200자)"
        maxLength={200}
        rows={3}
        disabled={sending}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--text)",
          fontSize: 14,
          resize: "vertical",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <button
          className="btn primary"
          disabled={sending || !text.trim()}
          onClick={() => send(text)}
        >
          {sending ? "전송 중..." : "이 메시지로 경고 보내기"}
        </button>
        <button
          className="btn danger"
          disabled={sending}
          onClick={() => send("")}
        >
          정해진 경고 음성 보내기
        </button>
        {sentAt && !sending && !error && <span className="muted">전송 완료</span>}
      </div>
      {error && (
        <p className="muted" style={{ color: "var(--danger)", marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}
