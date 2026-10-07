\set ON_ERROR_STOP on

SELECT CASE WHEN count(*) = 1 THEN 'true' ELSE 'false' END AS user_ok
FROM users
WHERE email = :'loadtest_email'
  AND is_demo = false
  AND email <> :'demo_email'
  AND email <> :'status_email'
\gset
\if :user_ok
\else
  \echo 'Refusing seed: dedicated load-test user is missing, duplicated, demo, or status owner'
  \quit 3
\endif

SELECT CASE WHEN count(*) = 0 THEN 'true' ELSE 'false' END AS workload_empty
FROM monitor m
JOIN users u ON u.id = m.user_id
WHERE u.email = :'loadtest_email'
\gset
\if :workload_empty
\else
  \echo 'Refusing seed: the dedicated load-test user already has monitors; use a fresh sentinel-load project'
  \quit 3
\endif

BEGIN;

UPDATE monitor
SET state = 'Paused'
WHERE user_id IN (
  SELECT id FROM users WHERE email IN (:'demo_email', :'status_email')
);

INSERT INTO monitor (
  name,
  target,
  frequency,
  state,
  created_at,
  check_type,
  check_config,
  last_state,
  last_checked_at,
  consecutive_failures,
  user_id,
  seed_key,
  is_public
)
SELECT
  'Load test monitor ' || to_char(generated.number, 'FM00000'),
  'http://198.51.100.10:8080/ok?i=' || generated.number,
  60,
  'Active',
  now() AT TIME ZONE 'UTC',
  'http',
  '{}'::json,
  NULL,
  NULL,
  0,
  users.id,
  NULL,
  false
FROM users
CROSS JOIN generate_series(1, 5000) AS generated(number)
WHERE users.email = :'loadtest_email';

SELECT CASE WHEN count(*) = 5000 THEN 'true' ELSE 'false' END AS exact_seeded_count,
       CASE WHEN count(*) FILTER (WHERE last_checked_at IS NULL) = 5000 THEN 'true' ELSE 'false' END AS exact_unchecked_count
FROM monitor
WHERE user_id = (SELECT id FROM users WHERE email = :'loadtest_email');
\gset
\if :exact_seeded_count
\else
  \echo 'Refusing to continue: expected exactly 5,000 seeded monitors'
  ROLLBACK;
  \quit 3
\endif
\if :exact_unchecked_count
\else
  \echo 'Refusing to continue: expected all 5,000 seeded monitors to be unchecked'
  ROLLBACK;
  \quit 3
\endif

SELECT CASE WHEN count(*) = 0 THEN 'true' ELSE 'false' END AS no_unrelated_active
FROM monitor m
JOIN users u ON u.id = m.user_id
WHERE m.state = 'Active' AND u.email <> :'loadtest_email'
\gset
\if :no_unrelated_active
\else
  \echo 'Refusing to continue: unrelated active monitors would be polled by the worker'
  ROLLBACK;
  \quit 3
\endif

COMMIT;
