import express from "express";
import multer from "multer";
import sharp from "sharp";
import "dotenv/config";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3139;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const POE_MODEL = "Nano-Banana-2";

// The prompt sent to Nano Banana 2 along with the three uploaded images.
// Edit this to change how the images get combined.
const COMBINE_PROMPT =
  "Combine these three images into a single, cohesive photo. Blend the " +
  "subjects and scenes together naturally into one unified composition with " +
  "consistent lighting, color, and perspective. Return a single image.";

// Max dimension the uploaded images are resized to before sending (keeps the
// request payload reasonable and improves reliability).
const MAX_DIMENSION = 1536;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only images are allowed"));
  },
});

app.use(express.json());
app.use(express.static(join(__dirname, "dist")));

// ---------------------------------------------------------------------------
// Combine three images into one via Nano Banana 2 on the Poe API
// ---------------------------------------------------------------------------
app.post("/api/combine", upload.array("images", 3), async (req, res) => {
  if (!process.env.POE_API_KEY) {
    return res.status(500).json({ error: "POE_API_KEY is not configured" });
  }

  const files = req.files || [];
  if (files.length !== 3) {
    return res.status(400).json({ error: "Please upload exactly three images" });
  }

  try {
    // Normalize each image to a compressed JPEG data URL.
    const imageContent = await Promise.all(
      files.map(async (file) => {
        const buf = await sharp(file.buffer)
          .rotate()
          .resize(MAX_DIMENSION, MAX_DIMENSION, {
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 88 })
          .toBuffer();
        const dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
        return { type: "image_url", image_url: { url: dataUrl } };
      })
    );

    // Call Poe (OpenAI-compatible) with retries.
    let response;
    for (let retry = 0; retry < 3; retry++) {
      try {
        const poeRes = await fetch("https://api.poe.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.POE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: POE_MODEL,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: COMBINE_PROMPT }, ...imageContent],
              },
            ],
            stream: false,
          }),
        });
        response = await poeRes.json();
        break;
      } catch (e) {
        if (retry < 2) await new Promise((r) => setTimeout(r, 3000));
        else throw e;
      }
    }

    const content = response?.choices?.[0]?.message?.content || "";
    const urlMatch = content.match(/https:\/\/[^\s")]+poecdn\.net\/[^\s")]+/);
    if (!urlMatch) {
      console.warn("[combine] No image URL in Poe response:", content.slice(0, 500));
      return res.status(502).json({ error: "No image returned by the model" });
    }

    const imgRes = await fetch(urlMatch[0]);
    if (!imgRes.ok) {
      return res.status(502).json({ error: "Failed to download the combined image" });
    }
    const resultBuf = Buffer.from(await imgRes.arrayBuffer());
    const resultDataUrl = `data:image/jpeg;base64,${resultBuf.toString("base64")}`;

    res.json({ image: resultDataUrl });
  } catch (e) {
    console.error("[combine] error:", e);
    res.status(500).json({ error: e.message || "Failed to combine images" });
  }
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
