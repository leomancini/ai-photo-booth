import React, { useRef, useState } from "react";
import styled from "styled-components";

// Downscale and re-encode an image in the browser so uploads are small
// (a 10MB phone photo becomes a few hundred KB). Falls back to the original
// file if the browser can't decode it.
const MAX_UPLOAD_DIMENSION = 1536;

export async function compressImage(file) {
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

export const Page = styled.div`
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 20px 80px;
  box-sizing: border-box;
  background: #000;
  color: #f4f4f5;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
`;

export const Title = styled.h1`
  font-size: 30px;
  font-weight: 700;
  margin: 0 0 6px;
`;

export const Subtitle = styled.p`
  margin: 0 0 36px;
  color: #a1a1aa;
  font-size: 15px;
  text-align: center;
`;

export const Button = styled.button`
  margin-top: 32px;
  padding: 14px 32px;
  font-size: 16px;
  font-weight: 600;
  color: ${(p) => (p.disabled ? "#71717a" : "#000")};
  background: ${(p) => (p.disabled ? "#3f3f46" : "#fff")};
  border: none;
  border-radius: 999px;
  cursor: ${(p) => (p.disabled ? "not-allowed" : "pointer")};
  transition: background 0.15s;

  &:hover:enabled {
    background: #d4d4d8;
  }
`;

export const ErrorMsg = styled.p`
  color: #f87171;
  font-size: 14px;
  margin-top: 16px;
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
    ${(p) => (p.$dragging ? "#fff" : p.$filled ? "transparent" : "#3f3f46")};
  border-radius: 16px;
  background: ${(p) =>
    p.$dragging ? "#27272a" : p.$filled ? "#000" : "#1a1a1f"};
  color: #71717a;
  font-size: 14px;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s, background 0.15s;

  &:hover {
    border-color: ${(p) => (p.$filled ? "transparent" : "#a1a1aa")};
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

// Three photo slots with click-to-pick and drag-and-drop. `images` is an
// array of 3 (null or {file, url}); onSetImage(i, file) handles a new file.
export function PhotoSlots({ images, onSetImage }) {
  const [dragIndex, setDragIndex] = useState(null);
  const inputs = [useRef(null), useRef(null), useRef(null)];

  return (
    <Slots>
      {images.map((img, i) => (
        <Slot
          key={i}
          $filled={!!img}
          $dragging={dragIndex === i}
          onClick={() => inputs[i].current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragIndex(i);
          }}
          onDragLeave={() => setDragIndex(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragIndex(null);
            onSetImage(i, e.dataTransfer.files?.[0]);
          }}
        >
          <SlotNum>{i + 1}</SlotNum>
          {img ? (
            <img src={img.url} alt={`Upload ${i + 1}`} />
          ) : i === 2 ? (
            "Tap or drop a photo (optional)"
          ) : (
            "Tap or drop a photo"
          )}
          <input
            ref={inputs[i]}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => onSetImage(i, e.target.files?.[0])}
          />
        </Slot>
      ))}
    </Slots>
  );
}

// Hook shared by pages that collect 2-3 photos.
export function usePhotos() {
  const [images, setImages] = useState([null, null, null]);

  const setImage = async (i, file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const compressed = await compressImage(file);
    setImages((prev) => {
      const next = [...prev];
      next[i] = { file: compressed, url: URL.createObjectURL(compressed) };
      return next;
    });
  };

  const filled = images.filter(Boolean);
  return { images, setImage, filled, canCombine: filled.length >= 1 };
}
