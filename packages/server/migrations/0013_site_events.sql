-- Edited by hand (ADR-023): the outbox takes the events of a change of a site's structure
-- (`site.changed`, ADR-033), which are about no entry, so the table is rebuilt with a wider kind and
-- an entry_id that only such an event leaves empty. `deliveries` points at the outbox, and SQLite
-- counts a row that points at a dropped table as broken even when the rebuilt one holds its key, so
-- the deliveries are set aside, the outbox is rebuilt with nothing pointing at it, and they come
-- back, every one to a row that exists. The PRAGMA foreign_keys lines drizzle-kit writes are gone,
-- as D1 ignores them, and the CHECKs name their columns without the temporary table's name.
CREATE TABLE `__kept_deliveries` AS SELECT * FROM `deliveries`;--> statement-breakpoint
DELETE FROM `deliveries`;--> statement-breakpoint
CREATE TABLE `__new_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`entry_id` text,
	`payload` text NOT NULL,
	`sent_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "outbox_kind" CHECK("kind" IN ('entry.published', 'entry.unpublished', 'site.changed')),
	CONSTRAINT "outbox_entry" CHECK(("kind" = 'site.changed') = ("entry_id" IS NULL)),
	CONSTRAINT "outbox_json" CHECK(json_valid("payload") AND json_type("payload") = 'object')
);
--> statement-breakpoint
INSERT INTO `__new_outbox`("id", "site_id", "kind", "entry_id", "payload", "sent_at", "created_at", "updated_at") SELECT "id", "site_id", "kind", "entry_id", "payload", "sent_at", "created_at", "updated_at" FROM `outbox`;--> statement-breakpoint
DROP TABLE `outbox`;--> statement-breakpoint
ALTER TABLE `__new_outbox` RENAME TO `outbox`;--> statement-breakpoint
CREATE INDEX `outbox_unsent` ON `outbox` (`sent_at`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_id_site` ON `outbox` (`id`,`site_id`);--> statement-breakpoint
INSERT INTO `deliveries` SELECT * FROM `__kept_deliveries`;--> statement-breakpoint
DROP TABLE `__kept_deliveries`;
