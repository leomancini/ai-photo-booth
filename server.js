import express from "express";
import multer from "multer";
import sharp from "sharp";
import { WebSocketServer } from "ws";
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
  "IMPORTANT: DO NOT change the faces from the user input photos! Render " +
  "every person's face faithfully — each face must stay accurate, " +
  "recognizable, and true to how it appears in the input photos. Do not " +
  "alter facial features, identity, or likeness, even when applying a " +
  "strong artistic style. " +
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
    // References are pattern/texture images; pick one at random per
    // generation for variety.
    const ref = refs[Math.floor(Math.random() * refs.length)];
    content = [
      {
        type: "text",
        text:
          "First, here is a STYLE REFERENCE image — a pattern to draw " +
          "from. Use its colors, patterns, and decorative feel for the " +
          "background and decorative elements of your output:",
      },
      ref,
      {
        type: "text",
        text: `Now, here are the ${n} photos of the subjects to combine:`,
      },
      ...imageContent,
      {
        type: "text",
        text:
          style.prompt +
          ` Combine the subjects from the ${n} photos above into one ` +
          "image, using the style reference's palette and patterns for " +
          "the background and decorations.",
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
  return Buffer.from(await imgRes.arrayBuffer());
}

// Normalize an uploaded file to a compressed JPEG data URL content part.
async function normalizeUpload(file) {
  const buf = await sharp(file.buffer)
    .rotate()
    .resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 88 })
    .toBuffer();
  return {
    type: "image_url",
    image_url: { url: `data:image/jpeg;base64,${buf.toString("base64")}` },
  };
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
    const imageContent = await Promise.all(files.map(normalizeUpload));

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
    const buf = await generateStyledImage(style, entry.imageContent);
    res.json({
      id: style.id,
      label: style.label,
      image: `data:image/jpeg;base64,${buf.toString("base64")}`,
    });
  } catch (e) {
    console.error(`[combine:${style.id}] error:`, e);
    res.status(500).json({ error: e.message || "Failed to combine images" });
  }
});

// ---------------------------------------------------------------------------
// Booth sessions: a kiosk screen (/booth) creates a session and shows a QR
// code; the phone scans it, uploads photos, and the kiosk polls for results.
// ---------------------------------------------------------------------------
const sessions = new Map();
const SESSION_TTL_MS = 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}, 5 * 60 * 1000).unref();

// WebSocket subscribers per session; the kiosk gets pushed a session
// snapshot on connect and whenever the session changes.
const sessionSockets = new Map();

function sessionSnapshot(s) {
  return {
    status: s.status,
    results: s.results.map(({ id, label, status, error }) => ({
      id,
      label,
      status,
      error,
    })),
  };
}

function broadcastSession(sessionId) {
  const s = sessions.get(sessionId);
  const sockets = sessionSockets.get(sessionId);
  if (!s || !sockets) return;
  const msg = JSON.stringify(sessionSnapshot(s));
  for (const socket of sockets) {
    try {
      socket.send(msg);
    } catch {}
  }
}

app.post("/api/session", (req, res) => {
  // A new session immediately frees all previous sessions (and their
  // generated images) — only one booth session is active at a time.
  sessions.clear();

  const sessionId = randomUUID();
  sessions.set(sessionId, {
    createdAt: Date.now(),
    status: "waiting",
    results: [],
    images: new Map(),
  });
  res.json({ sessionId });
});

app.get("/api/session/:id", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "Session not found" });
  res.json({
    status: s.status,
    results: s.results.map(({ id, label, status, error }) => ({
      id,
      label,
      status,
      error,
    })),
  });
});

// The phone pings this when the upload page loads so the kiosk knows the
// QR code was scanned.
app.post("/api/session/:id/scanned", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "Session not found" });
  if (s.status === "waiting") {
    s.status = "scanned";
    broadcastSession(req.params.id);
  }
  res.json({ ok: true });
});

app.get("/api/session/:id/image/:styleId", (req, res) => {
  const s = sessions.get(req.params.id);
  const buf = s?.images.get(req.params.styleId);
  if (!buf) return res.status(404).end();
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.end(buf);
});

// The phone posts its photos here; generation runs in the background and the
// kiosk sees each style appear in the session as it finishes.
app.post("/api/session/:id/photos", upload.array("images", 3), async (req, res) => {
  if (!process.env.POE_API_KEY) {
    return res.status(500).json({ error: "POE_API_KEY is not configured" });
  }

  const s = sessions.get(req.params.id);
  if (!s) {
    return res.status(404).json({ error: "Session not found — rescan the QR code" });
  }
  if (s.status === "generating") {
    return res.status(409).json({ error: "Already creating photos for this session" });
  }

  const files = req.files || [];
  if (files.length < 2 || files.length > 3) {
    return res.status(400).json({ error: "Please upload 2 or 3 images" });
  }

  try {
    const imageContent = await Promise.all(files.map(normalizeUpload));

    const sessionId = req.params.id;
    s.status = "generating";
    s.results = STYLES.map(({ id, label }) => ({ id, label, status: "pending" }));
    s.images = new Map();
    res.json({ ok: true });
    broadcastSession(sessionId);

    Promise.allSettled(
      STYLES.map(async (style) => {
        const entry = s.results.find((r) => r.id === style.id);
        try {
          const buf = await generateStyledImage(style, imageContent);
          s.images.set(style.id, buf);
          entry.status = "done";
        } catch (e) {
          console.error(`[session:${style.id}] error:`, e);
          entry.status = "error";
          entry.error = e.message || "Generation failed";
        }
        broadcastSession(sessionId);
      })
    ).then(() => {
      s.status = "done";
      broadcastSession(sessionId);
    });
  } catch (e) {
    console.error("[session photos] error:", e);
    res.status(500).json({ error: e.message || "Failed to process images" });
  }
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

const server = app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});

// Kiosk clients connect to /ws?session=<id> for live session updates.
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (socket, req) => {
  const url = new URL(req.url, "http://localhost");
  const sessionId = url.searchParams.get("session");
  if (!sessionId) return socket.close();

  let sockets = sessionSockets.get(sessionId);
  if (!sockets) sessionSockets.set(sessionId, (sockets = new Set()));
  sockets.add(socket);

  socket.on("close", () => {
    sockets.delete(socket);
    if (!sockets.size) sessionSockets.delete(sessionId);
  });

  const s = sessions.get(sessionId);
  if (s) socket.send(JSON.stringify(sessionSnapshot(s)));
});
