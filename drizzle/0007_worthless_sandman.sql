CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`workspace_id` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`context` text,
	`tags` text DEFAULT '[]',
	`created_at` integer,
	`updated_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`goal_id` text,
	`steps` text DEFAULT '[]' NOT NULL,
	`approval_status` text DEFAULT 'draft' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `goal_id` text REFERENCES goals(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `plan_id` text REFERENCES plans(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `execution_format` text DEFAULT 'json';--> statement-breakpoint
ALTER TABLE `tasks` ADD `execution_payload` text;