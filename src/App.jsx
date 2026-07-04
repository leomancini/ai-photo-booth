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
import BoothPage from "./BoothPage.jsx";
import UploadPage from "./UploadPage.jsx";

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

// Kiosk API key, provided as ?key=... in the URL.
const KEY = new URLSearchParams(window.location.search).get("key") || "";

function HomePage() {
  const { images, setImage, filled, canCombine } = usePhotos();
  const [styles, setStyles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`/api/styles?key=${encodeURIComponent(KEY)}`)
      .then((r) => r.json())
      .then((d) => setStyles(d.styles || []))
      .catch(() => {});
  }, []);

  const combine = async () => {
    if (!canCombine || loading || !styles.length) return;
    setLoading(true);
    setError(null);
    setResults(null);

    // Upload the photos once; the style requests reuse them by ID.
    let uploadId;
    try {
      const form = new FormData();
      filled.forEach((img, i) => form.append("images", img.file, `photo-${i}.jpg`));
      const res = await fetch(`/api/upload?key=${encodeURIComponent(KEY)}`, {
        method: "POST",
        body: form,
      });
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
          const res = await fetch(`/api/combine?key=${encodeURIComponent(KEY)}`, {
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
        Upload two or three photos — get them combined in three different
        styles.
      </Subtitle>

      <PhotoSlots
        images={images}
        onSetImage={(i, file) => {
          setImage(i, file);
          setError(null);
        }}
      />

      <Button disabled={!canCombine || loading} onClick={combine}>
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

function App() {
  const path = window.location.pathname;
  if (path.startsWith("/debug")) return <HomePage />;
  const uploadMatch = path.match(/^\/u(?:pload)?\/([\w-]+)/);
  if (uploadMatch) return <UploadPage sessionId={uploadMatch[1]} />;
  // The booth kiosk is the main page (also reachable at /booth).
  return <BoothPage />;
}

export default App;
