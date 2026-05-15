/**
 * Server-local skill schema entry point.
 *
 * Zod schemas live in the shared workspace `@pragents/schema/skill` so the
 * web bundle can import them for client-side validation of skill edits.
 */
export * from '@pragents/schema/skill';
