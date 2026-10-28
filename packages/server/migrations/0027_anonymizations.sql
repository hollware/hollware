CREATE TABLE `anonymizations` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `anonymizations_id_site` ON `anonymizations` (`id`,`site_id`);
--> statement-breakpoint
DROP TRIGGER `revisions_immutable`;
--> statement-breakpoint
CREATE TRIGGER `revisions_immutable`
BEFORE UPDATE OF `id`, `site_id`, `entry_id`, `markdown`, `verdict`, `actor_kind`, `actor_user_id`, `actor_token_id`, `actor_meta`, `created_at` ON `revisions`
WHEN NOT (
	EXISTS (SELECT 1 FROM `anonymizations` WHERE `site_id` = OLD.`site_id` AND `user_id` = OLD.`actor_user_id`)
	AND NEW.`actor_user_id` = 'usr_00000000000000000000000000' AND NEW.`actor_token_id` IS NULL AND NEW.`actor_meta` IS NULL
	AND NEW.`id` IS OLD.`id` AND NEW.`site_id` IS OLD.`site_id` AND NEW.`entry_id` IS OLD.`entry_id` AND NEW.`markdown` IS OLD.`markdown` AND NEW.`verdict` IS OLD.`verdict` AND NEW.`actor_kind` IS OLD.`actor_kind` AND NEW.`created_at` IS OLD.`created_at`
)
BEGIN
	SELECT RAISE(ABORT, 'append-only: only the derived columns of a revision change');
END;
--> statement-breakpoint
DROP TRIGGER `publications_immutable`;
--> statement-breakpoint
CREATE TRIGGER `publications_immutable`
BEFORE UPDATE OF `id`, `site_id`, `entry_id`, `action`, `revision_id`, `verdict`, `acknowledged`, `actor_kind`, `actor_user_id`, `actor_token_id`, `actor_meta`, `created_at` ON `publications`
WHEN NOT (
	EXISTS (SELECT 1 FROM `anonymizations` WHERE `site_id` = OLD.`site_id` AND `user_id` = OLD.`actor_user_id`)
	AND NEW.`actor_user_id` = 'usr_00000000000000000000000000' AND NEW.`actor_token_id` IS NULL AND NEW.`actor_meta` IS NULL
	AND NEW.`id` IS OLD.`id` AND NEW.`site_id` IS OLD.`site_id` AND NEW.`entry_id` IS OLD.`entry_id` AND NEW.`action` IS OLD.`action` AND NEW.`revision_id` IS OLD.`revision_id` AND NEW.`verdict` IS OLD.`verdict` AND NEW.`acknowledged` IS OLD.`acknowledged` AND NEW.`actor_kind` IS OLD.`actor_kind` AND NEW.`created_at` IS OLD.`created_at`
)
BEGIN
	SELECT RAISE(ABORT, 'append-only: a publication never changes');
END;
--> statement-breakpoint
DROP TRIGGER `site_changes_immutable`;
--> statement-breakpoint
CREATE TRIGGER `site_changes_immutable`
BEFORE UPDATE ON `site_changes`
WHEN NOT (
	EXISTS (SELECT 1 FROM `anonymizations` WHERE `site_id` = OLD.`site_id` AND `user_id` = OLD.`actor_user_id`)
	AND NEW.`actor_user_id` = 'usr_00000000000000000000000000' AND NEW.`actor_meta` IS NULL
	AND NEW.`id` IS OLD.`id` AND NEW.`site_id` IS OLD.`site_id` AND NEW.`version` IS OLD.`version` AND NEW.`before` IS OLD.`before` AND NEW.`after` IS OLD.`after` AND NEW.`created_at` IS OLD.`created_at` AND NEW.`updated_at` IS OLD.`updated_at`
)
BEGIN
	SELECT RAISE(ABORT, 'append-only: a change of the structure never changes');
