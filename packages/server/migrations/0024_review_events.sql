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
	CONSTRAINT "outbox_kind" CHECK("kind" IN ('entry.published', 'entry.unpublished', 'site.changed', 'review.requested', 'review.decided')),
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
DROP TABLE `__kept_deliveries`;--> statement-breakpoint
CREATE TRIGGER `reviews_requested_event`
AFTER INSERT ON `reviews`
WHEN NEW.`status` = 'pending'
BEGIN
	INSERT INTO `outbox` (`id`, `site_id`, `kind`, `entry_id`, `payload`, `sent_at`, `created_at`, `updated_at`)
	SELECT 'evt_' || upper(hex(randomblob(13))), NEW.`site_id`, 'review.requested', NEW.`entry_id`,
		json_object(
			'id', NULL,
			'kind', 'review.requested',
			'site', NEW.`site_id`,
			'at', NEW.`updated_at`,
			'cacheTags', json('[]'),
			'review', json_object(
				'id', NEW.`id`,
				'status', NEW.`status`,
				'requestedBy', (SELECT `name` FROM `users` WHERE `id` = NEW.`requested_by`),
				'note', NEW.`note`
			),
			'entry', json_object(
				'id', `entries`.`id`,
				'collection', `entries`.`collection`,
				'locale', `entries`.`locale`,
				'slug', `entries`.`slug`,
				'translationGroup', `entries`.`translation_group`
			),
			'adminPath', '/admin/reviews?review=' || NEW.`id`
		),
		NULL, NEW.`updated_at`, NEW.`updated_at`
	FROM `entries`
	WHERE `entries`.`id` = NEW.`entry_id` AND `entries`.`site_id` = NEW.`site_id`;
	UPDATE `outbox` SET `payload` = json_set(`payload`, '$.id', `id`) WHERE `rowid` = last_insert_rowid();
END;
--> statement-breakpoint
CREATE TRIGGER `reviews_decided_event`
AFTER UPDATE OF `status` ON `reviews`
WHEN OLD.`status` = 'pending' AND NEW.`status` <> 'pending'
BEGIN
	INSERT INTO `outbox` (`id`, `site_id`, `kind`, `entry_id`, `payload`, `sent_at`, `created_at`, `updated_at`)
	SELECT 'evt_' || upper(hex(randomblob(13))), NEW.`site_id`, 'review.decided', NEW.`entry_id`,
		json_object(
			'id', NULL,
			'kind', 'review.decided',
			'site', NEW.`site_id`,
			'at', NEW.`updated_at`,
			'cacheTags', json('[]'),
			'review', json_object(
				'id', NEW.`id`,
				'status', NEW.`status`,
				'requestedBy', (SELECT `name` FROM `users` WHERE `id` = NEW.`requested_by`),
				'note', NEW.`note`
			),
			'entry', json_object(
				'id', `entries`.`id`,
				'collection', `entries`.`collection`,
				'locale', `entries`.`locale`,
				'slug', `entries`.`slug`,
				'translationGroup', `entries`.`translation_group`
			),
			'adminPath', '/admin/reviews?review=' || NEW.`id`
		),
		NULL, NEW.`updated_at`, NEW.`updated_at`
	FROM `entries`
	WHERE `entries`.`id` = NEW.`entry_id` AND `entries`.`site_id` = NEW.`site_id`;
	UPDATE `outbox` SET `payload` = json_set(`payload`, '$.id', `id`) WHERE `rowid` = last_insert_rowid();
END;
