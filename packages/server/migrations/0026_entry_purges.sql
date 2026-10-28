CREATE TABLE `entry_purges` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`purged_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_purges_id_site` ON `entry_purges` (`id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entry_purges_entry` ON `entry_purges` (`site_id`,`entry_id`);--> statement-breakpoint
CREATE TRIGGER `entry_purges_no_delete`
BEFORE DELETE ON `entry_purges`
BEGIN
	SELECT RAISE(ABORT, 'append-only: the record of a purge is never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `entry_purges_immutable`
BEFORE UPDATE ON `entry_purges`
BEGIN
	SELECT RAISE(ABORT, 'append-only: the record of a purge never changes');
END;
--> statement-breakpoint
DROP TRIGGER `revisions_no_delete`;--> statement-breakpoint
CREATE TRIGGER `revisions_no_delete`
BEFORE DELETE ON `revisions`
WHEN NOT EXISTS (SELECT 1 FROM `entry_purges` WHERE `site_id` = OLD.`site_id` AND `entry_id` = OLD.`entry_id`)
BEGIN
	SELECT RAISE(ABORT, 'append-only: a revision is never deleted');
END;
--> statement-breakpoint
DROP TRIGGER `revision_tags_no_delete`;--> statement-breakpoint
CREATE TRIGGER `revision_tags_no_delete`
BEFORE DELETE ON `revision_tags`
WHEN NOT EXISTS (
	SELECT 1 FROM `entry_purges` AS `p` JOIN `revisions` AS `r` ON `r`.`entry_id` = `p`.`entry_id` AND `r`.`site_id` = `p`.`site_id`
	WHERE `r`.`id` = OLD.`revision_id` AND `r`.`site_id` = OLD.`site_id`
)
BEGIN
	SELECT RAISE(ABORT, 'append-only: a revision tag is never deleted');
END;
--> statement-breakpoint
DROP TRIGGER `publications_no_delete`;--> statement-breakpoint
CREATE TRIGGER `publications_no_delete`
BEFORE DELETE ON `publications`
WHEN NOT EXISTS (SELECT 1 FROM `entry_purges` WHERE `site_id` = OLD.`site_id` AND `entry_id` = OLD.`entry_id`)
BEGIN
	SELECT RAISE(ABORT, 'append-only: a publication is never deleted');
END;
