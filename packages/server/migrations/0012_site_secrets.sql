CREATE TABLE `site_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`sealed` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_secrets_id_site` ON `site_secrets` (`id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `site_secrets_name` ON `site_secrets` (`site_id`,`name`);