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

// The styles generated for each set of uploads. Each entry produces one
// combined image; edit the prompts to change how the images get combined.
const BASE_PROMPT =
  "Combine these three images into a single, cohesive image. Blend the " +
  "subjects and scenes together naturally into one unified composition. " +
  "Return a single image. ";

const STYLES = [
  {
    id: "whimsical",
    label: "Whimsical",
    prompt:
      BASE_PROMPT +
      "Make it whimsical and fantastical: sparkling fairy dust, glowing " +
      "magical light, bright saturated colors, dreamlike storybook wonder.",
  },
  {
    id: "classic",
    label: "Classic Family Photo",
    prompt:
      BASE_PROMPT +
      "Make it look like a classic old-style formal family photograph: " +
      "vintage studio portrait, sepia or faded tones, formal posed " +
      "composition, soft studio lighting, aged photo texture.",
  },
  {
    id: "movie-poster",
    label: "Movie Poster",
    prompt:
      BASE_PROMPT +
      "Make it look like an old-school vintage movie poster: dramatic " +
      "painted illustration style, bold title typography, retro color " +
      "palette, cinematic composition with billing block at the bottom.",
  },
];

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
// Combine three images via Nano Banana 2 on the Poe API
// ---------------------------------------------------------------------------
async function generateStyledImage(prompt, imageContent) {
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
              content: [{ type: "text", text: prompt }, ...imageContent],
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
    throw new Error("No image returned by the model");
  }

  const imgRes = await fetch(urlMatch[0]);
  if (!imgRes.ok) throw new Error("Failed to download the combined image");
  const resultBuf = Buffer.from(await imgRes.arrayBuffer());
  return `data:image/jpeg;base64,${resultBuf.toString("base64")}`;
}

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

    // Generate all styles in parallel; tolerate individual failures.
    const settled = await Promise.allSettled(
      STYLES.map((style) => generateStyledImage(style.prompt, imageContent))
    );

    const results = STYLES.map((style, i) => ({
      id: style.id,
      label: style.label,
      image: settled[i].status === "fulfilled" ? settled[i].value : null,
      error: settled[i].status === "rejected" ? settled[i].reason?.message : null,
    }));

    if (results.every((r) => !r.image)) {
      return res.status(502).json({ error: "No images returned by the model" });
    }

    res.json({ results });
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
