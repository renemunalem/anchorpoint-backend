#!/usr/bin/env node

const baseUrl = (process.env.BASE_URL || "http://127.0.0.1:8082").replace(/\/$/, "");
const credentials = {
  email: "agent1@atlasai.local",
  password: "change_me",
};

function printStep(message) {
  console.log(`- ${message}`);
}

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

function parseCookie(setCookie) {
  if (!setCookie) {
    throw new Error("Missing Set-Cookie header");
  }

  return setCookie.split(";")[0];
}

function assertSessionCookie(setCookie, label) {
  if (/;\s*(Max-Age|Expires)=/i.test(setCookie)) {
    throw new Error(`${label}: expected browser-session cookie, got ${setCookie}`);
  }
}

function assertPersistentCookie(setCookie, label) {
  if (!/;\s*(Max-Age|Expires)=/i.test(setCookie)) {
    throw new Error(`${label}: expected persistent cookie, got ${setCookie}`);
  }
}

async function expectStatus(response, expected, label) {
  if (response.status !== expected) {
    const body = await response.text();
    throw new Error(`${label}: expected ${expected}, got ${response.status}. Body: ${body}`);
  }
}

async function expectErrorCode(response, expectedCode, label) {
  const body = await response.json();
  if (body?.error?.code !== expectedCode) {
    throw new Error(`${label}: expected ${expectedCode}, got ${JSON.stringify(body)}`);
  }

  return body;
}

async function main() {
  printStep(`Verifying auth flow against ${baseUrl}`);

  const badLoginResponse = await request("/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: credentials.email, password: "wrong" }),
  });
  await expectStatus(badLoginResponse, 401, "bad login");
  const badLoginJson = await expectErrorCode(
    badLoginResponse,
    "AUTH_INVALID_CREDENTIALS",
    "bad login",
  );
  if (typeof badLoginJson.error.details?.remainingAttempts !== "number") {
    throw new Error(`bad login: missing rate-limit details ${JSON.stringify(badLoginJson)}`);
  }
  printStep("Auth error code PASS for bad login");

  const lockoutEmail = `lockout-${Date.now()}@atlasai.local`;
  for (let index = 0; index < 4; index += 1) {
    const response = await request("/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: lockoutEmail, password: "wrong" }),
    });
    await expectStatus(response, 401, `lockout warmup ${index + 1}`);
    await expectErrorCode(response, "AUTH_INVALID_CREDENTIALS", `lockout warmup ${index + 1}`);
  }

  const lockedResponse = await request("/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: lockoutEmail, password: "wrong" }),
  });
  await expectStatus(lockedResponse, 429, "lockout threshold");
  const lockedJson = await expectErrorCode(lockedResponse, "AUTH_ACCOUNT_LOCKED", "lockout threshold");
  if (typeof lockedJson.error.details?.retryAfterSeconds !== "number") {
    throw new Error(`lockout threshold: missing retry details ${JSON.stringify(lockedJson)}`);
  }
  printStep("Auth lockout PASS");

  const loggedOutSessionResponse = await request("/v1/auth/session");
  await expectStatus(loggedOutSessionResponse, 401, "logged out session");
  await expectErrorCode(loggedOutSessionResponse, "AUTH_SESSION_REQUIRED", "logged out session");
  printStep("Auth error code PASS for logged-out session");

  const resetResponse = await request("/v1/auth/password-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: credentials.email }),
  });
  await expectStatus(resetResponse, 202, "password reset request");
  const resetJson = await resetResponse.json();
  if (!resetJson?.ok) {
    throw new Error(`password reset request: missing ok response ${JSON.stringify(resetJson)}`);
  }
  printStep("Password reset request PASS");

  const invalidResetResponse = await request("/v1/auth/password-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "not-an-email" }),
  });
  await expectStatus(invalidResetResponse, 400, "invalid password reset request");
  await expectErrorCode(invalidResetResponse, "AUTH_INVALID_REQUEST", "invalid password reset request");
  printStep("Auth error code PASS for invalid reset request");

  const loginResponse = await request("/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  await expectStatus(loginResponse, 200, "login");
  const loginJson = await loginResponse.json();
  const loginSetCookie = loginResponse.headers.get("set-cookie");
  assertSessionCookie(loginSetCookie, "login");
  const sessionCookie = parseCookie(loginSetCookie);

  if (!loginJson?.user || !loginJson?.sessionId || loginJson.persistent !== false) {
    throw new Error(`login: missing user/sessionId in response ${JSON.stringify(loginJson)}`);
  }
  printStep(`Login PASS (${loginJson.user.email}, session cookie)`);

  const sessionResponse = await request("/v1/auth/session", {
    headers: { Cookie: sessionCookie },
  });
  await expectStatus(sessionResponse, 200, "session after login");
  printStep("Session PASS after login");

  const casesResponse = await request("/v1/cases", {
    headers: { Cookie: sessionCookie },
  });
  await expectStatus(casesResponse, 200, "cases with session");
  printStep("Cases PASS with session cookie");

  const logoutResponse = await request("/v1/auth/logout", {
    method: "POST",
    headers: { Cookie: sessionCookie },
  });
  await expectStatus(logoutResponse, 200, "logout");
  printStep("Logout PASS");

  const persistentLoginResponse = await request("/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...credentials, keepMeLoggedIn: true }),
  });
  await expectStatus(persistentLoginResponse, 200, "persistent login");
  const persistentLoginJson = await persistentLoginResponse.json();
  const persistentSetCookie = persistentLoginResponse.headers.get("set-cookie");
  assertPersistentCookie(persistentSetCookie, "persistent login");
  const persistentCookie = parseCookie(persistentSetCookie);
  if (!persistentLoginJson?.user || persistentLoginJson.persistent !== true) {
    throw new Error(`persistent login: missing persistent response ${JSON.stringify(persistentLoginJson)}`);
  }
  printStep("Persistent login PASS");

  const persistentLogoutResponse = await request("/v1/auth/logout", {
    method: "POST",
    headers: { Cookie: persistentCookie },
  });
  await expectStatus(persistentLogoutResponse, 200, "persistent logout");
  printStep("Persistent logout PASS");

  const postLogoutSessionResponse = await request("/v1/auth/session", {
    headers: { Cookie: sessionCookie },
  });
  await expectStatus(postLogoutSessionResponse, 401, "session after logout");
  printStep("Session PASS after logout (401)");

  console.log("VERIFY AUTH PASS");
  process.exit(0);
}

main().catch((error) => {
  console.error("VERIFY AUTH FAIL");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
