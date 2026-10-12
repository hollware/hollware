PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`markdown` text NOT NULL,
	`created_at` text DEFAULT '1970-01-01T00:00:00Z' NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_revisions`("id", "entry_id", "markdown", "created_at") SELECT "id", "entry_id", "markdown", "created_at" FROM `revisions`;--> statement-breakpoint
DROP TABLE `revisions`;--> statement-breakpoint
ALTER TABLE `__new_revisions` RENAME TO `revisions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;