# Why this directory outlives its route

`/dashboard/invoices/[id]` was rebuilt on Counter and its `page.tsx` deleted.
`pdf-viewer-client.tsx` and `pdf-viewer.tsx` stayed, because the ingredient-audit
monitoring page imports the client viewer:

    src/app/dashboard/(editorial)/admin/monitoring/ingredient-audit/ingredient-audit-client.tsx:22

Repointing that import would edit a file under `src/app/dashboard/**`, and the
Counter linter keys its legacy exemption to a file's bytes being unchanged — a
one-line import change would demand a full Counter rebuild of a monitoring page
nobody asked for. Same reasoning as the `ingredient-picker-utils` shim.

A directory with no `page.tsx` is not a route, so nothing here is reachable.
Delete it when the ingredient-audit page is rebuilt.
