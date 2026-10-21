---
slug: <YYYY-MM-DD-slug>
issue: <issue URL or ->
status: draft | approved
approved-by: <name, date>
---
# <Feature title>

## Goal
<2–4 sentences: the problem and who has it.>

## Done when
- <measurable criterion>

## Context
- Related knowledge: <links to knowledge/domains/*.md>
- Current behavior: <what happens today, with file:line where useful>

## Scope
| Repo / module | Change |
|---|---|

## Interfaces
<API endpoints (method, path, request, response, errors), events, CLI flags, UI screens/routes. The producer's
types are the source of truth; name the consumer types that must match.>

## Permissions
<Who may do what; new roles/scopes/guards. "N/A — <why>" if none.>

## Data
<New/changed tables, collections, fields, indexes, migrations; compatibility with existing data; backfill.>

## Out of scope
- <explicitly not done>

## Risks
- <risk> → <mitigation>
