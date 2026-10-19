-- The script library (T14.4): a script row per name, its saves in script_versions.
-- Hand-written so the old one-row-per-save table carries over: each name becomes a script and
-- its rows its versions. Migrated scripts start with no active version (it is set on the next
-- save), since only the server can check them for syntax errors.
ALTER TABLE `scripts` RENAME TO `__old_scripts`;--> statement-breakpoint
CREATE TABLE `scripts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`active_version` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scripts_user_name_lower` ON `scripts` (`user_id`,lower("name"));--> statement-breakpoint
CREATE TABLE `script_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`script_id` integer NOT NULL,
	`version` integer NOT NULL,
	`source` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`script_id`) REFERENCES `scripts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `script_versions_script_version` ON `script_versions` (`script_id`,`version`);--> statement-breakpoint
INSERT INTO `scripts` (`user_id`, `name`, `created_at`)
	SELECT `user_id`, min(`name`), min(`created_at`) FROM `__old_scripts` GROUP BY `user_id`, lower(`name`);--> statement-breakpoint
INSERT INTO `script_versions` (`script_id`, `version`, `source`, `created_at`)
	SELECT s.`id`, row_number() OVER (PARTITION BY s.`id` ORDER BY o.`version`, o.`id`), o.`source`, o.`created_at`
	FROM `__old_scripts` o JOIN `scripts` s ON s.`user_id` = o.`user_id` AND lower(s.`name`) = lower(o.`name`);--> statement-breakpoint
DROP TABLE `__old_scripts`;
