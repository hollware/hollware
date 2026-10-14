CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`event_id` text NOT NULL,
	`subscriber` text NOT NULL,
	`attempts` integer NOT NULL,
	`delivered_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`,`site_id`) REFERENCES `outbox`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deliveries_attempts" CHECK("deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deliveries_id_site` ON `deliveries` (`id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deliveries_event_subscriber` ON `deliveries` (`event_id`,`subscriber`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`entry_id` text NOT NULL,
	`payload` text NOT NULL,
	`sent_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "outbox_kind" CHECK("outbox"."kind" IN ('entry.published', 'entry.unpublished')),
	CONSTRAINT "outbox_json" CHECK(json_valid("outbox"."payload") AND json_type("outbox"."payload") = 'object')
);
--> statement-breakpoint
CREATE INDEX `outbox_unsent` ON `outbox` (`sent_at`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_id_site` ON `outbox` (`id`,`site_id`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`version` integer NOT NULL,
	`acknowledged` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_token_id` text,
	`actor_meta` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`,`site_id`) REFERENCES `entries`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_token_id`,`site_id`) REFERENCES `tokens`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedules_actor_kind" CHECK("schedules"."actor_kind" IN ('token', 'user', 'oauth_client')),
	CONSTRAINT "schedules_json" CHECK(json_valid("schedules"."acknowledged") AND json_type("schedules"."acknowledged") = 'array' AND ("schedules"."actor_meta" IS NULL OR json_valid("schedules"."actor_meta")))
);
--> statement-breakpoint
CREATE INDEX `schedules_due` ON `schedules` (`scheduled_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `schedules_id_site` ON `schedules` (`id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `schedules_entry` ON `schedules` (`site_id`,`entry_id`);