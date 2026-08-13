CREATE TYPE "public"."diagram_asset_status" AS ENUM('pending', 'ready');--> statement-breakpoint
CREATE TABLE "diagram_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"diagram_id" uuid NOT NULL,
	"status" "diagram_asset_status" DEFAULT 'pending' NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer,
	"object_key" text NOT NULL,
	"checksum" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diagram_assets" ADD CONSTRAINT "diagram_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_assets" ADD CONSTRAINT "diagram_assets_diagram_id_diagrams_id_fk" FOREIGN KEY ("diagram_id") REFERENCES "public"."diagrams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_assets" ADD CONSTRAINT "diagram_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diagram_assets_workspace_checksum_idx" ON "diagram_assets" USING btree ("workspace_id","checksum");