import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const notes = pgTable('notes', {
	id: serial('id').primaryKey(),
	body: text('body').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
