-- Temporary provider copies only. Owner-confirmed trip records remain in user_state,
-- are never consulted by lookup, and are deleted when their owner removes them.
CREATE TABLE IF NOT EXISTS flight_cache (
  cache_key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  retain_until INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS flight_cache_retention ON flight_cache(retain_until);

-- Airport responses are reduced to an IANA zone; no complete provider responses.
CREATE TABLE IF NOT EXISTS flight_airport_cache (
  airport_code TEXT PRIMARY KEY,
  time_zone TEXT NOT NULL,
  retain_until INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS flight_airport_cache_retention ON flight_airport_cache(retain_until);

-- Counts are reserved atomically before any provider request. They contain no
-- flight number, route, dates, provider key, or other itinerary information.
CREATE TABLE IF NOT EXISTS flight_usage (
  principal TEXT NOT NULL,
  bucket TEXT NOT NULL,
  requests INTEGER NOT NULL CHECK (requests >= 0),
  retain_until INTEGER NOT NULL,
  PRIMARY KEY (principal, bucket)
);
CREATE INDEX IF NOT EXISTS flight_usage_retention ON flight_usage(retain_until);
