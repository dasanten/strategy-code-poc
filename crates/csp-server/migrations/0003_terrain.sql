CREATE TABLE `terrain` (
	`id` integer PRIMARY KEY NOT NULL,
	`seed` integer NOT NULL,
	`diameter` integer NOT NULL,
	`data` blob NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
