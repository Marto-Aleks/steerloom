-- Apply after 202610150001. Adds server-only encrypted connection operations.
begin;
alter table public.workspace_dashboards add column dashboard_key text;
update public.workspace_dashboards set dashboard_key = coalesce(settings->>'id', id::text);
alter table public.workspace_dashboards alter column dashboard_key set not null;
alter table public.workspace_dashboards add constraint workspace_dashboard_key unique(workspace_id, dashboard_key);

create function steerloom_private.server_role(actor uuid, target uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.workspace_memberships m join auth.users u on u.id = m.user_id
  where m.user_id = actor and m.workspace_id = target and u.email_confirmed_at is not null
    and not exists(select 1 from steerloom_private.disabled_accounts d where d.user_id = actor);
$$;
revoke all on function steerloom_private.server_role(uuid,uuid) from public, anon, authenticated;

create function public.steerloom_server_connection(actor uuid, target uuid, connection uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if steerloom_private.server_role(actor, target) is null then raise exception 'Workspace access is not permitted.'; end if;
  select jsonb_build_object('encrypted', s.encrypted_secret, 'keyVersion', s.key_version) into result
    from steerloom_private.connection_secrets s join public.workspace_connections c on c.id = s.connection_id
    where c.id = connection and c.workspace_id = target;
  if result is null then raise exception 'Connection not found in this workspace.'; end if;
  return result;
end;
$$;
create function public.steerloom_server_save_connection(actor uuid, target uuid, connection uuid,
  connection_name text, provider_id text, project text, jira_kind text, ciphertext text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.workspaces where id = target for share;
  if coalesce(steerloom_private.server_role(actor, target), '') not in ('owner','admin') then raise exception 'Only owners and admins can manage connections.'; end if;
  if length(ciphertext) not between 1 and 65536 or ciphertext is null then raise exception 'Invalid encrypted credential.'; end if;
  if project is not null and project !~ '^[A-Z][A-Z0-9_]{1,29}$' then raise exception 'Invalid project key.'; end if;
  if exists(select 1 from public.workspace_connections where id = connection and workspace_id <> target) then raise exception 'Connection not found in this workspace.'; end if;
  insert into public.workspace_connections(id,workspace_id,name,provider,project_key,jira_edition)
    values(connection,target,connection_name,provider_id,project,jira_kind)
    on conflict(id) do update set name=excluded.name,provider=excluded.provider,project_key=excluded.project_key,jira_edition=excluded.jira_edition;
  insert into steerloom_private.connection_secrets values(connection,ciphertext,1)
    on conflict(connection_id) do update set encrypted_secret=excluded.encrypted_secret,key_version=excluded.key_version;
  return connection;
end;
$$;
create function public.steerloom_server_refresh_connection(actor uuid, target uuid, connection uuid, previous text, ciphertext text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  perform 1 from public.workspaces where id = target for share;
  if steerloom_private.server_role(actor, target) is null then raise exception 'Workspace access is not permitted.'; end if;
  if length(ciphertext) not between 1 and 65536 or ciphertext is null then raise exception 'Invalid encrypted credential.'; end if;
  update steerloom_private.connection_secrets s set encrypted_secret=ciphertext
    from public.workspace_connections c where s.connection_id=c.id and c.workspace_id=target and c.id=connection and s.encrypted_secret=previous;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
create function public.steerloom_server_remove_connection(actor uuid, target uuid, connection uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.workspaces where id = target for share;
  if coalesce(steerloom_private.server_role(actor, target), '') not in ('owner','admin') then raise exception 'Only owners and admins can manage connections.'; end if;
  delete from public.workspace_connections where workspace_id=target and id=connection;
end;
$$;
revoke all on function public.steerloom_server_connection(uuid,uuid,uuid), public.steerloom_server_save_connection(uuid,uuid,uuid,text,text,text,text,text), public.steerloom_server_refresh_connection(uuid,uuid,uuid,text,text), public.steerloom_server_remove_connection(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.steerloom_server_connection(uuid,uuid,uuid), public.steerloom_server_save_connection(uuid,uuid,uuid,text,text,text,text,text), public.steerloom_server_refresh_connection(uuid,uuid,uuid,text,text), public.steerloom_server_remove_connection(uuid,uuid,uuid) to service_role;
commit;