END;
--> statement-breakpoint
DROP TRIGGER `audit_log_immutable`;
--> statement-breakpoint
CREATE TRIGGER `audit_log_immutable`
BEFORE UPDATE ON `audit_log`
WHEN NOT (
	(EXISTS (SELECT 1 FROM `anonymizations` WHERE `site_id` = OLD.`site_id` AND `user_id` = OLD.`actor_user_id`)
		AND NEW.`actor_user_id` = 'usr_00000000000000000000000000' AND NEW.`actor_token_id` IS NULL AND NEW.`actor_meta` IS NULL AND NEW.`ip_hash` IS NULL
		AND (NEW.`detail` IS OLD.`detail` OR (OLD.`action` = 'token.create' AND NEW.`detail` IS json_remove(OLD.`detail`, '$.label')))
		AND NEW.`id` IS OLD.`id` AND NEW.`site_id` IS OLD.`site_id` AND NEW.`action` IS OLD.`action` AND NEW.`outcome` IS OLD.`outcome` AND NEW.`error_code` IS OLD.`error_code` AND NEW.`actor_kind` IS OLD.`actor_kind` AND NEW.`actor_client_id` IS OLD.`actor_client_id` AND NEW.`request_id` IS OLD.`request_id` AND NEW.`created_at` IS OLD.`created_at` AND NEW.`updated_at` IS OLD.`updated_at` AND NEW.`target_type` IS OLD.`target_type` AND NEW.`target_id` IS OLD.`target_id`)
	OR (OLD.`target_type` = 'user' AND EXISTS (SELECT 1 FROM `anonymizations` WHERE `site_id` = OLD.`site_id` AND `user_id` = OLD.`target_id`)
		AND NEW.`target_id` = 'usr_00000000000000000000000000'
		AND NEW.`id` IS OLD.`id` AND NEW.`site_id` IS OLD.`site_id` AND NEW.`action` IS OLD.`action` AND NEW.`outcome` IS OLD.`outcome` AND NEW.`error_code` IS OLD.`error_code` AND NEW.`actor_kind` IS OLD.`actor_kind` AND NEW.`actor_client_id` IS OLD.`actor_client_id` AND NEW.`request_id` IS OLD.`request_id` AND NEW.`created_at` IS OLD.`created_at` AND NEW.`updated_at` IS OLD.`updated_at` AND NEW.`detail` IS OLD.`detail` AND NEW.`target_type` IS OLD.`target_type` AND NEW.`actor_user_id` IS OLD.`actor_user_id` AND NEW.`actor_token_id` IS OLD.`actor_token_id` AND NEW.`actor_meta` IS OLD.`actor_meta` AND NEW.`ip_hash` IS OLD.`ip_hash`)
)
BEGIN
	SELECT RAISE(ABORT, 'append-only: a line of the activity log never changes');
END;
--> statement-breakpoint
DROP TRIGGER `assets_immutable`;
--> statement-breakpoint
CREATE TRIGGER `assets_immutable`
BEFORE UPDATE OF `id`, `site_id`, `sha256`, `format`, `width`, `height`, `bytes`, `original_format`, `original_bytes`, `filename`, `created_by`, `created_at` ON `assets`
WHEN NOT (
	EXISTS (SELECT 1 FROM `anonymizations` WHERE `site_id` = OLD.`site_id` AND `user_id` = OLD.`created_by`)
	AND NEW.`created_by` = 'usr_00000000000000000000000000'
	AND NEW.`id` IS OLD.`id` AND NEW.`site_id` IS OLD.`site_id` AND NEW.`sha256` IS OLD.`sha256` AND NEW.`format` IS OLD.`format` AND NEW.`width` IS OLD.`width` AND NEW.`height` IS OLD.`height` AND NEW.`bytes` IS OLD.`bytes` AND NEW.`original_format` IS OLD.`original_format` AND NEW.`original_bytes` IS OLD.`original_bytes` AND NEW.`filename` IS OLD.`filename` AND NEW.`created_at` IS OLD.`created_at`
)
BEGIN
	SELECT RAISE(ABORT, 'append-only: only the alt of an asset changes');
END;
--> statement-breakpoint
DROP TRIGGER `entry_purges_immutable`;
--> statement-breakpoint
CREATE TRIGGER `entry_purges_immutable`
BEFORE UPDATE ON `entry_purges`
WHEN NOT (
	EXISTS (SELECT 1 FROM `anonymizations` WHERE `site_id` = OLD.`site_id` AND `user_id` = OLD.`purged_by`)
	AND NEW.`purged_by` = 'usr_00000000000000000000000000'
	AND NEW.`id` IS OLD.`id` AND NEW.`site_id` IS OLD.`site_id` AND NEW.`entry_id` IS OLD.`entry_id` AND NEW.`created_at` IS OLD.`created_at` AND NEW.`updated_at` IS OLD.`updated_at`
)
BEGIN
	SELECT RAISE(ABORT, 'append-only: the record of a purge never changes');
END;
