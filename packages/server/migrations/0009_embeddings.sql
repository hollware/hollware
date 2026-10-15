CREATE TABLE `entry_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`model` text NOT NULL,
	`chunker_version` text NOT NULL,
	`pieces` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`,`site_id`) REFERENCES `entries`(`id`,`site_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`,`site_id`) REFERENCES `revisions`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "entry_embeddings_pieces" CHECK("entry_embeddings"."pieces" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_embeddings_id_site` ON `entry_embeddings` (`id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entry_embeddings_entry` ON `entry_embeddings` (`site_id`,`entry_id`);