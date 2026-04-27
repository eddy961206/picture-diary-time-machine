import { generatePayload, sendJson } from "./_diary.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const result = await generatePayload(req);
    sendJson(res, result.status, result.payload);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "알 수 없는 오류가 났어." });
  }
}
