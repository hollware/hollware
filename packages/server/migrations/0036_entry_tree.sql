DROP INDEX `redirects_from`;--> statement-breakpoint
ALTER TABLE `redirects` ADD `from_path` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `redirects` SET `from_path` = `from_slug`;--> statement-breakpoint
CREATE UNIQUE INDEX `redirects_from_path` ON `redirects` (`site_id`,`collection`,`locale`,`from_path`);--> statement-breakpoint
CREATE INDEX `redirects_from` ON `redirects` (`site_id`,`collection`,`locale`,`from_slug`);--> statement-breakpoint
ALTER TABLE `entries` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `entries` ADD `position` integer;--> statement-breakpoint
ALTER TABLE `entries` ADD `slug_path` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `entries_children` ON `entries` (`site_id`,`collection`,`locale`,`parent_id`,`position`);--> statement-breakpoint
CREATE INDEX `entries_slug_path` ON `entries` (`site_id`,`collection`,`locale`,`slug_path`);--> statement-breakpoint
UPDATE `entries` SET `slug_path` = `slug`;