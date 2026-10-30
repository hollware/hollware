INSERT INTO `review_items` (`id`, `site_id`, `review_id`, `entry_id`, `revision_id`, `base_revision_id`, `action`, `excluded`, `active`, `created_at`, `updated_at`)
SELECT 'rvi_' || substr(`reviews`.`id`, 5), `reviews`.`site_id`, `reviews`.`id`, `reviews`.`entry_id`, `reviews`.`revision_id`,
	`entries`.`published_rev`,
	'publish', 0, CASE WHEN `reviews`.`status` = 'pending' THEN 1 ELSE 0 END, `reviews`.`created_at`, `reviews`.`updated_at`
FROM `reviews`
INNER JOIN `entries` ON `entries`.`id` = `reviews`.`entry_id` AND `entries`.`site_id` = `reviews`.`site_id`;
--> statement-breakpoint
CREATE TRIGGER `reviews_close_items`
AFTER UPDATE OF `status` ON `reviews`
WHEN OLD.`status` = 'pending' AND NEW.`status` <> 'pending'
BEGIN
	UPDATE `review_items` SET `active` = 0, `updated_at` = NEW.`updated_at`
	WHERE `site_id` = NEW.`site_id` AND `review_id` = NEW.`id` AND `active` = 1;
END;
--> statement-breakpoint
DROP TRIGGER `reviews_decided_event`;
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
			'items', json((SELECT coalesce(json_group_array(json_object('entryId', `item`.`entry_id`, 'action', `item`.`action`)), '[]')
				FROM (SELECT `entry_id`, `action` FROM `review_items` WHERE `site_id` = NEW.`site_id` AND `review_id` = NEW.`id` ORDER BY `rowid`) AS `item`)),
			'adminPath', '/admin/reviews?review=' || NEW.`id`
		),
		NULL, NEW.`updated_at`, NEW.`updated_at`
	FROM `entries`
	WHERE `entries`.`id` = NEW.`entry_id` AND `entries`.`site_id` = NEW.`site_id`;
	UPDATE `outbox` SET `payload` = json_set(`payload`, '$.id', `id`) WHERE `rowid` = last_insert_rowid();
END;
