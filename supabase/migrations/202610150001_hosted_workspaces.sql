-- Hosted-only schema. Does not modify the local .flowlens account store.
-- Apply as the database owner. Enable the before_user_created hook separately.
begin;

create schema if not exists steerloom_private;
revoke all on schema steerloom_private from public, anon, authenticated;

create table steerloom_private.pilot_access (
  email text primary key check (email = lower(trim(email)) and length(email) between 3 and 254),
  can_create_workspace boolean not null default false,
  expires_at timestamptz not null
);
create table steerloom_private.disabled_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
create table public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  primary key (workspace_id, user_id)
);
create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (email = lower(trim(email)) and length(email) between 3 and 254),
  role text not null check (role in ('admin', 'member')),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  revoked_at timestamptz
);
create index workspace_invitation_email on public.workspace_invitations(email);
create table public.workspace_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  provider text not null check (provider in ('jira', 'trello')),
  project_key text,
  jira_edition text check (jira_edition in ('cloud', 'data-center')),
  unique (workspace_id, id)
);
-- Ciphertext only, written by the server. Browser roles have no schema access.
create table steerloom_private.connection_secrets (
  connection_id uuid primary key references public.workspace_connections(id) on delete cascade,
  encrypted_secret text not null,
  key_version integer not null check (key_version > 0)
);
create table public.workspace_dashboards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid,
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  foreign key (workspace_id, connection_id) references public.workspace_connections(workspace_id, id) on delete cascade
);

-- All helpers have fixed search paths and derive identity from validated JWTs.
create function public.steerloom_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u where u.id = auth.uid()
    and u.email_confirmed_at is not null)
    and not exists (select 1 from steerloom_private.disabled_accounts d where d.user_id = auth.uid());
