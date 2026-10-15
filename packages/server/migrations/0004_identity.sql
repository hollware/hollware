CREATE TABLE `auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`challenge` text NOT NULL,
	`purpose` text NOT NULL,
	`invitation_id` text,
	`user_id` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "auth_challenges_purpose" CHECK("auth_challenges"."purpose" IN ('register', 'authenticate'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_challenges_id_site` ON `auth_challenges` (`id`,`site_id`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`hash` text NOT NULL,
	`role` text NOT NULL,
	`user_id` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_role" CHECK("invitations"."role" IN ('owner', 'editor', 'author'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_id_site` ON `invitations` (`id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_hash` ON `invitations` (`hash`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "members_role" CHECK("members"."role" IN ('owner', 'editor', 'author'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_id_site` ON `members` (`id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_person` ON `members` (`site_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer NOT NULL,
	`transports` text NOT NULL,
	`label` text NOT NULL,
	`last_used_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "passkeys_counter" CHECK("passkeys"."counter" >= 0),
	CONSTRAINT "passkeys_json" CHECK(json_valid("passkeys"."transports") AND json_type("passkeys"."transports") = 'array')
);
--> statement-breakpoint
CREATE INDEX `passkeys_user` ON `passkeys` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `passkeys_id_site` ON `passkeys` (`id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `passkeys_credential` ON `passkeys` (`credential_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_id_site` ON `sessions` (`id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_hash` ON `sessions` (`hash`);--> statement-breakpoint
-- Edited by hand (ADR-023): every person who has a token in a site becomes a member of it, with the
-- role they had, so a deployment of v0.2 keeps who may do what. A reviewer of then is an author
-- now. The id is the prefix and 26 hex digits, which are characters of a ULID.
INSERT INTO `members` (`id`, `site_id`, `user_id`, `role`, `created_at`, `updated_at`)
SELECT 'mbr_' || upper(hex(randomblob(13))), `pairs`.`site_id`, `users`.`id`,
  CASE `users`.`role` WHEN 'reviewer' THEN 'author' ELSE `users`.`role` END,
  `users`.`created_at`, `users`.`updated_at`
FROM (SELECT DISTINCT `site_id`, `user_id` FROM `tokens`) AS `pairs`
JOIN `users` ON `users`.`id` = `pairs`.`user_id`;
