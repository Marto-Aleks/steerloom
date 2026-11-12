-- Apply after the workspace and connection migrations, as the database owner.
-- Existing memberships and workspace isolation remain in force.
begin;

-- Keep the installed Auth hook compatible while removing the pilot allowlist.
create or replace function public.steerloom_before_user_created(event jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select '{}'::jsonb;
$$;

create or replace function public.steerloom_create_workspace(workspace_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if not public.steerloom_active_user() then
    raise exception 'A verified, active account is required to create a workspace.';
  end if;
  insert into public.workspaces(name) values (trim(workspace_name)) returning id into result;
  insert into public.workspace_memberships values (result, auth.uid(), 'owner');
  return result;
end;
$$;

revoke all on function public.steerloom_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.steerloom_before_user_created(jsonb) to supabase_auth_admin;
revoke all on function public.steerloom_create_workspace(text) from public, anon, authenticated;
grant execute on function public.steerloom_create_workspace(text) to authenticated;

commit;
