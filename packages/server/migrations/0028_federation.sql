CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`email` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `identities_user` ON `identities` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `identities_subject` ON `identities` (`provider`,`subject`);--> statement-breakpoint
CREATE TABLE `__new_auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`challenge` text NOT NULL,
	`purpose` text NOT NULL,
	`invitation_id` text,
	`user_id` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`provider` text,
	`nonce` text,
	`code_verifier` text,
	`return_to` text,
	CONSTRAINT "auth_challenges_purpose" CHECK("purpose" IN ('register', 'authenticate', 'federate', 'enroll'))
);
--> statement-breakpoint
INSERT INTO `__new_auth_challenges`("id", "challenge", "purpose", "invitation_id", "user_id", "expires_at", "created_at", "updated_at") SELECT "id", "challenge", "purpose", "invitation_id", "user_id", "expires_at", "created_at", "updated_at" FROM `auth_challenges`;--> statement-breakpoint
DROP TABLE `auth_challenges`;--> statement-breakpoint
ALTER TABLE `__new_auth_challenges` RENAME TO `auth_challenges`;--> statement-breakpoint
ALTER TABLE `invitations` ADD `email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email` ON `users` (`email`);