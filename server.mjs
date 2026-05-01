import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleKakaoCallback, handleKakaoLogin, sendKakaoSession } from "./api/kakao-auth.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
loadDotEnv();

const PORT = Number(process.env.PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const ALLOW_UNAUTHENTICATED_GENERATE = process.env.ALLOW_UNAUTHENTICATED_GENERATE === "true";
const MAX_JSON_BYTES = 14 * 1024 * 1024;

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
]);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": payload?.ok && ("supabaseUrl" in payload || "hasApiKey" in payload) ? "no-store" : "no-cache",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        reject(new Error("업로드가 너무 커. 10MB 이하 사진으로 줄여서 다시 해봐."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("요청 JSON을 읽지 못했어."));
      }
    });
    req.on("error", reject);
  });
}

function clean(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).replace(/\s+/g, " ").trim().slice(0, 1600) || fallback;
}

function cleanMultiline(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+/g, " ")
    .trim()
    .slice(0, 3000) || fallback;
}

function validateRequiredInput(input) {
  if (!String(input.diary || "").trim()) {
    throw new Error("오늘 한 줄만 써줘. 진짜 짧아도 괜찮아.");
  }
}

function normalizeSize(value) {
  const allowed = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
  return allowed.has(value) ? value : "1024x1536";
}

function normalizeQuality(value) {
  const allowed = new Set(["low", "medium", "high", "auto"]);
  return allowed.has(value) ? value : "medium";
}

function normalizeFormat(value) {
  const allowed = new Set(["png", "jpeg", "webp"]);
  return allowed.has(value) ? value : "png";
}

function parseDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const match = String(dataUrl).match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\n\r]+)$/);
  if (!match) throw new Error("사진은 png, jpg, webp만 받을 수 있어.");
  const mime = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error("사진이 너무 커. 10MB 이하로 압축해서 넣어봐.");
  }
  return { mime, buffer };
}

function buildDiaryPrompt(input) {
  validateRequiredInput(input);

  const date = clean(input.date, "오늘");
  const weather = clean(input.weather, "맑음");
  const diary = cleanMultiline(input.diary, "오늘 별일은 없었지만 그래도 하루를 살았다.");
  const moodType = clean(input.moodType, "funny");
  const hasReference = Boolean(input.referenceImageDataUrl);
  const moodGuide = {
    funny: "성인의 현실을 초등학생처럼 단순하게 적어서 살짝 웃기지만 따뜻하게. 과한 밈이나 조롱은 금지.",
    soft: "별일 아닌 하루도 조금 애틋하고 소중하게. 슬프게 과장하지 말고 조용히 다정하게.",
    kid: "정말 초등학교 2학년 남자아이가 쓴 것처럼 단순하고 솔직하게. 관찰 위주로.",
  }[moodType] || "초등학생 그림일기처럼 짧고 단순하고 따뜻하게.";

  return `
Create one realistic photographed Korean elementary-school picture diary homework page from the user's tiny daily note.

Core concept:
- This is not an AI art tool result. It is a quiet daily ritual artifact.
- Turn an ordinary adult day into a 2010-2013 Korean elementary-school vacation homework picture diary.
- Student persona: a Korean elementary school 2nd grade boy.
- Page type: Korean “그림일기” worksheet with printed boxes for 날짜, 날씨, 제목, 그림, and 일기 lines.
- Date field: ${date}
- Weather field: ${weather}
- Title field: infer a very short childish title from the note, like "라면을 먹었다", "회사에 갔다", "비를 맞았다".
- Mood direction: ${moodGuide}

User's original tiny note:
${diary}

Rewrite the diary text yourself in Korean before drawing it:
- 4 to 6 very short lines.
- Use simple elementary-school wording, not adult essay style.
- It can gently collide adult reality with childlike wording.
- Example tone for "퇴근하고 편의점 라면 먹음":
  제목: 라면을 먹었다
  오늘 회사에 갔다.
  일이 많아서 힘들었다.
  집에 오는 길에 라면을 먹었다.
  맛있었다.
  다음에는 부자가 되고 싶다.
- Keep it warm and funny, not meme-heavy.
- Avoid polished literary phrasing.

Visual requirements:
- The result is NOT a clean digital poster. It is a phone photo of real paper.
- Use slightly wrinkled workbook paper, faint shadows, page edge, printed gray table lines, and a small page number near the bottom.
- The top heading should say “그림일기”. Include a simple instruction line like a Korean workbook.
- Draw the main illustration as a child's crayon/color-pencil drawing: naive proportions, uneven coloring, colors outside the lines, simple sun/trees/people/objects, awkward body proportions, imperfect lines, childlike perspective.
- The diary lines should be handwritten in Korean pencil, large and uneven, legible but juvenile.
- Make the Korean short, simple, and plausible for a young child.
- Preserve the feeling of a Korean 2010s school homework notebook photographed with a phone.
- Keep the page portrait-oriented, similar to a Korean school workbook page photographed at a slight angle.

${hasReference ? "Reference image instruction: Use the uploaded photo only as memory/source material for the event, characters, place, composition, clothing colors, and props. Do not output the original photo. Transform it into a child-made picture diary page." : "No reference photo was provided. Infer a simple childlike scene from the note."}

Important negative constraints:
- Do not create beautiful anime, mascot, Pixar-like, webtoon, polished children's book, or cute professional character art.
- Do not create adult calligraphy or perfect typography.
- Do not create a blank worksheet.
- Do not make the drawing too skilled.
- Do not add modern smartphones, QR codes, tablets, app UI, social media icons, rankings, likes, or AI-watermark-looking graphics.
- Do not make the page too clean, centered, symmetrical, or design-system-like.
`.trim();
}

