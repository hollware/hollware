CREATE TABLE `review_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`review_id` text NOT NULL,
	`author_id` text NOT NULL,
	`author_meta` text,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_id`,`site_id`) REFERENCES `reviews`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_comments_body" CHECK(length("review_comments"."body") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE INDEX `review_comments_review` ON `review_comments` (`site_id`,`review_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_comments_id_site` ON `review_comments` (`id`,`site_id`);