CREATE TABLE `site_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`version` integer NOT NULL,
	`actor_user_id` text,
	`actor_meta` text,
	`before` text,
	`after` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "site_changes_json" CHECK(("site_changes"."before" IS NULL OR json_valid("site_changes"."before")) AND ("site_changes"."after" IS NULL OR json_valid("site_changes"."after")) AND ("site_changes"."actor_meta" IS NULL OR json_valid("site_changes"."actor_meta")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_changes_id_site` ON `site_changes` (`id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `site_changes_version` ON `site_changes` (`site_id`,`version`);--> statement-breakpoint
ALTER TABLE `sites` ADD `definition` text;--> statement-breakpoint
ALTER TABLE `sites` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sites` ADD `deleted_at` text;