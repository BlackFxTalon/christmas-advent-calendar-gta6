-- Manual RLS role test for Supabase SQL Editor or psql.
-- Run as the postgres/table-owner role after 002_bot_rls.sql and 003_bot_app_role.sql.
-- Temporary grants and test rows are enclosed in one transaction and rolled back at the end.
-- If the script stops on an error, run ROLLBACK in the same SQL session before doing anything else.

BEGIN;

DO $preflight$
DECLARE
  players_rls boolean;
  progress_rls boolean;
BEGIN
  SELECT c.relrowsecurity
    INTO players_rls
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'bot_players' AND c.relkind = 'r';

  SELECT c.relrowsecurity
    INTO progress_rls
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'bot_case_progress' AND c.relkind = 'r';

  IF players_rls IS DISTINCT FROM true OR progress_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: RLS must be enabled on both bot tables before testing.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'bot_app') THEN
    RAISE EXCEPTION 'FAIL: role bot_app does not exist; apply 003_bot_app_role.sql first.';
  END IF;

  IF has_table_privilege('anon', 'public.bot_players', 'SELECT')
     OR has_table_privilege('anon', 'public.bot_case_progress', 'SELECT')
     OR has_table_privilege('authenticated', 'public.bot_players', 'SELECT')
     OR has_table_privilege('authenticated', 'public.bot_case_progress', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon/authenticated still have SELECT grants before the temporary test grants.';
  END IF;

  RAISE NOTICE 'PASS: RLS enabled; API roles have no SELECT grants; bot_app exists.';
END
$preflight$;

-- These fixture rows and temporary grants exist only inside this transaction.
INSERT INTO public.bot_players (telegram_user_id)
VALUES (9223372036854770000);

INSERT INTO public.bot_case_progress
  (telegram_user_id, case_id, status, attempts_count, hints_used, started_at, completed_at, updated_at)
VALUES
  (9223372036854770000, 12, 'in_progress', 7, 2, NOW(), NULL, NOW());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.bot_players, public.bot_case_progress
  TO anon, authenticated;

SET LOCAL ROLE anon;
DO $anon_test$
DECLARE
  visible_rows bigint;
  affected_rows bigint;
BEGIN
  SELECT count(*) INTO visible_rows
    FROM public.bot_players
   WHERE telegram_user_id = 9223372036854770000;
  IF visible_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: anon can see a fixture row.';
  END IF;

  BEGIN
    INSERT INTO public.bot_players (telegram_user_id)
    VALUES (9223372036854770002);
    RAISE EXCEPTION 'FAIL: anon INSERT unexpectedly succeeded.';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: anon INSERT is denied by RLS.';
  END;

  UPDATE public.bot_case_progress
     SET attempts_count = 99
   WHERE telegram_user_id = 9223372036854770000 AND case_id = 12;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: anon UPDATE unexpectedly changed a row.';
  END IF;

  DELETE FROM public.bot_case_progress
   WHERE telegram_user_id = 9223372036854770000 AND case_id = 12;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: anon DELETE unexpectedly changed a row.';
  END IF;

  RAISE NOTICE 'PASS: anon cannot SELECT, UPDATE, or DELETE bot progress.';
END
$anon_test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $authenticated_test$
DECLARE
  visible_rows bigint;
  affected_rows bigint;
BEGIN
  SELECT count(*) INTO visible_rows
    FROM public.bot_players
   WHERE telegram_user_id = 9223372036854770000;
  IF visible_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: authenticated can see a fixture row.';
  END IF;

  BEGIN
    INSERT INTO public.bot_players (telegram_user_id)
    VALUES (9223372036854770003);
    RAISE EXCEPTION 'FAIL: authenticated INSERT unexpectedly succeeded.';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: authenticated INSERT is denied by RLS.';
  END;

  UPDATE public.bot_case_progress
     SET attempts_count = 99
   WHERE telegram_user_id = 9223372036854770000 AND case_id = 12;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: authenticated UPDATE unexpectedly changed a row.';
  END IF;

  DELETE FROM public.bot_case_progress
   WHERE telegram_user_id = 9223372036854770000 AND case_id = 12;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: authenticated DELETE unexpectedly changed a row.';
  END IF;

  RAISE NOTICE 'PASS: authenticated cannot SELECT, UPDATE, or DELETE bot progress.';
END
$authenticated_test$;
RESET ROLE;

SET LOCAL ROLE bot_app;
DO $bot_app_test$
DECLARE
  visible_rows bigint;
  returned_id bigint;
  returned_case smallint;
  affected_rows bigint;
BEGIN
  SELECT count(*) INTO visible_rows
    FROM public.bot_players
   WHERE telegram_user_id = 9223372036854770000;
  IF visible_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL: bot_app cannot SELECT the fixture row.';
  END IF;

  INSERT INTO public.bot_players (telegram_user_id)
  VALUES (9223372036854770001)
  ON CONFLICT (telegram_user_id)
  DO UPDATE SET updated_at = NOW()
  RETURNING telegram_user_id INTO returned_id;
  IF returned_id <> 9223372036854770001 THEN
    RAISE EXCEPTION 'FAIL: bot_app player INSERT/UPSERT did not return the expected row.';
  END IF;

  INSERT INTO public.bot_case_progress
    (telegram_user_id, case_id, status, attempts_count, hints_used, started_at, completed_at, updated_at)
  VALUES
    (9223372036854770001, 12, 'in_progress', 0, 0, NOW(), NULL, NOW())
  ON CONFLICT (telegram_user_id, case_id)
  DO UPDATE SET attempts_count = bot_case_progress.attempts_count + 1
  RETURNING case_id INTO returned_case;
  IF returned_case <> 12 THEN
    RAISE EXCEPTION 'FAIL: bot_app progress INSERT/UPSERT did not return the expected row.';
  END IF;

  UPDATE public.bot_case_progress
     SET attempts_count = attempts_count + 1
   WHERE telegram_user_id = 9223372036854770001 AND case_id = 12;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL: bot_app UPDATE did not affect exactly one row.';
  END IF;

  BEGIN
    DELETE FROM public.bot_case_progress
     WHERE telegram_user_id = 9223372036854770001 AND case_id = 12;
    RAISE EXCEPTION 'FAIL: bot_app DELETE unexpectedly succeeded.';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: bot_app DELETE is denied by its table grants.';
  END;

  RAISE NOTICE 'PASS: bot_app can SELECT, INSERT/UPSERT, and UPDATE progress.';
END
$bot_app_test$;
RESET ROLE;

ROLLBACK;
