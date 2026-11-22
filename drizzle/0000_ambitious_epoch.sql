CREATE TABLE `download_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` integer NOT NULL,
	`format_id` integer,
	`source_format_id` text NOT NULL,
	`target_container` text NOT NULL,
	`target_bitrate_kbps` integer,
	`needs_merge` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress_pct` real DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`output_filename` text NOT NULL,
	`temp_filepath` text,
	`bytes_total` integer,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`format_id`) REFERENCES `formats`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_download_jobs_status` ON `download_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_download_jobs_created_at` ON `download_jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_download_jobs_video_id` ON `download_jobs` (`video_id`);--> statement-breakpoint
CREATE TABLE `formats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` integer NOT NULL,
	`format_id` text NOT NULL,
	`kind` text NOT NULL,
	`container` text NOT NULL,
	`vcodec` text,
	`acodec` text,
	`resolution` text,
	`width` integer,
	`height` integer,
	`fps` real,
	`bitrate_kbps` real,
	`filesize_bytes` integer,
	`is_hdr` integer DEFAULT false NOT NULL,
	`format_note` text,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_formats_video_format_unique` ON `formats` (`video_id`,`format_id`);--> statement-breakpoint
CREATE INDEX `idx_formats_video_id` ON `formats` (`video_id`);--> statement-breakpoint
CREATE TABLE `history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`downloaded_at` integer NOT NULL,
	`bytes_sent` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `download_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_history_job_id` ON `history` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_history_downloaded_at` ON `history` (`downloaded_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`youtube_id` text NOT NULL,
	`title` text NOT NULL,
	`channel` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`upload_date` text,
	`thumbnail_url` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_videos_youtube_id` ON `videos` (`youtube_id`);