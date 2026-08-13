CREATE TYPE "public"."diagram_snapshot_kind" AS ENUM('auto', 'named', 'published', 'pre_ai', 'restore_point');--> statement-breakpoint
CREATE TABLE "diagram_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diagram_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"client_mutation_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"base_revision" integer NOT NULL,
	"elements_delta_json" jsonb NOT NULL,
	"operation_summary_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagram_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diagram_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"kind" "diagram_snapshot_kind" NOT NULL,
	"name" text,
	"scene_json_key" text NOT NULL,
	"checksum" text NOT NULL,
	"created_by" uuid NOT NULL,
	"immutable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diagram_operations" ADD CONSTRAINT "diagram_operations_diagram_id_diagrams_id_fk" FOREIGN KEY ("diagram_id") REFERENCES "public"."diagrams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_operations" ADD CONSTRAINT "diagram_operations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_snapshots" ADD CONSTRAINT "diagram_snapshots_diagram_id_diagrams_id_fk" FOREIGN KEY ("diagram_id") REFERENCES "public"."diagrams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_snapshots" ADD CONSTRAINT "diagram_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "diagram_operations_diagram_client_mutation_unique" ON "diagram_operations" USING btree ("diagram_id","client_mutation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diagram_operations_diagram_sequence_unique" ON "diagram_operations" USING btree ("diagram_id","sequence");--> statement-breakpoint
CREATE INDEX "diagram_snapshots_diagram_revision_idx" ON "diagram_snapshots" USING btree ("diagram_id","revision");