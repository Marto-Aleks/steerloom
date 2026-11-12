-- Apply after 202610160003. Stores one encrypted AI provider key per workspace.
-- Only the server (service_role) can read or change it; members see provider and model through the server.
begin;
create table steerloom_private.workspace_ai (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('anthropic','openai','custom')),
  model text not null check (length(model) between 1 and 100),
  endpoint_host text check (endpoint_host is null or length(endpoint_host) <= 255),
  encrypted_secret text not null check (length(encrypted_secret) between 1 and 65536),
  key_version integer not null default 1
);
alter table steerloom_private.workspace_ai enable row level security;
revoke all on steerloom_private.workspace_ai from public, anon, authenticated;

create function public.steerloom_server_ai(actor uuid, target uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if steerloom_private.server_role(actor, target) is null then raise exception 'Workspace access is not permitted.'; end if;
  select jsonb_build_object('provider', a.provider, 'model', a.model, 'endpointHost', a.endpoint_host,
      'encrypted', a.encrypted_secret, 'keyVersion', a.key_version) into result
    from steerloom_private.workspace_ai a where a.workspace_id = target;
  return result;
end;
$$;
create function public.steerloom_server_save_ai(actor uuid, target uuid, provider_id text, model_name text,
  host text, ciphertext text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.workspaces where id = target for share;
  if coalesce(steerloom_private.server_role(actor, target), '') not in ('owner','admin') then raise exception 'Only owners and admins can manage the AI key.'; end if;
  insert into steerloom_private.workspace_ai(workspace_id, provider, model, endpoint_host, encrypted_secret, key_version)
    values(target, provider_id, model_name, host, ciphertext, 1)
    on conflict(workspace_id) do update set provider=excluded.provider, model=excluded.model,
      endpoint_host=excluded.endpoint_host, encrypted_secret=excluded.encrypted_secret, key_version=excluded.key_version;
end;
$$;
create function public.steerloom_server_remove_ai(actor uuid, target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.workspaces where id = target for share;
  if coalesce(steerloom_private.server_role(actor, target), '') not in ('owner','admin') then raise exception 'Only owners and admins can manage the AI key.'; end if;
  delete from steerloom_private.workspace_ai where workspace_id = target;
end;
$$;
revoke all on function public.steerloom_server_ai(uuid,uuid), public.steerloom_server_save_ai(uuid,uuid,text,text,text,text), public.steerloom_server_remove_ai(uuid,uuid) from public, anon, authenticated;
grant execute on function public.steerloom_server_ai(uuid,uuid), public.steerloom_server_save_ai(uuid,uuid,text,text,text,text), public.steerloom_server_remove_ai(uuid,uuid) to service_role;
commit;
