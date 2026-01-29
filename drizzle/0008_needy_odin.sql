ALTER TABLE `goals` ADD `workspace_path` text;--> statement-breakpoint
ALTER TABLE `goals` ADD `relevant_files` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `tasks` ADD `workspace_path` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `relevant_files` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `tasks` ADD `tools` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `tasks` ADD `acceptance_criteria` text;