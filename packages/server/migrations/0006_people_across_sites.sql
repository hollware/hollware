-- Edited by hand (ADR-023): a person is one across the sites of a deployment (v0.4), so passkeys,
-- sessions and sign-in challenges lose site_id. Each table is rebuilt, which D1 allows here since
-- no other table points at them; the PRAGMA foreign_keys lines drizzle-kit writes are gone, as D1
-- ignores them, and the CHECKs name their columns without the temporary table's name.
CREATE TABLE `__new_auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`challenge` text NOT NULL,
	`purpose` text NOT NULL,
	`invitation_id` text,
	`user_id` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "auth_challenges_purpose" CHECK("purpose" IN ('register', 'authenticate'))
);
--> statement-breakpoint
INSERT INTO `__new_auth_challenges`("id", "challenge", "purpose", "invitation_id", "user_id", "expires_at", "created_at", "updated_at") SELECT "id", "challenge", "purpose", "invitation_id", "user_id", "expires_at", "created_at", "updated_at" FROM `auth_challenges`;--> statement-breakpoint
DROP TABLE `auth_challenges`;--> statement-breakpoint
ALTER TABLE `__new_auth_challenges` RENAME TO `auth_challenges`;--> statement-breakpoint
CREATE TABLE `__new_passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer NOT NULL,
	`transports` text NOT NULL,
	`label` text NOT NULL,
	`last_used_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "passkeys_counter" CHECK("counter" >= 0),
	CONSTRAINT "passkeys_json" CHECK(json_valid("transports") AND json_type("transports") = 'array')
);
--> statement-breakpoint
INSERT INTO `__new_passkeys`("id", "user_id", "credential_id", "public_key", "counter", "transports", "label", "last_used_at", "created_at", "updated_at") SELECT "id", "user_id", "credential_id", "public_key", "counter", "transports", "label", "last_used_at", "created_at", "updated_at" FROM `passkeys`;--> statement-breakpoint
DROP TABLE `passkeys`;--> statement-breakpoint
ALTER TABLE `__new_passkeys` RENAME TO `passkeys`;--> statement-breakpoint
CREATE INDEX `passkeys_user` ON `passkeys` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `passkeys_credential` ON `passkeys` (`credential_id`);--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "user_id", "hash", "expires_at", "created_at", "updated_at") SELECT "id", "user_id", "hash", "expires_at", "created_at", "updated_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_hash` ON `sessions` (`hash`);