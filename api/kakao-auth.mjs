import crypto from "node:crypto";

const COOKIE_NAME = "kakao_oauth_state";
const COOKIE_MAX_AGE_SECONDS = 10 * 60;
const KAKAO_AUTHORIZE_URL = "https://kauth.kakao.com/oauth/authorize";
const KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token";
const KAKAO_SCOPES = "openid profile_nickname";

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getStateSecret() {
  return process.env.KAKAO_STATE_SECRET
    || process.env.KAKAO_CLIENT_SECRET
    || process.env.KAKAO_REST_API_KEY
    || "";
}

function getRequestOrigin(req) {
  if (process.env.KAKAO_REDIRECT_ORIGIN) return process.env.KAKAO_REDIRECT_ORIGIN.replace(/\/$/, "");

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || (req.socket?.encrypted ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${protocol}://${host}`;
}

function getCookieHeader(req) {
  return String(req.headers.cookie || "");
}

function parseCookies(req) {
  return Object.fromEntries(
    getCookieHeader(req)
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function signPayload(payload) {
  const secret = getStateSecret();
  if (!secret) throw new Error("KAKAO_REST_API_KEY 또는 KAKAO_STATE_SECRET이 필요해.");
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function createStateCookie({ state, nonce }) {
  const payload = base64UrlEncode(JSON.stringify({
    state,
    nonce,
    createdAt: Date.now(),
  }));
  const signature = signPayload(payload);
  return `${payload}.${signature}`;
}

function readStateCookie(req) {
  const raw = parseCookies(req)[COOKIE_NAME];
  if (!raw) throw new Error("카카오 로그인 상태 쿠키를 찾지 못했어.");

  const [payload, signature] = raw.split(".");
  if (!payload || !signature) throw new Error("카카오 로그인 상태 쿠키 형식이 이상해.");

  const expected = signPayload(payload);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("카카오 로그인 상태 검증에 실패했어.");
  }

  const parsed = JSON.parse(base64UrlDecode(payload));
  if (Date.now() - Number(parsed.createdAt || 0) > COOKIE_MAX_AGE_SECONDS * 1000) {
    throw new Error("카카오 로그인 시간이 초과됐어. 다시 시도해줘.");
  }

  return parsed;
}

function buildCookie(value, origin) {
  const secure = origin.startsWith("https://") ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure}`;
}

function clearCookie(origin) {
  const secure = origin.startsWith("https://") ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function redirect(res, status, url, headers = {}) {
  res.writeHead(status, {
    Location: url,
    ...headers,
  });
  res.end();
}

function redirectWithError(req, res, message) {
  const origin = getRequestOrigin(req);
  const url = new URL("/", origin);
  url.searchParams.set("error", "kakao_login_failed");
  url.searchParams.set("error_description", message);
  redirect(res, 302, url.toString(), {
    "Set-Cookie": clearCookie(origin),
  });
}

export function getKakaoRedirectUri(req) {
  return `${getRequestOrigin(req)}/api/kakao-callback`;
}

export function buildKakaoAuthorizeUrl(req, { state, nonce } = {}) {
  const clientId = process.env.KAKAO_REST_API_KEY || "";
  if (!clientId) throw new Error("KAKAO_REST_API_KEY가 필요해.");

  const url = new URL(KAKAO_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", getKakaoRedirectUri(req));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", KAKAO_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  return url;
}

export async function handleKakaoLogin(req, res) {
  try {
    const origin = getRequestOrigin(req);
    const state = crypto.randomBytes(24).toString("base64url");
    const nonce = crypto.randomBytes(24).toString("base64url");
    const cookie = createStateCookie({ state, nonce });
    const url = buildKakaoAuthorizeUrl(req, { state, nonce });

    redirect(res, 302, url.toString(), {
      "Set-Cookie": buildCookie(cookie, origin),
    });
  } catch (error) {
    redirectWithError(req, res, error.message || "카카오 로그인을 시작하지 못했어.");
  }
}

export async function exchangeKakaoCodeForTokenSet(req, code) {
  const clientId = process.env.KAKAO_REST_API_KEY || "";
  if (!clientId) throw new Error("KAKAO_REST_API_KEY가 필요해.");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: getKakaoRedirectUri(req),
    code,
  });

  if (process.env.KAKAO_CLIENT_SECRET) {
    body.set("client_secret", process.env.KAKAO_CLIENT_SECRET);
  }

  const response = await fetch(KAKAO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error_description || payload.error || `카카오 토큰 교환 실패: ${response.status}`;
    throw new Error(message);
  }

  if (!payload.id_token) {
    throw new Error("카카오에서 id_token을 받지 못했어. OpenID Connect와 openid scope를 확인해야 해.");
  }

  if (!payload.access_token) {
    throw new Error("카카오에서 access_token을 받지 못했어.");
  }

  return {
    accessToken: payload.access_token,
    idToken: payload.id_token,
  };
}

export async function handleKakaoCallback(req, res) {
  const origin = getRequestOrigin(req);

  try {
    const requestUrl = new URL(req.url, origin);
    const providerError = requestUrl.searchParams.get("error_description") || requestUrl.searchParams.get("error");
    if (providerError) throw new Error(providerError);

    const code = requestUrl.searchParams.get("code");
    const returnedState = requestUrl.searchParams.get("state");
    if (!code || !returnedState) throw new Error("카카오 인증 코드가 비어 있어.");

    const { state, nonce } = readStateCookie(req);
    if (state !== returnedState) throw new Error("카카오 로그인 state가 맞지 않아.");

    const { accessToken, idToken } = await exchangeKakaoCodeForTokenSet(req, code);
    const destination = new URL("/", origin);
    destination.hash = new URLSearchParams({
      kakao_access_token: accessToken,
      kakao_id_token: idToken,
      kakao_nonce: nonce,
    }).toString();

    redirect(res, 302, destination.toString(), {
      "Set-Cookie": clearCookie(origin),
    });
  } catch (error) {
    redirectWithError(req, res, error.message || "카카오 로그인 처리에 실패했어.");
  }
}
