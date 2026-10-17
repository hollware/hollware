-- Written by hand (ADR-023): the history of the structure of the sites (`site_changes`, ADR-033)
-- is append-only, as revisions and publications are (ADR-021), so it is the record of who changed
-- what (T-83 of docs/security/threat-model.md). drizzle-kit does not model triggers; the test
-- append-only.workerd.test.ts lists them after every migration.
--
-- Two of the three triggers of 0002: a line is never deleted, and never changed. There is no
-- `_no_replace` on the unique (site_id, version): a write that lost a race to the same version in
-- the same millisecond adds its line with INSERT OR IGNORE, which such a trigger would abort
-- instead of ignoring; the one on the id still stops INSERT OR REPLACE of a line by its id.

CREATE TRIGGER `site_changes_no_delete`
BEFORE DELETE ON `site_changes`
BEGIN
	SELECT RAISE(ABORT, 'append-only: a change of the structure is never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `site_changes_immutable`
BEFORE UPDATE ON `site_changes`
BEGIN
	SELECT RAISE(ABORT, 'append-only: a change of the structure never changes');
END;
--> statement-breakpoint
CREATE TRIGGER `site_changes_no_replace`
BEFORE INSERT ON `site_changes`
WHEN EXISTS (SELECT 1 FROM `site_changes` WHERE `id` = NEW.`id`)
BEGIN
	SELECT RAISE(ABORT, 'append-only: a change of the structure is written once');
END;
