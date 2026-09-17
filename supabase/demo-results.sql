-- Demo only. Apply after phase3.sql. Does not modify rooms or wake_checks.
BEGIN;
CREATE TABLE IF NOT EXISTS public.wp_demo_rounds (
  room_id text PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  round integer NOT NULL DEFAULT 1 CHECK (round > 0)
);
CREATE TABLE IF NOT EXISTS public.wp_demo_answers (
  room_id text NOT NULL REFERENCES public.wp_demo_rounds(room_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id),
  success boolean NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (room_id, user_id)
);
ALTER TABLE public.wp_demo_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wp_demo_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wp_demo_rounds, public.wp_demo_answers FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.wp_demo_room(p_room_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.rooms; current_round integer; total integer; answered integer;
  winners integer; pool integer; first_winner text; complete boolean; people jsonb;
BEGIN
  PERFORM public.wp_current_user();
  SELECT * INTO target FROM public.rooms WHERE room_code = upper(btrim(p_room_code)) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WP_ROOM_NOT_FOUND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.room_members WHERE room_id = target.id AND user_id = auth.uid()::text)
    THEN RAISE EXCEPTION 'WP_NOT_MEMBER'; END IF;
  IF target.status NOT IN ('active', 'finished') THEN RAISE EXCEPTION 'WP_DEMO_NOT_STARTED'; END IF;
  IF target.challenge_amount IS NULL OR target.challenge_amount NOT BETWEEN 100 AND 2000
    THEN RAISE EXCEPTION 'WP_CONDITIONS_MISSING'; END IF;
  SELECT coalesce((SELECT round FROM public.wp_demo_rounds WHERE room_id = target.id), 1) INTO current_round;
  SELECT count(*), count(a.user_id), count(*) FILTER (WHERE a.success)
    INTO total, answered, winners FROM public.room_members m
    LEFT JOIN public.wp_demo_answers a ON a.room_id = m.room_id AND a.user_id = m.user_id
    WHERE m.room_id = target.id;
  complete := total > 0 AND answered = total;
  pool := (answered - winners) * target.challenge_amount;
  SELECT a.user_id INTO first_winner FROM public.wp_demo_answers a
    JOIN public.room_members m ON m.room_id = a.room_id AND m.user_id = a.user_id
    WHERE a.room_id = target.id AND a.success ORDER BY a.submitted_at, a.user_id LIMIT 1;
  SELECT jsonb_agg(jsonb_build_object(
    'user_id', m.user_id, 'nickname', u.nickname, 'icon', u.icon,
    'success', a.success,
    'delta', CASE WHEN NOT complete THEN NULL WHEN NOT a.success THEN -target.challenge_amount
      ELSE pool / greatest(winners, 1) + CASE WHEN a.user_id = first_winner THEN pool % greatest(winners, 1) ELSE 0 END END
    ) ORDER BY m.joined_at, m.id) INTO people
    FROM public.room_members m JOIN public.users u ON u.id = m.user_id
    LEFT JOIN public.wp_demo_answers a ON a.room_id = m.room_id AND a.user_id = m.user_id
    WHERE m.room_id = target.id;
  RETURN jsonb_build_object('round', current_round, 'user_id', auth.uid()::text,
    'can_reset', target.creator_id = auth.uid()::text, 'complete', complete,
    'answered', answered, 'total', total, 'amount', target.challenge_amount,
    'pool', CASE WHEN complete THEN pool ELSE NULL END,
    'success_count', winners, 'members', coalesce(people, '[]'::jsonb));
END; $$;

CREATE OR REPLACE FUNCTION public.wp_demo_submit(p_room_code text, p_round integer, p_success boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.rooms; current_round integer; previous boolean;
BEGIN
  PERFORM public.wp_current_user();
  SELECT * INTO target FROM public.rooms WHERE room_code = upper(btrim(p_room_code)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WP_ROOM_NOT_FOUND'; END IF;
  -- Validates membership and eligibility before any write; uses the same room lock.
  PERFORM public.wp_demo_room(p_room_code);
  IF p_round IS NULL OR p_round < 1 OR p_success IS NULL THEN RAISE EXCEPTION 'WP_INVALID_INPUT'; END IF;
  INSERT INTO public.wp_demo_rounds(room_id) VALUES (target.id) ON CONFLICT DO NOTHING;
  SELECT round INTO current_round FROM public.wp_demo_rounds WHERE room_id = target.id;
  IF p_round <> current_round THEN RAISE EXCEPTION 'WP_DEMO_STALE'; END IF;
  SELECT success INTO previous FROM public.wp_demo_answers WHERE room_id = target.id AND user_id = auth.uid()::text;
  IF FOUND THEN
    IF previous IS DISTINCT FROM p_success THEN RAISE EXCEPTION 'WP_DEMO_ALREADY_ANSWERED'; END IF;
  ELSE
    INSERT INTO public.wp_demo_answers(room_id, user_id, success) VALUES (target.id, auth.uid()::text, p_success);
  END IF;
  RETURN public.wp_demo_room(p_room_code);
END; $$;

CREATE OR REPLACE FUNCTION public.wp_demo_reset(p_room_code text, p_round integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.rooms; current_round integer;
BEGIN
  PERFORM public.wp_current_user();
  SELECT * INTO target FROM public.rooms WHERE room_code = upper(btrim(p_room_code)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WP_ROOM_NOT_FOUND'; END IF;
  PERFORM public.wp_demo_room(p_room_code);
  IF target.creator_id IS DISTINCT FROM auth.uid()::text THEN RAISE EXCEPTION 'WP_DEMO_OWNER_ONLY'; END IF;
  IF p_round IS NULL OR p_round < 1 THEN RAISE EXCEPTION 'WP_INVALID_INPUT'; END IF;
  INSERT INTO public.wp_demo_rounds(room_id) VALUES (target.id) ON CONFLICT DO NOTHING;
  SELECT round INTO current_round FROM public.wp_demo_rounds WHERE room_id = target.id;
  IF p_round <> current_round THEN RAISE EXCEPTION 'WP_DEMO_STALE'; END IF;
  DELETE FROM public.wp_demo_answers WHERE room_id = target.id;
  UPDATE public.wp_demo_rounds SET round = round + 1 WHERE room_id = target.id;
  RETURN public.wp_demo_room(p_room_code);
END; $$;
REVOKE ALL ON FUNCTION public.wp_demo_room(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wp_demo_submit(text, integer, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wp_demo_reset(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wp_demo_room(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wp_demo_submit(text, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wp_demo_reset(text, integer) TO authenticated;
COMMIT;