---
title: API response shape change silently breaks Array.isArray consumers
date: 2026-05-09
category: docs/solutions/integration-issues
module: agent-platform
problem_type: integration_issue
component: development_workflow
symptoms:
  - "feed tests fail with 500 / 'Internal Server Error' after changing response shape"
  - "dashboard task list renders empty after API response format change"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags:
  - api-contract
  - response-shape
  - breaking-change
  - array-vs-object
  - typescript
  - hono
---

# API response shape change silently breaks Array.isArray consumers

## Problem

`GET /api/v1/tasks` was changed from returning a bare array `[...tasks]` to a wrapped object `{ tasks: [...], total: N, page: P, limit: L }` to support pagination. Multiple frontend consumers used `Array.isArray(tasks)` to guard against empty API responses, which silently evaluated to `false` for the new object shape — showing "No tasks" even when data existed.

## Root Cause

The API response shape was changed in the backend (`server/src/api/routes/tasks.ts`) without a corresponding update to all frontend consumers. `Array.isArray()` is a common defensive pattern in TypeScript for handling API responses, but it's fragile: it silently fails when the shape changes from array to object.

## Solution

**1. Update all consumers to handle the new shape:**

```typescript
// Before (broken — Array.isArray returns false for { tasks: [...] })
const tasks = Array.isArray(data) ? data : [];

// After (handles both old and new shapes during migration)
const tasks = Array.isArray(data?.tasks) ? data.tasks : Array.isArray(data) ? data : [];
```

**2. For new endpoints, prefer a consistent wrapped response shape with explicit consumer migration:**

```typescript
// Backend: always wrap in an object
return c.json({ tasks: paginated, total, page, limit });

// Frontend: destructure from the wrapper
const { data } = useQuery({ queryKey: ['tasks'], queryFn: () => fetch('/api/v1/tasks').then(r => r.json()) });
const tasks = data?.tasks || [];
```

## Why This Matters

`Array.isArray()` is not a type guard in the TypeScript sense — it's a runtime check with no compiler enforcement. When the API shape changes, the guard silently fails. This pattern appears frequently in JavaScript/TypeScript codebases that consume REST APIs without generated client types.

The same pattern caused breakage in two additional places in the same PR: the legacy `main.tsx` entry point and auto-generated `routeTree.gen.ts`, both of which used `Array.isArray(tasks)`.

## Prevention

- When adding pagination or wrapping to an existing endpoint, grep for all consumers of that endpoint and update them in the same commit
- Consider using Zod or a similar runtime validation library on the frontend to catch shape mismatches at the point of consumption rather than silently
- If a migration period is needed, make the endpoint support both shapes via a query parameter (`?format=legacy`) until all consumers are updated
