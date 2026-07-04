import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { Page, Title, Subtitle, Button, ErrorMsg, compressImage } from "./shared.jsx";

const Previews = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  width: 100%;
  max-width: 480px;
  margin-top: 8px;
`;

const Preview = styled.div`
  position: relative;
  aspect-ratio: 1;
  border-radius: 14px;
  overflow: hidden;
  background: #1a1a1f;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

const Remove = styled.button`
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
`;

const AddButton = styled(Button)`
  background: ${(p) => (p.disabled ? "#1a1a1f" : "#27272a")};
  color: ${(p) => (p.disabled ? "#3f3f46" : "#f4f4f5")};

  &:hover:enabled {
    background: #3f3f46;
  }
`;

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

const MAX_PHOTOS = 3;

function UploadPage({ sessionId }) {
  const [photos, setPhotos] = useState([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);

  // Tell the kiosk the QR code was scanned.
  useEffect(() => {
    fetch(`/api/session/${sessionId}/scanned`, { method: "POST" }).catch(() => {});
  }, [sessionId]);

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || [])
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, MAX_PHOTOS - photos.length);
    if (!files.length) return;
    setError(null);
    const compressed = await Promise.all(files.map(compressImage));
    setPhotos((prev) =>
      [...prev, ...compressed.map((f) => ({ file: f, url: URL.createObjectURL(f) }))].slice(
        0,
        MAX_PHOTOS
      )
    );
  };

  const removePhoto = (i) =>
    setPhotos((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (photos.length < 2 || sending) return;
    setSending(true);
    setError(null);
    try {
      const form = new FormData();
      photos.forEach((img, i) => form.append("images", img.file, `photo-${i}.jpg`));
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

      {photos.length > 0 && (
        <Previews>
          {photos.map((p, i) => (
            <Preview key={p.url}>
              <img src={p.url} alt={`Photo ${i + 1}`} />
              <Remove onClick={() => removePhoto(i)}>✕</Remove>
            </Preview>
          ))}
        </Previews>
      )}

      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <AddButton
        disabled={photos.length >= MAX_PHOTOS}
        onClick={() => input.current?.click()}
      >
        {photos.length
          ? `Add More (${photos.length}/${MAX_PHOTOS})`
          : "Add Photos"}
      </AddButton>

      <Button disabled={photos.length < 2 || sending} onClick={submit}>
        {sending ? "Sending…" : "Create My Photos"}
      </Button>

      {error && <ErrorMsg>{error}</ErrorMsg>}
    </Page>
  );
}

export default UploadPage;
