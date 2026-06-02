CREATE TABLE IF NOT EXISTS public.leaderboard (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  score integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leaderboard_score_idx ON public.leaderboard (score DESC);

GRANT SELECT ON public.leaderboard TO anon, authenticated;
GRANT ALL ON public.leaderboard TO service_role;

ALTER TABLE public.leaderboard ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leaderboard is public readable" ON public.leaderboard;
CREATE POLICY "Leaderboard is public readable"
  ON public.leaderboard
  FOR SELECT
  USING (true);

ALTER TABLE public.leaderboard DROP CONSTRAINT IF EXISTS leaderboard_score_cap;
ALTER TABLE public.leaderboard ADD CONSTRAINT leaderboard_score_cap CHECK (score >= 0 AND score <= 5500);

ALTER TABLE public.leaderboard DROP CONSTRAINT IF EXISTS leaderboard_username_format;
ALTER TABLE public.leaderboard ADD CONSTRAINT leaderboard_username_format CHECK (length(username) >= 3 AND length(username) <= 20 AND username ~ '^[A-Za-z0-9_-]+$');

CREATE OR REPLACE FUNCTION public.reserve_username(p_username text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_username IS NULL OR length(trim(p_username)) < 3 OR length(p_username) > 20 THEN
    RETURN false;
  END IF;
  IF p_username !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN false;
  END IF;

  INSERT INTO public.leaderboard (username, score)
  VALUES (p_username, 0)
  ON CONFLICT (username) DO NOTHING;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_score(p_username text, p_score integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_username IS NULL OR length(trim(p_username)) < 3 OR length(p_username) > 20 THEN
    RETURN;
  END IF;
  IF p_username !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN;
  END IF;
  IF p_score IS NULL OR p_score < 0 OR p_score > 5500 THEN
    RETURN;
  END IF;

  INSERT INTO public.leaderboard (username, score)
  VALUES (p_username, p_score)
  ON CONFLICT (username)
  DO UPDATE SET
    score = GREATEST(public.leaderboard.score, EXCLUDED.score),
    updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_username(text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.submit_score(text, integer) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.submit_score(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_username(text) TO anon, authenticated;