CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`source_url` text NOT NULL,
	`youtube_playlist_id` text NOT NULL,
	`title` text NOT NULL,
	`channel` text NOT NULL,
	`item_count` integer NOT NULL,
	`selected_count` integer NOT NULL,
	`quality_preset` text NOT NULL,
	`kind` text NOT NULL,
	`target_container` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_batches_status` ON `batches` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_batches_created_at` ON `batches` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_batches_playlist_id` ON `batches` (`youtube_playlist_id`);
--> statement-breakpoint
CREATE TABLE `batch_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` text NOT NULL,
	`video_id` integer,
	`position` integer NOT NULL,
	`youtube_id` text NOT NULL,
	`title` text NOT NULL,
	`duration_sec` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`job_id` text,
	`error_code` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`job_id`) REFERENCES `download_jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_batch_items_batch_id` ON `batch_items` (`batch_id`);
--> statement-breakpoint
CREATE INDEX `idx_batch_items_status` ON `batch_items` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_batch_items_youtube_id` ON `batch_items` (`youtube_id`);
--> statement-breakpoint
CREATE INDEX `idx_batch_items_job_id` ON `batch_items` (`job_id`);
--> statement-breakpoint
ALTER TABLE `download_jobs` ADD `batch_item_id` integer REFERENCES `batch_items`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `idx_download_jobs_batch_item_id` ON `download_jobs` (`batch_item_id`);
