import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  const date = clean(input.date, "2011년 8월 어느 날");
  const weather = clean(input.weather, "맑음");
  const title = clean(input.title, "즐거운 하루");
  const child = clean(input.child, "초등학교 2학년 남자아이");
  const place = clean(input.place, "여름 방학에 놀러 간 곳");
  const diary = cleanMultiline(input.diary, "오늘 재미있는 일을 했다. 정말 신났다. 다음에 또 하고 싶다.");
  const detail = clean(input.detail, "");
  const era = clean(input.era, "2010년대 초반 한국 초등학교 방학숙제");
  const mood = clean(input.mood, "옛날 추억, 싸이월드 이전/초기 스마트폰 사진 같은 생활감");
  const handwriting = clean(input.handwriting, "초등학교 2학년 남자아이의 삐뚤빼뚤하지만 읽히는 연필 글씨");
  const hasReference = Boolean(input.referenceImageDataUrl);

  return `
Create one realistic photographed Korean elementary-school picture diary homework page.

Core concept:
- It must look like a real physical workbook page, casually photographed on a desk in natural indoor light.
- Era/context: ${era}.
- Student persona: ${child}.
- Page type: Korean “그림일기” worksheet with printed boxes for 날짜, 날씨, 제목, 그림, and 일기 lines.
- Date field: ${date}
- Weather field: ${weather}
- Title field: ${title}
- Place/event cue: ${place}
- Mood: ${mood}
- Handwriting: ${handwriting}

Diary content to appear in Korean handwriting, rewritten only slightly to sound like a 2nd grader:
${diary}

Extra user details:
${detail || "없음"}

Visual requirements:
- The result is NOT a clean digital poster. It is a phone photo of paper.
- Use slightly wrinkled white workbook paper, faint shadows, page edge, printed gray table lines, and a small page number near the bottom.
- The top heading should say “그림일기”. Include a simple instruction line like a Korean workbook.
- Draw the main illustration as a child’s crayon drawing: naive proportions, uneven coloring, simple sun/trees/people/objects, imperfect lines, childlike perspective.
- The diary lines should be handwritten in Korean pencil, large and uneven, legible but juvenile.
- Make the written Korean plausible, short, and emotionally simple.
- Avoid looking too polished, too modern, or like a generated infographic.
- Keep the page portrait-oriented, similar to a Korean school workbook page photographed at a slight angle.

${hasReference ? "Reference image instruction: Use the uploaded photo only as memory/source material for the event, characters, place, composition, clothing colors, and props. Do not output the original photo. Transform it into a child-made picture diary page." : "No reference photo was provided. Infer a simple childlike scene from the diary text."}

Important negative constraints:
- Do not create adult calligraphy.
- Do not create perfect typography.
- Do not create a blank worksheet.
- Do not make the drawing too skilled.
- Do not add modern smartphones, QR codes, tablets, UI elements, or AI-watermark-looking graphics.
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
  return { b64, revisedPrompt: json?.data?.[0]?.revised_prompt || null, usage: json?.usage || null };
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
  return { b64, revisedPrompt: json?.data?.[0]?.revised_prompt || null, usage: json?.usage || null };
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

    const input = await readJson(req);
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
      prompt,
      revisedPrompt: result.revisedPrompt,
      usage: result.usage,
      model: OPENAI_IMAGE_MODEL,
      mode: referenceImage ? "reference-image" : "text-only",
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "알 수 없는 오류가 났어." });
  }
}

async function handlePrompt(req, res) {
  try {
    const input = await readJson(req);
    sendJson(res, 200, { ok: true, prompt: buildDiaryPrompt(input) });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message });
  }
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
  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      hasApiKey: Boolean(OPENAI_API_KEY),
      imageModel: OPENAI_IMAGE_MODEL,
    });
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
