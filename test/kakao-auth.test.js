import test from "node:test";
import assert from "node:assert/strict";

import {
  buildKakaoAuthorizeUrl,
  exchangeKakaoCodeForTokenSet,
  getKakaoRedirectUri,
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

test("buildKakaoAuthorizeUrl requests OIDC profile scopes without account_email", () => {
  process.env.KAKAO_REST_API_KEY = "test-client-id";

  const url = buildKakaoAuthorizeUrl(createRequest(), {
    state: "state-123",
    nonce: "nonce-456",
  });

  assert.equal(url.origin + url.pathname, "https://kauth.kakao.com/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "test-client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://example.com/api/kakao-callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "openid profile_nickname profile_image");
  assert.equal(url.searchParams.get("state"), "state-123");
  assert.equal(url.searchParams.get("nonce"), "nonce-456");
  assert.equal(url.searchParams.get("scope").includes("account_email"), false);
});

test("exchangeKakaoCodeForTokenSet returns both id token and access token", async () => {
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
        accessToken: "access-token",
        idToken: "id-token",
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
