CREATE TRIGGER `entries_content_version_insert`
AFTER INSERT ON `entries`
BEGIN
	UPDATE `sites` SET `content_version` = `content_version` + 1 WHERE `id` = NEW.`site_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `entries_content_version_update`
AFTER UPDATE ON `entries`
BEGIN
	UPDATE `sites` SET `content_version` = `content_version` + 1 WHERE `id` = NEW.`site_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `entries_content_version_delete`
AFTER DELETE ON `entries`
BEGIN
	UPDATE `sites` SET `content_version` = `content_version` + 1 WHERE `id` = OLD.`site_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `redirects_content_version_insert`
AFTER INSERT ON `redirects`
BEGIN
	UPDATE `sites` SET `content_version` = `content_version` + 1 WHERE `id` = NEW.`site_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `redirects_content_version_update`
AFTER UPDATE ON `redirects`
BEGIN
	UPDATE `sites` SET `content_version` = `content_version` + 1 WHERE `id` = NEW.`site_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `redirects_content_version_delete`
AFTER DELETE ON `redirects`
BEGIN
	UPDATE `sites` SET `content_version` = `content_version` + 1 WHERE `id` = OLD.`site_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `assets_content_version_insert`
AFTER INSERT ON `assets`
BEGIN
	UPDATE `sites` SET `content_version` = `content_version` + 1 WHERE `id` = NEW.`site_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `assets_content_version_update`
AFTER UPDATE ON `assets`
BEGIN
	UPDATE `sites` SET `content_version` = `content_version` + 1 WHERE `id` = NEW.`site_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `entry_embeddings_content_version_insert`
AFTER INSERT ON `entry_embeddings`
BEGIN
	UPDATE `sites` SET `content_version` = `content_version` + 1 WHERE `id` = NEW.`site_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `entry_embeddings_content_version_update`
AFTER UPDATE ON `entry_embeddings`
BEGIN
	UPDATE `sites` SET `content_version` = `content_version` + 1 WHERE `id` = NEW.`site_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `entry_embeddings_content_version_delete`
AFTER DELETE ON `entry_embeddings`
BEGIN
	UPDATE `sites` SET `content_version` = `content_version` + 1 WHERE `id` = OLD.`site_id`;
END;
