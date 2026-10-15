-- Existing account sessions remain valid; a later Google sign-in supplies the avatar.
ALTER TABLE users ADD COLUMN picture TEXT;
