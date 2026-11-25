CREATE TABLE `presence` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`user_id` text NOT NULL,
	`seen_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `presence_user` ON `presence` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `presence_id_site` ON `presence` (`id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `presence_editor` ON `presence` (`site_id`,`entry_id`,`user_id`);