-- Apply after 202610210004. Lets workspaces save Azure DevOps (Azure Boards) connections.
-- The project name and token stay inside the encrypted secret; only the provider name is new.
begin;
alter table public.workspace_connections
  drop constraint if exists workspace_connections_provider_check;
alter table public.workspace_connections
  add constraint workspace_connections_provider_check
  check (provider in ('jira', 'trello', 'azure-devops'));
commit;