$$;
create function public.steerloom_role(target uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.workspace_memberships m
  where m.workspace_id = target and m.user_id = auth.uid()
    and public.steerloom_active_user();
$$;
create function public.steerloom_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(u.email) from auth.users u where u.id = auth.uid() and public.steerloom_active_user();
$$;
create function public.steerloom_create_workspace(workspace_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if not public.steerloom_active_user() or not exists (
    select 1 from steerloom_private.pilot_access a join auth.users u on lower(u.email) = a.email
    where u.id = auth.uid() and a.can_create_workspace and a.expires_at > now()
  ) then raise exception 'Workspace creation requires pilot access.'; end if;
  insert into public.workspaces(name) values (trim(workspace_name)) returning id into result;
  insert into public.workspace_memberships values (result, auth.uid(), 'owner');
  return result;
end;
$$;
create function public.steerloom_invite(target uuid, invite_email text, invite_role text default 'member') returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid; caller_role text;
begin
  caller_role := public.steerloom_role(target);
  if caller_role is null or caller_role not in ('owner', 'admin') then
    raise exception 'Only workspace owners and admins can invite members.';
  end if;
  if invite_role not in ('admin', 'member') or invite_role is null
    or (caller_role = 'admin' and invite_role <> 'member') then
    raise exception 'Only an owner can invite an admin.';
  end if;
  if invite_email is null or length(trim(invite_email)) > 254
    or trim(invite_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid invitation email.';
  end if;
  insert into public.workspace_invitations(workspace_id, email, role, created_by)
    values(target, lower(trim(invite_email)), invite_role, auth.uid()) returning id into result;
  return result;
end;
$$;
create function public.steerloom_accept_invitation(invitation uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare invite public.workspace_invitations;
begin
  if not public.steerloom_active_user() then raise exception 'Verify your email before joining.'; end if;
  select i.* into invite from public.workspace_invitations i join auth.users u on lower(u.email) = i.email
    where i.id = invitation and u.id = auth.uid() and i.accepted_at is null
      and i.revoked_at is null and i.expires_at > now() for update of i;
  if not found then raise exception 'Invitation unavailable for this account.'; end if;
  -- Existing members never change roles by accepting another invitation.
  insert into public.workspace_memberships values (invite.workspace_id, auth.uid(), invite.role)
    on conflict (workspace_id, user_id) do nothing;
  update public.workspace_invitations set accepted_at = now(), accepted_by = auth.uid() where id = invitation;
  return invite.workspace_id;
end;
$$;
create function public.steerloom_revoke_invitation(invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare invite public.workspace_invitations;
begin
  select * into invite from public.workspace_invitations where id = invitation for update;
  if not found or coalesce(public.steerloom_role(invite.workspace_id), '') not in ('owner', 'admin')
    or (public.steerloom_role(invite.workspace_id) = 'admin' and invite.role <> 'member') then
    raise exception 'Invitation management is not permitted.';
  end if;
  update public.workspace_invitations set revoked_at = now() where id = invitation and accepted_at is null;
end;
$$;
create function public.steerloom_before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare candidate text := lower(event->'user'->>'email');
begin
  if exists (select 1 from steerloom_private.pilot_access where email = candidate and expires_at > now())
    or exists (select 1 from public.workspace_invitations where email = candidate
      and accepted_at is null and revoked_at is null and expires_at > now()) then return '{}'::jsonb; end if;
  return '{"error":{"http_code":403,"message":"Steerloom pilot access requires an invitation."}}'::jsonb;
end;
$$;

-- Serialize ownership changes for each workspace, preserving its last owner.
create function public.steerloom_set_member_role(target uuid, member_id uuid, member_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare previous_role text;
begin
  perform 1 from public.workspaces where id = target for update;
  if coalesce(public.steerloom_role(target), '') <> 'owner' then
    raise exception 'Only an owner can change workspace membership.';
  end if;
  if member_role is not null and member_role not in ('owner', 'admin', 'member') then
    raise exception 'Choose a valid workspace role.';
  end if;
  select role into previous_role from public.workspace_memberships where workspace_id = target and user_id = member_id;
  if not found then raise exception 'Workspace member not found.'; end if;
  if previous_role = 'owner' and coalesce(member_role, '') <> 'owner' and
    (select count(*) from public.workspace_memberships where workspace_id = target and role = 'owner') <= 1 then
    raise exception 'Keep at least one workspace owner.';
  end if;
  if member_role is null then
    delete from public.workspace_memberships where workspace_id = target and user_id = member_id;
  else
    update public.workspace_memberships set role = member_role where workspace_id = target and user_id = member_id;
  end if;
end;
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.workspace_connections enable row level security;
alter table public.workspace_dashboards enable row level security;
alter table steerloom_private.pilot_access enable row level security;
alter table steerloom_private.disabled_accounts enable row level security;
alter table steerloom_private.connection_secrets enable row level security;

create policy workspace_read on public.workspaces for select to authenticated using (public.steerloom_role(id) is not null);
create policy workspace_rename on public.workspaces for update to authenticated using (public.steerloom_role(id) in ('owner', 'admin')) with check (public.steerloom_role(id) in ('owner', 'admin'));
create policy membership_read on public.workspace_memberships for select to authenticated using (public.steerloom_role(workspace_id) is not null);
create policy invitation_read on public.workspace_invitations for select to authenticated using (
  public.steerloom_active_user() and (public.steerloom_role(workspace_id) in ('owner', 'admin')
    or email = public.steerloom_email())
);
create policy connection_read on public.workspace_connections for select to authenticated using (public.steerloom_role(workspace_id) is not null);
create policy dashboard_read on public.workspace_dashboards for select to authenticated using (public.steerloom_role(workspace_id) is not null);
create policy dashboard_insert on public.workspace_dashboards for insert to authenticated with check (public.steerloom_role(workspace_id) in ('owner', 'admin'));
create policy dashboard_update on public.workspace_dashboards for update to authenticated using (public.steerloom_role(workspace_id) in ('owner', 'admin')) with check (public.steerloom_role(workspace_id) in ('owner', 'admin'));
create policy dashboard_delete on public.workspace_dashboards for delete to authenticated using (public.steerloom_role(workspace_id) in ('owner', 'admin'));

revoke all on public.workspaces, public.workspace_memberships, public.workspace_invitations, public.workspace_connections, public.workspace_dashboards from anon, authenticated;
grant select on public.workspaces, public.workspace_memberships, public.workspace_invitations, public.workspace_connections, public.workspace_dashboards to authenticated;
grant update (name) on public.workspaces to authenticated;
grant insert, update, delete on public.workspace_dashboards to authenticated;
revoke all on function public.steerloom_email(), public.steerloom_active_user(), public.steerloom_role(uuid), public.steerloom_create_workspace(text), public.steerloom_invite(uuid,text,text), public.steerloom_accept_invitation(uuid), public.steerloom_revoke_invitation(uuid), public.steerloom_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.steerloom_email(), public.steerloom_active_user(), public.steerloom_role(uuid), public.steerloom_create_workspace(text), public.steerloom_invite(uuid,text,text), public.steerloom_accept_invitation(uuid), public.steerloom_revoke_invitation(uuid) to authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.steerloom_before_user_created(jsonb) to supabase_auth_admin;
revoke all on function public.steerloom_set_member_role(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.steerloom_set_member_role(uuid,uuid,text) to authenticated;

commit;
