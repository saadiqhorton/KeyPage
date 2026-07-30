# Issue tracker: Linear

Issues and specs for this repo live in **Linear**.

- **Workspace team:** Saadiqhorton (`SAA`)
- **Project:** KeyPage
- **Tooling:** Linear MCP (`plugin-linear-linear`)

## Conventions

- Specs (`/to-spec`) and tickets (`/to-tickets`) are Linear issues on team **Saadiqhorton**, attached to project **KeyPage** when possible.
- Triage state is recorded with Linear labels (see `docs/agents/triage-labels.md`).
- Prefer issue identifiers like `SAA-113` in commits and conversation.

## When a skill says "publish to the issue tracker"

1. Create or update an issue with `save_issue` (team: `Saadiqhorton`, project: `KeyPage`).
2. Apply the appropriate triage label (usually `ready-for-agent` for specs/tickets produced by engineering skills).
3. Return the issue URL and identifier to the user.

## When a skill says "fetch the relevant ticket"

Use `get_issue` with the issue ID or identifier (e.g. `SAA-113`), or `list_issues` filtered by team/project/label.

## Wayfinding operations

Used by `/wayfinder`. Express the map and tickets as Linear issues:

- **Map**: a parent issue labelled `wayfinder:map` (create the label if missing), in project KeyPage.
- **Child tickets**: sub-issues of the map (`parentId` on `save_issue`). Use labels or a `Type:` line in the body for `research` / `prototype` / `grilling` / `task`.
- **Blocking**: use Linear `blockedBy` / `blocks` relations on `save_issue`.
- **Frontier**: `list_issues` for open children of the map that are unblocked and not claimed; lowest identifier wins.
- **Claim / resolve**: comment on the issue and update status/labels; append the decision gist to the map issue body or a comment.

## PRs as a request surface

**PRs as a request surface: no.**
