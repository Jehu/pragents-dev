# Accessibility Walkthrough

VoiceOver tested on Overview, Inbox, Agents — all landmarks reachable.

## Landmark structure

- `<header role="banner">` — top app bar with logo, project picker, ⌘K trigger
- `<nav aria-label="Primary navigation">` — left sidebar with all 14 routes
- `<main role="main">` — page content outlet

## Component notes

- **StatusPill** — `aria-label={status}` ensures color is not the sole carrier of information
- **ApprovalCard** — `aria-busy={isLoading}` signals pending mutations to screen readers
- **CommandPalette** — `role="dialog" aria-modal="true" aria-label="Command palette"`; ESC closes

## Keyboard flows

| Action | Keys |
|--------|------|
| Open command palette | ⌘K / Ctrl+K |
| Close command palette | Esc |
| Navigate palette items | ↑ / ↓ |
| Activate palette item | Enter |
| Send chat message | Enter (Shift+Enter for newline) |

## axe-core coverage

`web/src/a11y.test.tsx` — automated checks on StatusPill, ApprovalCard, EmptyState.
