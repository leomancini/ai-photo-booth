import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";

// Downscale and re-encode an image in the browser so uploads are small
// (a 10MB phone photo becomes a few hundred KB). Falls back to the original
// file if the browser can't decode it.
const MAX_UPLOAD_DIMENSION = 1536;

async function compressImage(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(
      1,
      MAX_UPLOAD_DIMENSION / Math.max(bitmap.width, bitmap.height)
    );
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    return blob || file;
  } catch {
    return file;
  }
}

const Page = styled.div`
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 20px 80px;
  box-sizing: border-box;
  background: #0f0f12;
  color: #f4f4f5;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
`;

const Title = styled.h1`
  font-size: 30px;
  font-weight: 700;
  margin: 0 0 6px;
`;

const Subtitle = styled.p`
  margin: 0 0 36px;
  color: #a1a1aa;
  font-size: 15px;
`;

const Slots = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  width: 100%;
  max-width: 720px;

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

const Slot = styled.button`
  position: relative;
  aspect-ratio: 1;
  border: 2px dashed
    ${(p) => (p.$dragging ? "#6366f1" : p.$filled ? "transparent" : "#3f3f46")};
  border-radius: 16px;
  background: ${(p) =>
    p.$dragging ? "#26263a" : p.$filled ? "#000" : "#1a1a1f"};
  color: #71717a;
  font-size: 14px;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s, background 0.15s;

  &:hover {
    border-color: ${(p) => (p.$filled ? "transparent" : "#6366f1")};
    color: #a1a1aa;
  }

  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

const SlotNum = styled.span`
  position: absolute;
  top: 8px;
  left: 10px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  padding: 2px 8px;
  border-radius: 999px;
  z-index: 1;
`;

const Button = styled.button`
  margin-top: 32px;
  padding: 14px 32px;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  background: ${(p) => (p.disabled ? "#3f3f46" : "#6366f1")};
  border: none;
  border-radius: 999px;
  cursor: ${(p) => (p.disabled ? "not-allowed" : "pointer")};
  transition: background 0.15s;

  &:hover:enabled {
    background: #4f46e5;
  }
`;

const ErrorMsg = styled.p`
  color: #f87171;
  font-size: 14px;
  margin-top: 16px;
`;

const Results = styled.div`
  margin-top: 40px;
  width: 100%;
  max-width: 1080px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
    max-width: 720px;
  }
`;

const ResultCard = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;

  img {
    width: 100%;
    border-radius: 16px;
  }
`;

const ResultLabel = styled.h3`
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 600;
  color: #d4d4d8;
`;

const ResultError = styled.div`
  width: 100%;
  aspect-ratio: 2 / 3;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: #1a1a1f;
  color: #f87171;
  font-size: 14px;
  padding: 16px;
  box-sizing: border-box;
  text-align: center;
`;

const ResultPending = styled.div`
  width: 100%;
  aspect-ratio: 2 / 3;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: #1a1a1f;
  color: #71717a;
  font-size: 14px;
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

const DownloadLink = styled.a`
  margin-top: 12px;
  color: #a5b4fc;
  font-size: 14px;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

function App() {
  const [images, setImages] = useState([null, null, null]);
  const [styles, setStyles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const inputs = [useRef(null), useRef(null), useRef(null)];

  useEffect(() => {
    fetch("/api/styles")
      .then((r) => r.json())
      .then((d) => setStyles(d.styles || []))
      .catch(() => {});
  }, []);

  const setImage = async (i, file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const compressed = await compressImage(file);
    setImages((prev) => {
      const next = [...prev];
      next[i] = { file: compressed, url: URL.createObjectURL(compressed) };
      return next;
    });
    setError(null);
  };

  const pick = (i) => (e) => {
    setImage(i, e.target.files?.[0]);
  };

  const onDragOver = (i) => (e) => {
    e.preventDefault();
    setDragIndex(i);
  };

  const onDragLeave = () => setDragIndex(null);

  const onDrop = (i) => (e) => {
    e.preventDefault();
    setDragIndex(null);
    setImage(i, e.dataTransfer.files?.[0]);
  };

  const allFilled = images.every(Boolean);

  const combine = async () => {
    if (!allFilled || loading || !styles.length) return;
    setLoading(true);
    setError(null);
    setResults(null);

    // Upload the 3 photos once; the style requests reuse them by ID.
    let uploadId;
    try {
      const form = new FormData();
      images.forEach((img, i) => form.append("images", img.file, `photo-${i}.jpg`));
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      uploadId = data.uploadId;
    } catch (e) {
      setError(e.message);
      setLoading(false);
      return;
    }

    setResults(styles.map((s) => ({ ...s, status: "pending" })));

    // One request per style, all in flight at once; each card fills in as
    // soon as its style finishes generating.
    await Promise.all(
      styles.map(async (s) => {
        try {
          const res = await fetch("/api/combine", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uploadId, style: s.id }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Generation failed");
          setResults((prev) =>
            prev.map((r) =>
              r.id === s.id ? { ...r, status: "done", image: data.image } : r
            )
          );
        } catch (e) {
          setResults((prev) =>
            prev.map((r) =>
              r.id === s.id ? { ...r, status: "error", error: e.message } : r
            )
          );
        }
      })
    );
    setLoading(false);
  };

  return (
    <Page>
      <Title>AI Photo Booth</Title>
      <Subtitle>
        Upload three photos — get them combined in three different styles.
      </Subtitle>

      <Slots>
        {images.map((img, i) => (
          <Slot
            key={i}
            $filled={!!img}
            $dragging={dragIndex === i}
            onClick={() => inputs[i].current?.click()}
            onDragOver={onDragOver(i)}
            onDragLeave={onDragLeave}
            onDrop={onDrop(i)}
          >
            <SlotNum>{i + 1}</SlotNum>
            {img ? (
              <img src={img.url} alt={`Upload ${i + 1}`} />
            ) : (
              "Tap or drop a photo"
            )}
            <input
              ref={inputs[i]}
              type="file"
              accept="image/*"
              hidden
              onChange={pick(i)}
            />
          </Slot>
        ))}
      </Slots>

      <Button disabled={!allFilled || loading} onClick={combine}>
        {loading ? "Creating 3 styles…" : "Combine Photos"}
      </Button>

      {error && <ErrorMsg>{error}</ErrorMsg>}

      {results && (
        <Results>
          {results.map((r) => (
            <ResultCard key={r.id}>
              <ResultLabel>{r.label}</ResultLabel>
              {r.status === "pending" ? (
                <ResultPending>Creating…</ResultPending>
              ) : r.status === "done" ? (
                <>
                  <img src={r.image} alt={r.label} />
                  <DownloadLink
                    href={r.image}
                    download={`ai-photo-booth-${r.id}.jpg`}
                  >
                    Download
                  </DownloadLink>
                </>
              ) : (
                <ResultError>{r.error || "Generation failed"}</ResultError>
              )}
            </ResultCard>
          ))}
        </Results>
      )}
    </Page>
  );
}

export default App;
