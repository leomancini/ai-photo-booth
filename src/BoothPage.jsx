import React, { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import QRCode from "qrcode";
import { Page, Title, Subtitle, Button } from "./shared.jsx";

const QRImage = styled.img`
  width: min(420px, 80vw);
  border-radius: 24px;
  background: #fff;
  padding: 16px;
  box-sizing: border-box;
`;

const UploadUrl = styled.p`
  margin-top: 20px;
  color: #52525b;
  font-size: 13px;
  word-break: break-all;
`;

const Viewer = styled.div`
  display: flex;
  align-items: center;
  gap: 24px;
  width: 100%;
  max-width: 900px;
  justify-content: center;
`;

const ViewerImage = styled.img`
  max-height: 70vh;
  max-width: min(60vw, 560px);
  border-radius: 16px;
`;

const Arrow = styled.button`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: ${(p) => (p.disabled ? "#1a1a1f" : "#27272a")};
  color: ${(p) => (p.disabled ? "#3f3f46" : "#f4f4f5")};
  font-size: 26px;
  cursor: ${(p) => (p.disabled ? "default" : "pointer")};
  flex-shrink: 0;
  transition: background 0.15s;

  &:hover:enabled {
    background: #6366f1;
  }
`;

const Creating = styled.div`
  width: min(420px, 80vw);
  aspect-ratio: 2 / 3;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: #1a1a1f;
  color: #a1a1aa;
  font-size: 17px;
  animation: pulse 1.6s ease-in-out infinite;

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.45;
    }
  }
`;

const Counter = styled.p`
  margin-top: 18px;
  color: #a1a1aa;
  font-size: 15px;
`;

function BoothPage() {
  const [sessionId, setSessionId] = useState(null);
  const [qr, setQr] = useState(null);
  const [session, setSession] = useState(null);
  const [index, setIndex] = useState(0);

  const startSession = useCallback(async () => {
    setSession(null);
    setIndex(0);
    setQr(null);
    try {
      const res = await fetch("/api/session", { method: "POST" });
      const data = await res.json();
      setSessionId(data.sessionId);
      const url = `${window.location.origin}/upload/${data.sessionId}`;
      setQr({ dataUrl: await QRCode.toDataURL(url, { width: 640, margin: 1 }), url });
    } catch {}
  }, []);

  useEffect(() => {
    startSession();
  }, [startSession]);

  // Poll the session while it exists.
  useEffect(() => {
    if (!sessionId) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/session/${sessionId}`);
        if (res.ok) setSession(await res.json());
      } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, [sessionId]);

  const ready = session?.results?.filter((r) => r.status === "done") || [];
  const pendingCount =
    session?.results?.filter((r) => r.status === "pending").length || 0;
  const showViewer = session && session.status !== "waiting";

  // Keep the index valid as results stream in.
  useEffect(() => {
    if (index >= ready.length) setIndex(Math.max(0, ready.length - 1));
  }, [ready.length, index]);

  const prev = () => setIndex((i) => (i - 1 + ready.length) % ready.length);
  const next = () => setIndex((i) => (i + 1) % ready.length);

  // Left/right arrow keys cycle too.
  useEffect(() => {
    const onKey = (e) => {
      if (!ready.length) return;
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready.length]);

  const current = ready[index];

  return (
    <Page>
      <Title>AI Photo Booth</Title>
      {!showViewer ? (
        <>
          <Subtitle>Scan with your phone to add your photos.</Subtitle>
          {qr && (
            <>
              <QRImage src={qr.dataUrl} alt="Scan to upload photos" />
              <UploadUrl>{qr.url}</UploadUrl>
            </>
          )}
        </>
      ) : (
        <>
          <Subtitle>
            {current ? current.label : "Hold tight — creating your photos…"}
          </Subtitle>
          <Viewer>
            <Arrow onClick={prev} disabled={ready.length < 2}>
              ‹
            </Arrow>
            {current ? (
              <ViewerImage
                src={`/api/session/${sessionId}/image/${current.id}`}
                alt={current.label}
              />
            ) : (
              <Creating>Creating…</Creating>
            )}
            <Arrow onClick={next} disabled={ready.length < 2}>
              ›
            </Arrow>
          </Viewer>
          <Counter>
            {ready.length
              ? `${index + 1} / ${ready.length}` +
                (pendingCount ? ` — ${pendingCount} more on the way…` : "")
              : "This takes about a minute"}
          </Counter>
          <Button onClick={startSession}>Start Over</Button>
        </>
      )}
    </Page>
  );
}

export default BoothPage;
