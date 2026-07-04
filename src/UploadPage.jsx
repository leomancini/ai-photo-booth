import React, { useEffect, useState } from "react";
import styled from "styled-components";
import {
  Page,
  Title,
  Subtitle,
  Button,
  ErrorMsg,
  PhotoSlots,
  usePhotos,
} from "./shared.jsx";

const Done = styled.div`
  margin-top: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  font-size: 20px;
  text-align: center;

  span {
    font-size: 56px;
  }

  p {
    margin: 0;
    color: #a1a1aa;
    font-size: 15px;
  }
`;

function UploadPage({ sessionId }) {
  const { images, setImage, filled, canCombine } = usePhotos();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  // Tell the kiosk the QR code was scanned.
  useEffect(() => {
    fetch(`/api/session/${sessionId}/scanned`, { method: "POST" }).catch(() => {});
  }, [sessionId]);

  const submit = async () => {
    if (!canCombine || sending) return;
    setSending(true);
    setError(null);
    try {
      const form = new FormData();
      filled.forEach((img, i) => form.append("images", img.file, `photo-${i}.jpg`));
      const res = await fetch(`/api/session/${sessionId}/photos`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setSent(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <Page>
        <Title>AI Photo Booth</Title>
        <Done>
          <span>🎉</span>
          Photos sent!
          <p>Look at the big screen — your creations are on the way.</p>
        </Done>
      </Page>
    );
  }

  return (
    <Page>
      <Title>AI Photo Booth</Title>
      <Subtitle>Add two or three photos, then hit create.</Subtitle>
      <PhotoSlots
        images={images}
        onSetImage={(i, file) => {
          setImage(i, file);
          setError(null);
        }}
      />
      <Button disabled={!canCombine || sending} onClick={submit}>
        {sending ? "Sending…" : "Create My Photos"}
      </Button>
      {error && <ErrorMsg>{error}</ErrorMsg>}
    </Page>
  );
}

export default UploadPage;
