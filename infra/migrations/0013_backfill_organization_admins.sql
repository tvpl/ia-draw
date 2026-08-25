-- Custom SQL migration file, put your code below! --

-- ORG-02: backfills organization_members with exactly the set of users who hold
-- `org_admin` in some workspace of each organization today — no one gains or
-- loses access from this migration itself (spec.md AC2). `ON CONFLICT DO
-- NOTHING` dedupes a user holding `org_admin` in more than one workspace of
-- the same organization into a single row, and makes re-running this
-- migration a no-op.
insert into organization_members (organization_id, user_id)
select distinct w.organization_id, wm.user_id
from workspace_members wm
join workspaces w on w.id = wm.workspace_id
where wm.role = 'org_admin'
on conflict do nothing;
