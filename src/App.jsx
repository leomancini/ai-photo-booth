import React, { useRef, useState } from "react";
import styled from "styled-components";

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
  border: 2px dashed ${(p) => (p.$filled ? "transparent" : "#3f3f46")};
  border-radius: 16px;
  background: ${(p) => (p.$filled ? "#000" : "#1a1a1f")};
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
  aspect-ratio: 1;
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
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const inputs = [useRef(null), useRef(null), useRef(null)];

  const pick = (i) => (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImages((prev) => {
      const next = [...prev];
      next[i] = { file, url: URL.createObjectURL(file) };
      return next;
    });
    setError(null);
  };

  const allFilled = images.every(Boolean);

  const combine = async () => {
    if (!allFilled || loading) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const form = new FormData();
      images.forEach((img) => form.append("images", img.file));
      const res = await fetch("/api/combine", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setResults(data.results);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
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
            onClick={() => inputs[i].current?.click()}
          >
            <SlotNum>{i + 1}</SlotNum>
            {img ? <img src={img.url} alt={`Upload ${i + 1}`} /> : "Tap to add photo"}
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
              {r.image ? (
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