async function callOpenAIImageGeneration({ prompt, size, quality, outputFormat }) {
  const payload = {
    model: OPENAI_IMAGE_MODEL,
    prompt,
    n: 1,
    size,
    quality,
    output_format: outputFormat,
    background: "opaque",
    moderation: "auto",
  };

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json?.error?.message || `OpenAI 이미지 생성 실패: ${response.status}`;
    throw new Error(message);
  }

  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error("이미지 결과를 받지 못했어.");
  return { b64, usage: json?.usage || null };
}

async function callOpenAIImageEdit({ prompt, referenceImage, size, quality, outputFormat }) {
  const ext = referenceImage.mime === "image/png" ? "png" : referenceImage.mime === "image/webp" ? "webp" : "jpg";
  const form = new FormData();
  form.append("model", OPENAI_IMAGE_MODEL);
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", size);
  form.append("quality", quality);
  form.append("output_format", outputFormat);
  form.append("background", "opaque");
  form.append("moderation", "auto");
  form.append("image[]", new Blob([referenceImage.buffer], { type: referenceImage.mime }), `reference.${ext}`);

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: form,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json?.error?.message || `OpenAI 이미지 편집 실패: ${response.status}`;
    throw new Error(message);
  }

  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error("이미지 결과를 받지 못했어.");
  return { b64, usage: json?.usage || null };
}

async function handleGenerate(req, res) {
  try {
    if (!OPENAI_API_KEY) {
      sendJson(res, 400, {
        ok: false,
        error: "OPENAI_API_KEY가 없어. .env나 실행 환경에 키를 넣고 다시 켜줘.",
      });
      return;
    }

    if (!ALLOW_UNAUTHENTICATED_GENERATE) {
      await requireSupabaseUser(req);
    }

    const input = await readJson(req);
    validateRequiredInput(input);
    const size = normalizeSize(input.size);
    const quality = normalizeQuality(input.quality);
    const outputFormat = normalizeFormat(input.outputFormat);
    const prompt = buildDiaryPrompt(input);
    const referenceImage = parseDataUrl(input.referenceImageDataUrl);

    const result = referenceImage
      ? await callOpenAIImageEdit({ prompt, referenceImage, size, quality, outputFormat })
      : await callOpenAIImageGeneration({ prompt, size, quality, outputFormat });

    sendJson(res, 200, {
      ok: true,
      image: `data:image/${outputFormat === "jpg" ? "jpeg" : outputFormat};base64,${result.b64}`,
      usage: result.usage,
      model: OPENAI_IMAGE_MODEL,
      mode: referenceImage ? "reference-image" : "text-only",
    });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "알 수 없는 오류가 났어." });
  }
}

async function requireSupabaseUser(req) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    const error = new Error("그림일기 생성에는 Supabase 로그인 설정이 필요해.");
    error.statusCode = 503;
    throw error;
  }

  const authorization = String(req.headers.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error("로그인해야 그림일기를 만들 수 있어.");
    error.statusCode = 401;
    throw error;
  }

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${match[1]}`,
    },
  });

  if (!response.ok) {
    const error = new Error("로그인이 만료됐어. 다시 로그인해줘.");
    error.statusCode = 401;
    throw error;
  }
}

async function handlePrompt(req, res) {
  sendJson(res, 200, {
    ok: false,
    error: "이 앱은 프롬프트를 보여주지 않아. 오늘 한 줄만 쓰면 그림일기로 바꿔줄게.",
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const requestedPath = path.normalize(path.join(publicDir, pathname));
  if (!requestedPath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(requestedPath, (err, data) => {
    if (err) {
      sendText(res, 404, "Not found");
      return;
    }
    const ext = path.extname(requestedPath).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeTypes.get(ext) || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/config") {
    sendJson(res, 200, {
      ok: true,
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
      authRequiredForGenerate: !ALLOW_UNAUTHENTICATED_GENERATE,
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      hasApiKey: Boolean(OPENAI_API_KEY),
      imageModel: OPENAI_IMAGE_MODEL,
      authRequiredForGenerate: !ALLOW_UNAUTHENTICATED_GENERATE,
    });
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/kakao-login")) {
    await handleKakaoLogin(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/kakao-callback")) {
    await handleKakaoCallback(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/kakao-session")) {
    sendKakaoSession(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/prompt") {
    await handlePrompt(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/generate") {
    await handleGenerate(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  sendText(res, 405, "Method not allowed");
});

server.listen(PORT, () => {
  console.log(`그림일기 타임머신 실행됨: http://localhost:${PORT}`);
  console.log(`OpenAI API key: ${OPENAI_API_KEY ? "있음" : "없음 - .env 설정 필요"}`);
  console.log(`Image model: ${OPENAI_IMAGE_MODEL}`);
});
