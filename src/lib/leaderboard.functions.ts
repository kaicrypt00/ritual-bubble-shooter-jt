import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const MAX_SCORE = 5500;
const MIN_GAME_DURATION_MS = 5_000;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const USERNAME_RE = /^[A-Za-z0-9_-]+$/;

function getServerClient() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    "";
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    "";
  if (!url || !key) throw new Error("Missing Supabase URL or publishable key");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const issueGameToken = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      username: z.string().min(3).max(20).regex(USERNAME_RE),
    }).parse,
  )
  .handler(async ({ data }) => {
    const issuedAt = Date.now();
    const nonce = Math.random().toString(36).slice(2, 14);
    // No HMAC: anti-cheat downgraded to a plain timestamp envelope.
    const token = `${data.username}.${issuedAt}.${nonce}`;
    return { token, issuedAt };
  });

export const submitScoreSecure = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      username: z.string().min(3).max(20).regex(USERNAME_RE),
      score: z.number().int().min(0).max(MAX_SCORE),
      token: z.string().min(10).max(500),
    }).parse,
  )
  .handler(async ({ data }) => {
    const parts = data.token.split(".");
    if (parts.length < 3) {
      return { ok: false as const, error: "invalid token" };
    }
    const [tokenUsername, issuedAtStr] = parts;
    if (tokenUsername !== data.username) {
      return { ok: false as const, error: "username mismatch" };
    }
    const issuedAt = Number(issuedAtStr);
    if (!Number.isFinite(issuedAt)) {
      return { ok: false as const, error: "invalid timestamp" };
    }
    const elapsed = Date.now() - issuedAt;
    if (elapsed < MIN_GAME_DURATION_MS) {
      return { ok: false as const, error: "game too short" };
    }
    if (elapsed > TOKEN_TTL_MS) {
      return { ok: false as const, error: "token expired" };
    }

    const safeScore = Math.max(0, Math.min(MAX_SCORE, Math.floor(data.score)));

    const sb = getServerClient();
    const { error } = await sb.rpc("submit_score", {
      p_username: data.username,
      p_score: safeScore,
    });
    if (error) {
      return { ok: false as const, error: "submission failed" };
    }

    const { data: rows } = await sb
      .from("leaderboard")
      .select("username,score")
      .order("score", { ascending: false })
      .limit(20);
    const idx = ((rows ?? []) as Array<{ username: string; score: number }>)
      .findIndex((r) => r.username === data.username);
    return { ok: true as const, rank: idx >= 0 ? idx + 1 : null };
  });

export const reserveUsernameSecure = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      username: z.string().min(3).max(20).regex(USERNAME_RE),
    }).parse,
  )
  .handler(async ({ data }) => {
    const sb = getServerClient();
    const { data: ok, error } = await sb.rpc("reserve_username", {
      p_username: data.username,
    });
    if (error) return { ok: false as const, reason: "error" as const };
    if (ok === false) return { ok: false as const, reason: "taken" as const };
    return { ok: true as const };
  });
