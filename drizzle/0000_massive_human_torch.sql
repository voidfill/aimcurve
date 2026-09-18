CREATE TABLE "notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
