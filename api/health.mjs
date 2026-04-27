import { healthPayload, sendJson } from "./_diary.mjs";

export default function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  sendJson(res, 200, healthPayload());
}
