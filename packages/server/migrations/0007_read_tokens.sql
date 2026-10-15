-- Edited by hand (ADR-023). Read tokens (v0.4): a token is personal (hw_pat_) or a read token (hw_read_), which reads the
-- published content of its site over the read API and nothing else. Every token so far is
-- personal. The CHECK is the column's own, so the table is not rebuilt.
ALTER TABLE `tokens` ADD `kind` text DEFAULT 'personal' NOT NULL CHECK (`kind` IN ('personal', 'read'));
