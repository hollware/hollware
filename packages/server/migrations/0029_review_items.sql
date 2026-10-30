CREATE TABLE `review_items` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`review_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`revision_id` text,
	`base_revision_id` text,
	`action` text NOT NULL,
	`excluded` integer DEFAULT 0 NOT NULL,
	`active` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_id`,`site_id`) REFERENCES `reviews`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`,`site_id`) REFERENCES `entries`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`,`site_id`) REFERENCES `revisions`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`base_revision_id`,`site_id`) REFERENCES `revisions`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_items_action" CHECK("review_items"."action" IN ('publish', 'unpublish')),
	CONSTRAINT "review_items_revision_of_action" CHECK(("review_items"."action" = 'publish') = ("review_items"."revision_id" IS NOT NULL)),
	CONSTRAINT "review_items_flags" CHECK("review_items"."excluded" IN (0, 1) AND "review_items"."active" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_items_active` ON `review_items` (`site_id`,`entry_id`) WHERE "review_items"."active" = 1;--> statement-breakpoint
CREATE INDEX `review_items_review` ON `review_items` (`site_id`,`review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_items_id_site` ON `review_items` (`id`,`site_id`);--> statement-breakpoint
ALTER TABLE `review_comments` ADD `entry_id` text;--> statement-breakpoint
ALTER TABLE `review_comments` ADD `line_from` integer;--> statement-breakpoint
ALTER TABLE `review_comments` ADD `line_to` integer;