ALTER TABLE `scripts` ADD `latest_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `scripts` SET `latest_version` = coalesce((SELECT max(`version`) FROM `script_versions` WHERE `script_versions`.`script_id` = `scripts`.`id`), 0);
