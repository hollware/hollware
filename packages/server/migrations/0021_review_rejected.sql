-- Edited by hand (ADR-023): a review can be rejected (reject_review), so the CHECK of its status
-- takes `rejected`. SQLite cannot change a CHECK, so the table is rebuilt. `review_comments`
-- points at reviews, and SQLite counts a row that points at a dropped table as broken even when the
-- rebuilt one holds its key, so the comments are set aside, the reviews are rebuilt with nothing
-- pointing at them, and the comments come back, every one to a row that exists. The PRAGMA
-- foreign_keys lines drizzle-kit writes are gone, as D1 ignores them, and the CHECKs name their
-- columns without the temporary table's name.
CREATE TABLE `__kept_review_comments` AS SELECT * FROM `review_comments`;--> statement-breakpoint
DELETE FROM `review_comments`;--> statement-breakpoint
CREATE TABLE `__new_reviews` (
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
	CONSTRAINT "reviews_status" CHECK("status" IN ('pending', 'approved', 'changes_requested', 'rejected', 'cancelled')),
	CONSTRAINT "reviews_decided" CHECK(("status" IN ('pending', 'cancelled')) OR ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL)),
	CONSTRAINT "reviews_json" CHECK(json_valid("acknowledged") AND json_type("acknowledged") = 'array' AND ("requested_meta" IS NULL OR json_valid("requested_meta")))
);
--> statement-breakpoint
INSERT INTO `__new_reviews`("id", "site_id", "entry_id", "revision_id", "status", "acknowledged", "requested_by", "requested_meta", "decided_by", "decided_at", "note", "created_at", "updated_at") SELECT "id", "site_id", "entry_id", "revision_id", "status", "acknowledged", "requested_by", "requested_meta", "decided_by", "decided_at", "note", "created_at", "updated_at" FROM `reviews`;--> statement-breakpoint
DROP TABLE `reviews`;--> statement-breakpoint
ALTER TABLE `__new_reviews` RENAME TO `reviews`;--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_pending` ON `reviews` (`site_id`,`entry_id`) WHERE "reviews"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `reviews_queue` ON `reviews` (`site_id`,`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_id_site` ON `reviews` (`id`,`site_id`);--> statement-breakpoint
INSERT INTO `review_comments` SELECT * FROM `__kept_review_comments`;--> statement-breakpoint
DROP TABLE `__kept_review_comments`;
