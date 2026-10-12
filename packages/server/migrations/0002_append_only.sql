-- Append-only tables (ADR-021): revisions, their tags and publications are written once.
-- Written by hand: drizzle-kit does not model triggers (it never drops them on `generate`), but a
-- later migration that rebuilds one of these tables drops its triggers with the old table, so it
-- must create them again. The test append-only.workerd.test.ts lists them after every migration.
--
-- Three triggers per table:
--   *_no_delete      a row is never deleted;
--   *_immutable      the columns that make a row what it is never change; only the columns
--                    `hollware reparse` derives again may (and `updated_at`);
--   *_no_replace     an INSERT whose unique key is taken aborts. INSERT OR REPLACE deletes the
--                    row it replaces without firing DELETE triggers (recursive_triggers is off),
--                    so without it a revision could be overwritten.
-- Every message starts with "append-only:", which is what the repository code matches.

CREATE TRIGGER `revisions_no_delete`
BEFORE DELETE ON `revisions`
BEGIN
	SELECT RAISE(ABORT, 'append-only: a revision is never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `revisions_immutable`
BEFORE UPDATE OF `id`, `site_id`, `entry_id`, `markdown`, `verdict`, `actor_kind`, `actor_user_id`, `actor_token_id`, `actor_meta`, `created_at` ON `revisions`
BEGIN
	SELECT RAISE(ABORT, 'append-only: only the derived columns of a revision change');
END;
--> statement-breakpoint
CREATE TRIGGER `revisions_no_replace`
BEFORE INSERT ON `revisions`
WHEN EXISTS (SELECT 1 FROM `revisions` WHERE `id` = NEW.`id`)
BEGIN
	SELECT RAISE(ABORT, 'append-only: a revision with this id already exists');
END;
--> statement-breakpoint
CREATE TRIGGER `revision_tags_no_delete`
BEFORE DELETE ON `revision_tags`
BEGIN
	SELECT RAISE(ABORT, 'append-only: a revision tag is never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `revision_tags_immutable`
BEFORE UPDATE OF `id`, `site_id`, `revision_id`, `tag`, `created_at` ON `revision_tags`
BEGIN
	SELECT RAISE(ABORT, 'append-only: a revision tag never changes');
END;
--> statement-breakpoint
CREATE TRIGGER `revision_tags_no_replace`
BEFORE INSERT ON `revision_tags`
WHEN EXISTS (SELECT 1 FROM `revision_tags` WHERE `id` = NEW.`id` OR (`revision_id` = NEW.`revision_id` AND `tag` = NEW.`tag`))
BEGIN
	SELECT RAISE(ABORT, 'append-only: this revision already has this tag');
END;
--> statement-breakpoint
CREATE TRIGGER `publications_no_delete`
BEFORE DELETE ON `publications`
BEGIN
	SELECT RAISE(ABORT, 'append-only: a publication is never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `publications_immutable`
BEFORE UPDATE OF `id`, `site_id`, `entry_id`, `action`, `revision_id`, `verdict`, `acknowledged`, `actor_kind`, `actor_user_id`, `actor_token_id`, `actor_meta`, `created_at` ON `publications`
BEGIN
	SELECT RAISE(ABORT, 'append-only: a publication never changes');
END;
--> statement-breakpoint
CREATE TRIGGER `publications_no_replace`
BEFORE INSERT ON `publications`
WHEN EXISTS (SELECT 1 FROM `publications` WHERE `id` = NEW.`id`)
BEGIN
	SELECT RAISE(ABORT, 'append-only: a publication with this id already exists');
END;
