CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`collection` text NOT NULL,
	`locale` text NOT NULL,
	`slug` text NOT NULL,
	`translation_group` text,
	`status` text NOT NULL,
	`version` integer NOT NULL,
	`head_rev` text NOT NULL,
	`published_rev` text,
	`published_at` text,
	`published_sort_key` text,
	`scheduled_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "entries_status" CHECK("entries"."status" IN ('draft', 'scheduled', 'published')),
	CONSTRAINT "entries_version" CHECK("entries"."version" >= 1),
	CONSTRAINT "entries_draft" CHECK("entries"."status" <> 'draft' OR ("entries"."published_rev" IS NULL AND "entries"."published_sort_key" IS NULL AND "entries"."scheduled_at" IS NULL)),
	CONSTRAINT "entries_published" CHECK("entries"."status" <> 'published' OR ("entries"."published_rev" IS NOT NULL AND "entries"."published_at" IS NOT NULL AND "entries"."published_sort_key" IS NOT NULL)),
	CONSTRAINT "entries_scheduled" CHECK("entries"."status" <> 'scheduled' OR "entries"."scheduled_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `entries_head` ON `entries` (`site_id`,`collection`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `entries_head_locale` ON `entries` (`site_id`,`collection`,`locale`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `entries_published` ON `entries` (`site_id`,`collection`,`locale`,`published_sort_key`,`id`) WHERE "entries"."status" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX `entries_id_site` ON `entries` (`id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entries_slug` ON `entries` (`site_id`,`collection`,`locale`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `entries_translation` ON `entries` (`site_id`,`collection`,`translation_group`,`locale`);--> statement-breakpoint
CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`action` text NOT NULL,
	`revision_id` text,
	`verdict` text,
	`acknowledged` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_token_id` text,
	`actor_meta` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`,`site_id`) REFERENCES `entries`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`,`site_id`) REFERENCES `revisions`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_token_id`,`site_id`) REFERENCES `tokens`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "publications_action" CHECK("publications"."action" IN ('publish', 'unpublish')),
	CONSTRAINT "publications_shape" CHECK(("publications"."action" = 'publish' AND "publications"."revision_id" IS NOT NULL AND "publications"."verdict" IS NOT NULL) OR ("publications"."action" = 'unpublish' AND "publications"."revision_id" IS NULL AND "publications"."verdict" IS NULL)),
	CONSTRAINT "publications_actor_kind" CHECK("publications"."actor_kind" IN ('token', 'user', 'oauth_client')),
	CONSTRAINT "publications_json" CHECK(json_valid("publications"."acknowledged") AND json_type("publications"."acknowledged") = 'array' AND ("publications"."verdict" IS NULL OR json_valid("publications"."verdict")) AND ("publications"."actor_meta" IS NULL OR json_valid("publications"."actor_meta")))
);
--> statement-breakpoint
CREATE INDEX `publications_entry` ON `publications` (`entry_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `publications_id_site` ON `publications` (`id`,`site_id`);--> statement-breakpoint
CREATE TABLE `revision_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`,`site_id`) REFERENCES `revisions`(`id`,`site_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `revision_tags_by_tag` ON `revision_tags` (`site_id`,`tag`);--> statement-breakpoint
CREATE UNIQUE INDEX `revision_tags_id_site` ON `revision_tags` (`id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `revision_tags_tag` ON `revision_tags` (`revision_id`,`tag`);--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`markdown` text NOT NULL,
	`frontmatter` text NOT NULL,
	`document` text NOT NULL,
	`comark_version` text NOT NULL,
	`pipeline_version` text NOT NULL,
	`word_count` integer NOT NULL,
	`verdict` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_token_id` text,
	`actor_meta` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`,`site_id`) REFERENCES `entries`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_token_id`,`site_id`) REFERENCES `tokens`(`id`,`site_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "revisions_actor_kind" CHECK("revisions"."actor_kind" IN ('token', 'user', 'oauth_client')),
	CONSTRAINT "revisions_json" CHECK(json_valid("revisions"."frontmatter") AND json_valid("revisions"."document") AND json_valid("revisions"."verdict") AND ("revisions"."actor_meta" IS NULL OR json_valid("revisions"."actor_meta"))),
	CONSTRAINT "revisions_word_count" CHECK("revisions"."word_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `revisions_entry` ON `revisions` (`entry_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `revisions_id_site` ON `revisions` (`id`,`site_id`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`hash` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`last_used_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tokens_scopes" CHECK(json_valid("tokens"."scopes") AND json_type("tokens"."scopes") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_id_site` ON `tokens` (`id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_hash` ON `tokens` (`hash`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "users_role" CHECK("users"."role" IN ('owner', 'editor', 'reviewer'))
);
