import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const AUTHORIZATION_ENDPOINT = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_ENDPOINT = "https://api.login.yahoo.com/oauth2/get_token";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().int().positive(),
  token_type: z.string().optional(),
  xoauth_yahoo_guid: z.string().optional(),
  scope: z.string().optional(),
});

export interface YahooOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: Buffer;
  scope?: string;
}

export interface YahooTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  externalUserId?: string;
  scopes: string[];
}

function encryptionKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  return key.length === 32 ? key : null;
}

export function getYahooOAuthConfig(): YahooOAuthConfig | null {
  const clientId = process.env.YAHOO_CLIENT_ID?.trim();
  const clientSecret = process.env.YAHOO_CLIENT_SECRET?.trim();
  const redirectUri = process.env.YAHOO_REDIRECT_URI?.trim();
  const key = encryptionKey(process.env.YAHOO_TOKEN_ENCRYPTION_KEY?.trim());
  if (!clientId || !clientSecret || !redirectUri || !key) return null;

  let parsedRedirect: URL;
  try {
    parsedRedirect = new URL(redirectUri);
  } catch {
    return null;
  }
  const isLocal = parsedRedirect.hostname === "localhost" || parsedRedirect.hostname === "127.0.0.1";
  if (parsedRedirect.protocol !== "https:" && !(isLocal && parsedRedirect.protocol === "http:")) return null;

  return {
    clientId,
    clientSecret,
    redirectUri: parsedRedirect.toString(),
    encryptionKey: key,
    scope: process.env.YAHOO_OAUTH_SCOPE?.trim() || undefined,
  };
}

export function yahooIntegrationConfigured(): boolean {
  return getYahooOAuthConfig() !== null;
}

function stateMac(nonce: string, userId: string, config: YahooOAuthConfig): string {
  return createHmac("sha256", config.encryptionKey).update(`yahoo-oauth:${userId}:${nonce}`).digest("base64url");
}

export function createYahooOAuthState(userId: string, config = getYahooOAuthConfig()): string {
  if (!config) throw new Error("yahoo_oauth_unconfigured");
  const nonce = randomBytes(32).toString("base64url");
  return `${nonce}.${stateMac(nonce, userId, config)}`;
}

export function matchesYahooOAuthState(expected: string | undefined, received: string | null, userId: string, config = getYahooOAuthConfig()): boolean {
  if (!config) return false;
  if (!expected || !received || expected.length !== received.length) return false;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(received))) return false;
  const [nonce, receivedMac] = received.split(".");
  if (!nonce || !receivedMac) return false;
  const expectedMac = stateMac(nonce, userId, config);
  return expectedMac.length === receivedMac.length && timingSafeEqual(Buffer.from(expectedMac), Buffer.from(receivedMac));
}

export function buildYahooAuthorizationUrl(state: string, config = getYahooOAuthConfig()): string {
  if (!config) throw new Error("yahoo_oauth_unconfigured");
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("language", "en-us");
  if (config.scope) url.searchParams.set("scope", config.scope);
  return url.toString();
}

function basicAuthorization(config: YahooOAuthConfig): string {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
}

async function tokenRequest(body: URLSearchParams, config: YahooOAuthConfig): Promise<YahooTokenSet> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: basicAuthorization(config),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error("yahoo_token_exchange_failed");
    const parsed = tokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("yahoo_token_response_invalid");
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresAt: new Date(Date.now() + parsed.data.expires_in * 1000).toISOString(),
      externalUserId: parsed.data.xoauth_yahoo_guid,
      scopes: parsed.data.scope?.split(/\s+/).filter(Boolean) || [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function exchangeYahooAuthorizationCode(code: string): Promise<YahooTokenSet> {
  const config = getYahooOAuthConfig();
  if (!config) throw new Error("yahoo_oauth_unconfigured");
  return tokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code,
  }), config);
}

export async function refreshYahooAccessToken(refreshToken: string): Promise<YahooTokenSet> {
  const config = getYahooOAuthConfig();
  if (!config) throw new Error("yahoo_oauth_unconfigured");
  return tokenRequest(new URLSearchParams({
    grant_type: "refresh_token",
    redirect_uri: config.redirectUri,
    refresh_token: refreshToken,
  }), config);
}

export function encryptYahooToken(value: string, config = getYahooOAuthConfig()): string {
  if (!config) throw new Error("yahoo_oauth_unconfigured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptYahooToken(value: string, config = getYahooOAuthConfig()): string {
  if (!config) throw new Error("yahoo_oauth_unconfigured");
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) throw new Error("yahoo_token_ciphertext_invalid");
  try {
    const decipher = createDecipheriv("aes-256-gcm", config.encryptionKey, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("yahoo_token_decryption_failed");
  }
}
