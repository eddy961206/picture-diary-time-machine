import test from "node:test";
import assert from "node:assert/strict";

import {
  buildKakaoAuthorizeUrl,
  exchangeKakaoCodeForTokenSet,
  getKakaoRedirectUri,
  handleKakaoCallback,
  sendKakaoSession,
} from "../api/kakao-auth.mjs";

function createRequest(path = "/api/kakao-login") {
  return {
    url: path,
    headers: {
      host: "example.com",
      "x-forwarded-proto": "https",
    },
  };
}

test("getKakaoRedirectUri points at the app callback route", () => {
  assert.equal(
    getKakaoRedirectUri(createRequest()),
    "https://example.com/api/kakao-callback",
  );
});

test("buildKakaoAuthorizeUrl requests OIDC nickname scope without account_email", () => {
  process.env.KAKAO_REST_API_KEY = "test-client-id";

  const url = buildKakaoAuthorizeUrl(createRequest(), {
    state: "state-123",
  });

  assert.equal(url.origin + url.pathname, "https://kauth.kakao.com/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "test-client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://example.com/api/kakao-callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "openid profile_nickname");
  assert.equal(url.searchParams.get("state"), "state-123");
  assert.equal(url.searchParams.has("nonce"), false);
  assert.equal(url.searchParams.get("scope").includes("account_email"), false);
  assert.equal(url.searchParams.get("scope").includes("profile_image"), false);
});

test("exchangeKakaoCodeForTokenSet returns only the id token needed by Supabase", async () => {
  process.env.KAKAO_REST_API_KEY = "test-client-id";
  process.env.KAKAO_CLIENT_SECRET = "test-client-secret";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = options.body;
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("client_id"), "test-client-id");
    assert.equal(body.get("client_secret"), "test-client-secret");
    assert.equal(body.get("redirect_uri"), "https://example.com/api/kakao-callback");
    assert.equal(body.get("code"), "test-code");

    return Response.json({
      access_token: "access-token",
      id_token: "id-token",
    });
  };

  try {
    assert.deepEqual(
      await exchangeKakaoCodeForTokenSet(createRequest("/api/kakao-callback"), "test-code"),
      {
        idToken: "id-token",
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendKakaoSession returns the transient id token and clears the cookie", () => {
  const chunks = [];
  const res = {
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      chunks.push(body);
    },
  };

  sendKakaoSession({
    ...createRequest("/api/kakao-session"),
    headers: {
      ...createRequest().headers,
      cookie: "kakao_oidc_token=id-token",
    },
  }, res);

  assert.equal(res.status, 200);
  assert.match(res.headers["Set-Cookie"], /Max-Age=0/);
  assert.deepEqual(JSON.parse(chunks.join("")), { ok: true, idToken: "id-token" });
});

test("handleKakaoCallback redirects without putting provider tokens in the URL", async () => {
  process.env.KAKAO_REST_API_KEY = "test-client-id";
  process.env.KAKAO_STATE_SECRET = "state-secret";

  const loginRes = {
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end() {},
  };
  const { handleKakaoLogin } = await import("../api/kakao-auth.mjs");
  await handleKakaoLogin(createRequest("/api/kakao-login"), loginRes);

  const authorizeUrl = new URL(loginRes.headers.Location);
  const state = authorizeUrl.searchParams.get("state");
  const stateCookie = Array.isArray(loginRes.headers["Set-Cookie"])
    ? loginRes.headers["Set-Cookie"][0]
    : loginRes.headers["Set-Cookie"];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ id_token: "id-token" });

  const callbackRes = {
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end() {},
  };

  try {
    await handleKakaoCallback({
      ...createRequest(`/api/kakao-callback?code=test-code&state=${state}`),
      headers: {
        ...createRequest().headers,
        cookie: stateCookie.split(";")[0],
      },
    }, callbackRes);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(callbackRes.status, 302);
  assert.equal(new URL(callbackRes.headers.Location).hash, "");
  assert.equal(new URL(callbackRes.headers.Location).searchParams.get("kakao_login"), "1");
  assert.match(callbackRes.headers["Set-Cookie"].join("\n"), /kakao_oidc_token=/);
});
