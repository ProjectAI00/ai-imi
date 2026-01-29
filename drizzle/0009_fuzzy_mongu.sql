CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text,
	`task_id` text,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`source` text DEFAULT 'agent' NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `memories_goal_id_idx` ON `memories` (`goal_id`);