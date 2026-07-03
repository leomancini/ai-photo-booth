import express from "express";
import multer from "multer";
import sharp from "sharp";
import "dotenv/config";
import { randomUUID } from "crypto";
import { existsSync, readdirSync } from "fs";
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
  "Combine these images into a single, cohesive image. Blend the " +
  "subjects and scenes together naturally into one unified composition. " +
  "IMPORTANT: render every person's face faithfully — each face must stay " +
  "accurate, recognizable, and true to how it appears in the input photos. " +
  "Do not alter facial features, identity, or likeness, even when applying " +
  "a strong artistic style. " +
  "Return a single image in portrait orientation with a 2:3 aspect ratio " +
  "(like a 4x6 photo print, taller than wide). NEVER add a border, frame, " +
  "mat, or margin of any kind — the artwork must always be full bleed, " +
  "extending edge-to-edge on all four sides. ";

const STYLES = [
  {
    id: "whimsical",
    label: "Whimsical",
    prompt:
      BASE_PROMPT +
      "Make it whimsical and fantastical: sparkling fairy dust, glowing " +
      "magical light, bright saturated colors, dreamlike storybook wonder.",
    // Subjects that appear in this style's reference images and must not
    // leak into the output.
    forbid:
      "grey-and-white cats, a woman with long dark hair in a pink-and-blue " +
      "sweater, a bearded man in a black t-shirt, and a woman with long " +
      "dark wavy hair",
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

// Style reference examples: drop images into style-refs/{style-id}/ and they
// get sent along with that style's request as visual examples to match.
const STYLE_REFS_DIR = join(__dirname, "style-refs");
const REF_MAX_DIMENSION = 1024;

async function loadStyleRefs(styleId) {
  const dir = join(STYLE_REFS_DIR, styleId);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f))
    .sort();
  return Promise.all(
    files.map(async (f) => {
      const buf = await sharp(join(dir, f))
        .rotate()
        .resize(REF_MAX_DIMENSION, REF_MAX_DIMENSION, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();
      return {
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${buf.toString("base64")}` },
      };
    })
  );
}

for (const style of STYLES) {
  style.refs = await loadStyleRefs(style.id);
  if (style.refs.length) {
    console.log(`Loaded ${style.refs.length} style reference(s) for "${style.id}"`);
  }
}

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
async function generateStyledImage(style, imageContent) {
  const refs = style.refs || [];
  const n = imageContent.length;
  let content;
  if (refs.length) {
    // Style references go FIRST and the user's photos go LAST (immediately
    // before the final instruction) — the model treats the most recent
    // images as the content to work with, which keeps reference subjects
    // from leaking into the output.
    content = [
      {
        type: "text",
        text:
          `First, here are ${refs.length} STYLE REFERENCE image(s). These ` +
          "are a style guide ONLY: take the color palette, backgrounds, " +
          "decorative elements, composition style, and mood from them. The " +
          "people, faces, cats, and pets shown in these references are NOT " +
          "part of your task and must NEVER appear in your output. Some " +
          "faces in the references are pixelated for privacy — that " +
          "pixelation is censorship, NOT part of the style; never pixelate " +
          "or obscure any face in your output:",
      },
      ...refs,
      {
        type: "text",
        text:
          `Now, here are the ${n} photos of the ACTUAL SUBJECTS. Every ` +
          "person, face, and pet in your output must come EXCLUSIVELY from " +
          `these ${n} photos:`,
      },
      ...imageContent,
      {
        type: "text",
        text:
          style.prompt +
          ` Use ONLY the subjects from the ${n} photos directly above — ` +
          "render their faces faithfully and recognizably. DO NOT USE ANY " +
          "human face or pet from the style reference images. If the " +
          "references use repeated cut-out photos of a subject as " +
          "decorative collage elements, recreate that same collage effect " +
          `but build the cut-outs from the ${n} subject photos instead. ` +
          "Copy the references' backgrounds, colors, sparkle, and layout — " +
          "never their people or pets." +
          (style.forbid
            ? ` STRICT RULE: the reference images contain ${style.forbid}. ` +
              `Absolutely NONE of these may appear anywhere in the output ` +
              `unless they are also present in the ${n} subject photos.`
            : ""),
      },
    ];
  } else {
    content = [{ type: "text", text: style.prompt }, ...imageContent];
  }

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
          messages: [{ role: "user", content }],
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

  const responseText = response?.choices?.[0]?.message?.content || "";
  const urlMatch = responseText.match(/https:\/\/[^\s")]+poecdn\.net\/[^\s")]+/);
  if (!urlMatch) {
    console.warn("[combine] No image URL in Poe response:", responseText.slice(0, 500));
    throw new Error("No image returned by the model");
  }

  const imgRes = await fetch(urlMatch[0]);
  if (!imgRes.ok) throw new Error("Failed to download the combined image");
  const resultBuf = Buffer.from(await imgRes.arrayBuffer());
  return `data:image/jpeg;base64,${resultBuf.toString("base64")}`;
}

// List the available styles so the client can render placeholders.
app.get("/api/styles", (req, res) => {
  res.json({ styles: STYLES.map(({ id, label }) => ({ id, label })) });
});

// Processed uploads are cached in memory so the images are uploaded once and
// reused across all style requests. Entries expire after 15 minutes.
const uploadStore = new Map();
const UPLOAD_TTL_MS = 15 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of uploadStore) {
    if (now - entry.createdAt > UPLOAD_TTL_MS) uploadStore.delete(id);
  }
}, 60 * 1000).unref();

// Upload the photos once; returns an ID the style requests reuse.
app.post("/api/upload", upload.array("images", 3), async (req, res) => {
  const files = req.files || [];
  if (files.length < 2 || files.length > 3) {
    return res.status(400).json({ error: "Please upload 2 or 3 images" });
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

    const uploadId = randomUUID();
    uploadStore.set(uploadId, { imageContent, createdAt: Date.now() });
    res.json({ uploadId });
  } catch (e) {
    console.error("[upload] error:", e);
    res.status(500).json({ error: e.message || "Failed to process images" });
  }
});

// Generate one style per request; the client fires one request per style and
// shows each result as soon as it's ready.
app.post("/api/combine", async (req, res) => {
  if (!process.env.POE_API_KEY) {
    return res.status(500).json({ error: "POE_API_KEY is not configured" });
  }

  const style = STYLES.find((s) => s.id === req.body.style);
  if (!style) {
    return res.status(400).json({ error: "Unknown style" });
  }

  const entry = uploadStore.get(req.body.uploadId);
  if (!entry) {
    return res.status(410).json({ error: "Upload expired — please try again" });
  }

  try {
    const image = await generateStyledImage(style, entry.imageContent);
    res.json({ id: style.id, label: style.label, image });
  } catch (e) {
    console.error(`[combine:${style.id}] error:`, e);
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
