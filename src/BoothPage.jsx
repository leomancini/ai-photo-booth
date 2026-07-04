import React, { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import QRCode from "qrcode";
import { Page, Button } from "./shared.jsx";

const QRWrap = styled.div`
  flex: 1;
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const QRImage = styled.img`
  width: min(420px, 80vw);
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

const WaitingWrap = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  margin-top: 15vh;
  color: #a1a1aa;
  font-size: 18px;
`;

const Spinner = styled.div`
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 4px solid #27272a;
  border-top-color: #6366f1;
  animation: spin 0.9s linear infinite;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
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
      const url = `${window.location.origin}/u/${data.sessionId}`;
      setQr({
        dataUrl: await QRCode.toDataURL(url, {
          width: 640,
          margin: 1,
          color: { dark: "#ffffff", light: "#000000" },
        }),
        url,
      });
    } catch {}
  }, []);

  useEffect(() => {
    startSession();
  }, [startSession]);

  // Live session updates over WebSocket, with auto-reconnect.
  useEffect(() => {
    if (!sessionId) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    let socket;
    let closed = false;
    const connect = () => {
      socket = new WebSocket(
        `${proto}://${window.location.host}/ws?session=${sessionId}`
      );
      socket.onmessage = (e) => {
        try {
          setSession(JSON.parse(e.data));
        } catch {}
      };
      socket.onclose = () => {
        if (!closed) setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      closed = true;
      socket?.close();
    };
  }, [sessionId]);

  const ready = session?.results?.filter((r) => r.status === "done") || [];
  const scanned = session?.status === "scanned";
  const showViewer =
    session && session.status !== "waiting" && session.status !== "scanned";

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
      {scanned ? (
        <WaitingWrap>
          <Spinner />
          Waiting for photos…
        </WaitingWrap>
      ) : !showViewer ? (
        <QRWrap>
          {qr && <QRImage src={qr.dataUrl} alt="Scan to upload photos" />}
        </QRWrap>
      ) : (
        <>
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
          <Button onClick={startSession}>Start Over</Button>
        </>
      )}
    </Page>
  );
}

export default BoothPage;
