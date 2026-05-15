/**
 * Server-local workflow schema entry point.
 *
 * Zod schemas live in the shared workspace `@pragents/schema/workflow` so the
 * web bundle can import them for client-side validation in the workflow editor.
 */
export * from '@pragents/schema/workflow';
