CREATE TABLE `agent_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`agent` text NOT NULL,
	`review_id` text,
	`hash` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_id`,`site_id`) REFERENCES `reviews`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "agent_grants_scopes" CHECK(json_valid("agent_grants"."scopes") AND json_type("agent_grants"."scopes") = 'array')
);
--> statement-breakpoint
CREATE INDEX `agent_grants_expiry` ON `agent_grants` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_grants_id_site` ON `agent_grants` (`id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_grants_hash` ON `agent_grants` (`hash`);--> statement-breakpoint
CREATE TABLE `review_agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`review_id` text NOT NULL,
	`agent` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_id`,`site_id`) REFERENCES `reviews`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_agent_runs_status" CHECK("review_agent_runs"."status" IN ('queued', 'commented', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `review_agent_runs_review` ON `review_agent_runs` (`site_id`,`review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_agent_runs_id_site` ON `review_agent_runs` (`id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_agent_runs_review_agent` ON `review_agent_runs` (`review_id`,`agent`);--> statement-breakpoint
ALTER TABLE `users` ADD `kind` text DEFAULT 'person' NOT NULL;