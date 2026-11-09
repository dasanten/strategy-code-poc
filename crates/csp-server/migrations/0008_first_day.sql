ALTER TABLE `users` ADD `first_day_done` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `first_day_dismissed` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Players from before the first-day card have played their first day: they never see it.
UPDATE `users` SET `first_day_dismissed` = 1;
