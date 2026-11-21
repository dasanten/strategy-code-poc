-- Creative mode's checkpoints (ADR 0043): named copies of the world, beside its saves.
CREATE TABLE `checkpoints` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`tick` integer NOT NULL,
	`version` integer NOT NULL,
	`data` blob NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkpoints_name_unique` ON `checkpoints` (`name`);
