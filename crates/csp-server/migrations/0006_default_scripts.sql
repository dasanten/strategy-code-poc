ALTER TABLE `scripts` ADD `task` text;--> statement-breakpoint
ALTER TABLE `scripts` ADD `follows_default` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `scripts` ADD `edited_from` text;--> statement-breakpoint
CREATE UNIQUE INDEX `scripts_user_task` ON `scripts` (`user_id`,`task`);