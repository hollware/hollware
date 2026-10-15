CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`status` text NOT NULL,
	`acknowledged` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_meta` text,
	`decided_by` text,
	`decided_at` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`,`site_id`) REFERENCES `entries`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`,`site_id`) REFERENCES `revisions`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reviews_status" CHECK("reviews"."status" IN ('pending', 'approved', 'changes_requested', 'cancelled')),
	CONSTRAINT "reviews_decided" CHECK(("reviews"."status" IN ('pending', 'cancelled')) OR ("reviews"."decided_by" IS NOT NULL AND "reviews"."decided_at" IS NOT NULL)),
	CONSTRAINT "reviews_json" CHECK(json_valid("reviews"."acknowledged") AND json_type("reviews"."acknowledged") = 'array' AND ("reviews"."requested_meta" IS NULL OR json_valid("reviews"."requested_meta")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_pending` ON `reviews` (`site_id`,`entry_id`) WHERE "reviews"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `reviews_queue` ON `reviews` (`site_id`,`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_id_site` ON `reviews` (`id`,`site_id`);