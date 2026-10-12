-- Custom migration (drizzle-kit generate --custom): append-only revisions.
-- drizzle-kit knows nothing about triggers, so they live in a hand-written migration.
-- A later migration that makes drizzle-kit rebuild `revisions` (CREATE TABLE __new_revisions,
-- DROP TABLE revisions, RENAME) drops these triggers with the old table: it must create them again.
CREATE TRIGGER `revisions_no_delete`
BEFORE DELETE ON `revisions`
BEGIN
	SELECT RAISE(ABORT, 'revisions are append-only: DELETE is not allowed');
END;
--> statement-breakpoint
CREATE TRIGGER `revisions_immutable_columns`
BEFORE UPDATE OF `id`, `entry_id`, `markdown`, `created_at` ON `revisions`
BEGIN
	SELECT RAISE(ABORT, 'revisions are append-only: id, entry_id, markdown and created_at are immutable');
END;
--> statement-breakpoint
-- INSERT OR REPLACE deletes the row it replaces without firing DELETE triggers (SQLite fires
-- them for REPLACE only under PRAGMA recursive_triggers, which is off), so a third trigger
-- refuses any INSERT whose id is already taken.
CREATE TRIGGER `revisions_no_replace`
BEFORE INSERT ON `revisions`
WHEN EXISTS (SELECT 1 FROM `revisions` WHERE `id` = NEW.`id`)
BEGIN
	SELECT RAISE(ABORT, 'revisions are append-only: a revision with this id already exists');
END;
