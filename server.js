import express from "express";
import multer from "multer";
import sharp from "sharp";
import "dotenv/config";
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
  "Combine these three images into a single, cohesive image. Blend the " +
  "subjects and scenes together naturally into one unified composition. " +
  "Return a single image in portrait orientation with a 2:3 aspect ratio " +
  "(like a 4x6 photo print, taller than wide). ";

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
    forbid: "grey-and-white cats",
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
  let content;
  if (refs.length) {
    // Interleave text labels so the model can't confuse the subject photos
    // with the style examples.
    content = [
      {
        type: "text",
        text:
          style.prompt +
          " Here are the 3 photos to combine — every subject in the final " +
          "image must come from these 3 photos:",
      },
      ...imageContent,
      {
        type: "text",
        text:
          `Next are ${refs.length} STYLE REFERENCE image(s). Use ONLY the ` +
          "STYLE of these reference images: color palette, backgrounds, " +
          "decorative elements, composition style, and mood. DO NOT USE ANY " +
          "of the human faces or cat/pet photos that appear in the " +
          "reference images. EXCLUSIVELY use the faces and/or pets from the " +
          "user's 3 input photos above — no face, person, cat, or pet from " +
          "the reference images may appear in the output:",
      },
      ...refs,
      {
        type: "text",
        text:
          "Now create the combined image. Every person, animal, and subject " +
          "in the final image must come from the first 3 photos ONLY — " +
          "nothing from the reference images may appear. If the references " +
          "use repeated cut-out photos of a subject as decorative collage " +
          "elements, recreate that same collage effect but build the " +
          "cut-outs from subjects in the first 3 photos instead. Copy the " +
          "references' backgrounds, colors, sparkle, and layout — never " +
          "their subjects." +
          (style.forbid
            ? ` STRICT RULE: the reference images contain ${style.forbid}. ` +
              `Absolutely NO ${style.forbid} may appear anywhere in the ` +
              "output unless they are also present in the first 3 photos."
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

// Generate one style per request; the client fires one request per style and
// shows each result as soon as it's ready.
app.post("/api/combine", upload.array("images", 3), async (req, res) => {
  if (!process.env.POE_API_KEY) {
    return res.status(500).json({ error: "POE_API_KEY is not configured" });
  }

  const style = STYLES.find((s) => s.id === req.body.style);
  if (!style) {
    return res.status(400).json({ error: "Unknown style" });
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

    const image = await generateStyledImage(style, imageContent);
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
