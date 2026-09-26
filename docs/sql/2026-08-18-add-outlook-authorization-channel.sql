-- Record preferred/most recently successful email authorization channels for Outlook OAuth accounts.
-- A null value indicates that the history is unknown or cleared by the user actively; no backfilling is performed based on old credentials.

ALTER TABLE accounts
    ADD COLUMN authorization_type TEXT NOT NULL DEFAULT '';
