-- Written by hand (ADR-023), as drizzle-kit has no virtual tables. Full-text search (v0.5): an
-- FTS5 index of the published revision of each entry, its title, its tags and its text. The text
-- is taken from the stored Comark document, the strings at the text positions of its nodes, so
-- the Markdown's own marks are never indexed. `unicode61 remove_diacritics 2` matches
-- "migracion" with "migración".
--
-- The triggers keep it in the step that changes what is published, whichever write does it:
-- publish, a group, a schedule that comes due, unpublish. Only published content is in it.
CREATE VIRTUAL TABLE `entries_fts` USING fts5(
	`title`,
	`tags`,
	`body`,
	`entry_id` UNINDEXED,
	`site_id` UNINDEXED,
	`collection` UNINDEXED,
	`locale` UNINDEXED,
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `entries_fts_publication` AFTER UPDATE OF `published_rev` ON `entries`
BEGIN
	DELETE FROM `entries_fts` WHERE `entry_id` = OLD.`id`;
	INSERT INTO `entries_fts` (`title`, `tags`, `body`, `entry_id`, `site_id`, `collection`, `locale`)
	SELECT
		coalesce(json_extract(r.`frontmatter`, '$.title'), ''),
		coalesce((SELECT group_concat(t.`tag`, ' ') FROM `revision_tags` t WHERE t.`revision_id` = r.`id`), ''),
		coalesce((SELECT group_concat(n.`value`, ' ') FROM json_tree(r.`document`, '$.nodes') n
			WHERE n.`type` = 'text' AND typeof(n.`key`) = 'integer' AND n.`key` >= 2), ''),
		NEW.`id`, NEW.`site_id`, NEW.`collection`, NEW.`locale`
	FROM `revisions` r
	WHERE NEW.`published_rev` IS NOT NULL AND r.`id` = NEW.`published_rev`;
END;
--> statement-breakpoint
CREATE TRIGGER `entries_fts_removal` AFTER DELETE ON `entries`
BEGIN
	DELETE FROM `entries_fts` WHERE `entry_id` = OLD.`id`;
END;
--> statement-breakpoint
-- What is published already.
INSERT INTO `entries_fts` (`title`, `tags`, `body`, `entry_id`, `site_id`, `collection`, `locale`)
SELECT
	coalesce(json_extract(r.`frontmatter`, '$.title'), ''),
	coalesce((SELECT group_concat(t.`tag`, ' ') FROM `revision_tags` t WHERE t.`revision_id` = r.`id`), ''),
	coalesce((SELECT group_concat(n.`value`, ' ') FROM json_tree(r.`document`, '$.nodes') n
		WHERE n.`type` = 'text' AND typeof(n.`key`) = 'integer' AND n.`key` >= 2), ''),
	e.`id`, e.`site_id`, e.`collection`, e.`locale`
FROM `entries` e JOIN `revisions` r ON r.`id` = e.`published_rev`;
