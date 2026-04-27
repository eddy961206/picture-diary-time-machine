import { promptPayload, sendJson } from "./_diary.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    sendJson(res, 200, await promptPayload(req));
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message });
  }
}
