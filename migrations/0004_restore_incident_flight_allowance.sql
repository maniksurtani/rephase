-- One-time recovery for account budgets initialized while redirect:'error'
-- prevented provider I/O. That Worker was replaced on 2026-10-15 at 06:41 UTC.
-- Legacy retain_until records the first reservation plus 40 days; conflict
-- updates did not change it. Accounts first used after the repair are excluded.
-- Actual chargeability of later attempts is unknown, so preserve the complete
-- global counter and its provider-spend cap. Never reset trips or provider data.
UPDATE flight_usage
SET requests = 0
WHERE principal LIKE 'user:%'
  AND bucket IN ('day:2026-10-15', 'month:2026-10')
  AND retain_until <= CAST(strftime('%s', '2026-10-15T06:41:31Z') AS INTEGER) + 40 * 86400;
