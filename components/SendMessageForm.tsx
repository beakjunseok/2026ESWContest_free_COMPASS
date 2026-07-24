"use client";

import { useRef, useState } from "react";

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

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileLabel, setFileLabel] = useState("");
  const [sendingFile, setSendingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileSentAt, setFileSentAt] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function sendFile() {
    if (!selectedFile) return;
    setSendingFile(true);
    setFileError(null);
    try {
      const form = new FormData();
      form.append("floor_id", String(floorId));
      if (fileLabel.trim()) form.append("message", fileLabel.trim());
      form.append("audio", selectedFile);

      const res = await fetch("/api/alerts", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "전송 실패");
      }
      setFileSentAt(Date.now());
      setSelectedFile(null);
      setFileLabel("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setFileError((err as Error).message);
    } finally {
      setSendingFile(false);
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

      <hr style={{ margin: "16px 0", border: "none", borderTop: "1px solid var(--border)" }} />

      <h3 className="floor-title" style={{ margin: 0 }}>
        오디오 파일 직접 보내기
      </h3>
      <p className="muted" style={{ marginTop: 8 }}>
        직접 준비한 wav 파일을 AI 변환 없이 그대로 저장해 재생합니다 (wav 파일만 지원, 4MB
        이하).
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/wav,.wav"
        disabled={sendingFile}
        onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
        style={{ marginTop: 8 }}
      />

      <input
        type="text"
        value={fileLabel}
        onChange={(e) => setFileLabel(e.target.value)}
        placeholder="경고 이력에 표시할 설명 (선택 사항)"
        maxLength={200}
        disabled={sendingFile}
        style={{
          display: "block",
          width: "100%",
          marginTop: 8,
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--text)",
          fontSize: 14,
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <button
          className="btn primary"
          disabled={sendingFile || !selectedFile}
          onClick={sendFile}
        >
          {sendingFile ? "전송 중..." : "이 오디오 그대로 보내기"}
        </button>
        {fileSentAt && !sendingFile && !fileError && <span className="muted">전송 완료</span>}
      </div>
      {fileError && (
        <p className="muted" style={{ color: "var(--danger)", marginTop: 8 }}>
          {fileError}
        </p>
      )}
    </div>
  );
}
