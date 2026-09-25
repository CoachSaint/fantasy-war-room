import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../src/app/auth/confirm/route";

const authMock = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: authMock.createServerClient,
}));

const tokenHash = "a".repeat(64);

afterEach(() => {
  authMock.verifyOtp.mockReset();
  authMock.createServerClient.mockReset();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_APP_URL;
});

describe("emailed sign-in confirmation", () => {
  it("rejects missing and unsupported tokens before contacting Supabase", async () => {
    const missing = await GET(new NextRequest("https://fantasy-war-room-pi.vercel.app/auth/confirm"));
    const unsupported = await GET(new NextRequest(`https://fantasy-war-room-pi.vercel.app/auth/confirm?token_hash=${tokenHash}&type=recovery`));
    expect(missing.headers.get("location")).toBe("https://fantasy-war-room-pi.vercel.app/auth");
    expect(unsupported.headers.get("location")).toBe("https://fantasy-war-room-pi.vercel.app/auth");
    expect(authMock.createServerClient).not.toHaveBeenCalled();
  });

  it("writes the verified session cookie before redirecting to password setup", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public-key";
    process.env.NEXT_PUBLIC_APP_URL = "https://fantasy-war-room-pi.vercel.app";
    authMock.verifyOtp.mockResolvedValue({ error: null });
    authMock.createServerClient.mockImplementation((_url, _key, options) => {
      options.cookies.setAll([{ name: "sb-test-auth-token", value: "session", options: { httpOnly: true } }]);
      return { auth: { verifyOtp: authMock.verifyOtp } };
    });

    const response = await GET(new NextRequest(`https://fantasy-war-room-pi.vercel.app/auth/confirm?token_hash=${tokenHash}&type=invite`));
    expect(authMock.verifyOtp).toHaveBeenCalledWith({ token_hash: tokenHash, type: "invite" });
    expect(response.headers.get("location")).toBe("https://fantasy-war-room-pi.vercel.app/auth");
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("session");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("does not retain a session when verification fails", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public-key";
    authMock.verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    authMock.createServerClient.mockReturnValue({ auth: { verifyOtp: authMock.verifyOtp } });

    const response = await GET(new NextRequest(`https://fantasy-war-room-pi.vercel.app/auth/confirm?token_hash=${tokenHash}&type=invite`));
    expect(response.headers.get("location")).toBe("https://fantasy-war-room-pi.vercel.app/auth");
    expect(response.cookies.getAll()).toHaveLength(0);
  });
});
