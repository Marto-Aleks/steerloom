// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'

let db: PGlite
const owner = '10000000-0000-4000-8000-000000000001'
const outsider = '10000000-0000-4000-8000-000000000002'
const member = '10000000-0000-4000-8000-000000000003'
const guest = '10000000-0000-4000-8000-000000000004'
const first = '20000000-0000-4000-8000-000000000001'
const second = '20000000-0000-4000-8000-000000000002'
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role supabase_auth_admin; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `)
  await db.exec(
    readFileSync(
      new URL(
        '../../supabase/migrations/202610150001_hosted_workspaces.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  await db.exec(
    readFileSync(
      new URL(
        '../../supabase/migrations/202610160002_workspace_connections.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  await db.exec(
    readFileSync(
      new URL(
        '../../supabase/migrations/202610160003_open_registration.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  await db.exec(`
    insert into auth.users values
      ('${owner}', 'owner@example.invalid', now()), ('${outsider}', 'outside@example.invalid', now()),
      ('${member}', 'member@example.invalid', now()), ('${guest}', 'guest@example.invalid', now());
    insert into public.workspaces(id, name) values ('${first}', 'Team one'), ('${second}', 'Team two');
    insert into public.workspace_memberships values ('${first}', '${owner}', 'owner'), ('${first}', '${member}', 'member'), ('${second}', '${outsider}', 'owner');
    insert into public.workspace_connections(id, workspace_id, name, provider) values ('30000000-0000-4000-8000-000000000001', '${first}', 'Fictional connection', 'trello');
    insert into steerloom_private.connection_secrets values ('30000000-0000-4000-8000-000000000001', 'fictional-ciphertext', 1);
  `)
}, 30000)
beforeEach(async () => {
  await db.exec('begin')
})
afterEach(async () => {
  await db.exec('rollback')
})
afterAll(async () => {
  await db.close()
})
async function asUser(id: string) {
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id])
  await db.exec('set local role authenticated')
}

it('isolates workspace and connector metadata using database RLS', async () => {
  await asUser(member)
  expect((await db.query('select name from public.workspaces')).rows).toEqual([
    { name: 'Team one' },
  ])
  expect(
    (await db.query('select name from public.workspace_connections')).rows,
  ).toEqual([{ name: 'Fictional connection' }])
  expect(
    (
      await db.query(
        'select * from public.workspace_memberships where workspace_id = $1',
        [second],
      )
    ).rows,
  ).toEqual([])
})
it('denies browser roles all access to encrypted secrets', async () => {
  await asUser(owner)
  await expect(
    db.query('select * from steerloom_private.connection_secrets'),
  ).rejects.toThrow(/permission denied/)
})
it('rejects self-promotion through direct membership mutations', async () => {
  await asUser(member)
  await expect(
    db.query(
      "update public.workspace_memberships set role = 'owner' where user_id = $1",
      [member],
    ),
  ).rejects.toThrow(/permission denied/)
})
it('lets a verified account create a workspace without pilot approval and become its owner', async () => {
  await asUser(owner)
  const result = await db.query<{ id: string }>(
    "select public.steerloom_create_workspace('New team') as id",
  )
  const id = result.rows[0]!.id
  expect(
    (await db.query('select public.steerloom_role($1) as role', [id])).rows,
  ).toEqual([{ role: 'owner' }])
})
it('lets a team member create a separate workspace without sharing it with their team', async () => {
  await asUser(member)
  const { rows } = await db.query<{ id: string }>(
    "select public.steerloom_create_workspace('My own team') as id",
  )
  const id = rows[0]!.id
  expect(
    (
      await db.query(
        'select user_id, role from public.workspace_memberships where workspace_id = $1',
        [id],
      )
    ).rows,
  ).toEqual([{ user_id: member, role: 'owner' }])
  await asUser(owner)
  expect(
    (await db.query('select * from public.workspaces where id = $1', [id]))
      .rows,
  ).toEqual([])
  await asUser(guest)
  expect(
    (await db.query('select * from public.workspaces where id = $1', [id]))
      .rows,
  ).toEqual([])
})
it.each(['unconfirmed', 'disabled', 'missing'])(
  'rejects workspace creation by an %s account',
  async (state) => {
    if (state === 'unconfirmed')
      await db.query(
        'update auth.users set email_confirmed_at = null where id = $1',
        [guest],
      )
    if (state === 'disabled')
      await db.query(
        'insert into steerloom_private.disabled_accounts values ($1)',
        [guest],
      )
    await asUser(
      state === 'missing' ? '10000000-0000-4000-8000-000000000099' : guest,
    )
    await expect(
      db.query("select public.steerloom_create_workspace('Unavailable')"),
    ).rejects.toThrow(/verified, active account/)
  },
)
it('denies anonymous workspace creation', async () => {
  await db.exec('set local role anon')
  await expect(
    db.query("select public.steerloom_create_workspace('Unavailable')"),
  ).rejects.toThrow(/permission denied/)
})
it('allows an invitation only for its verified email and only once', async () => {
  await asUser(owner)
  const { rows } = await db.query<{ id: string }>(
    'select public.steerloom_invite($1, $2) as id',
    [first, 'GUEST@example.invalid'],
  )
  const id = rows[0]!.id
  await asUser(guest)
  expect(
    (await db.query('select id from public.workspace_invitations')).rows,
  ).toEqual([{ id }])
  await db.query('select public.steerloom_accept_invitation($1)', [id])
  expect(
    (await db.query('select public.steerloom_role($1) as role', [first])).rows,
  ).toEqual([{ role: 'member' }])
  await expect(
    db.query('select public.steerloom_accept_invitation($1)', [id]),
  ).rejects.toThrow(/unavailable/)
})
it('does not let a different email accept an invitation', async () => {
  await asUser(owner)
  const result = await db.query<{ id: string }>(
    'select public.steerloom_invite($1, $2) as id',
    [first, 'guest@example.invalid'],
  )
  await asUser(outsider)
  await expect(
    db.query('select public.steerloom_accept_invitation($1)', [
      result.rows[0]!.id,
    ]),
  ).rejects.toThrow(/unavailable/)
})
it('blocks expired or revoked invitations', async () => {
  await asUser(owner)
  const result = await db.query<{ id: string }>(
    'select public.steerloom_invite($1, $2) as id',
    [first, 'guest@example.invalid'],
  )
  await db.query('select public.steerloom_revoke_invitation($1)', [
    result.rows[0]!.id,
  ])
  await asUser(guest)
  await expect(
    db.query('select public.steerloom_accept_invitation($1)', [
      result.rows[0]!.id,
    ]),
  ).rejects.toThrow(/unavailable/)
})
it('allows a new email through the installed signup hook without approval or invitation', async () => {
  await db.exec('set local role supabase_auth_admin')
  const result = await db.query<{ result: unknown }>(
    'select public.steerloom_before_user_created($1) as result',
    [{ user: { email: 'uninvited@example.invalid' } }],
  )
  expect(result.rows[0]!.result).toEqual({})
})
it('disables access immediately for a blocked account', async () => {
  await db.query(
    'insert into steerloom_private.disabled_accounts values ($1)',
    [owner],
  )
  await asUser(owner)
  expect((await db.query('select * from public.workspaces')).rows).toEqual([])
  await expect(
    db.query('select public.steerloom_invite($1, $2)', [
      first,
      'guest@example.invalid',
    ]),
  ).rejects.toThrow(/Only workspace/)
})
it('requires confirmed email before accessing a workspace', async () => {
  await db.query(
    'update auth.users set email_confirmed_at = null where id = $1',
    [owner],
  )
  await asUser(owner)
  expect((await db.query('select * from public.workspaces')).rows).toEqual([])
})
it('denies anonymous access', async () => {
  await db.exec('set local role anon')
  await expect(db.query('select * from public.workspaces')).rejects.toThrow(
    /permission denied/,
  )
})

it('prevents members from issuing invitations', async () => {
  await asUser(member)
  await expect(
    db.query('select public.steerloom_invite($1, $2)', [
      first,
      'guest@example.invalid',
    ]),
  ).rejects.toThrow(/Only workspace/)
})
it('allows owners to manage roles and revoke membership', async () => {
  await asUser(owner)
  await db.query('select public.steerloom_set_member_role($1, $2, $3)', [
    first,
    member,
    'admin',
  ])
  await asUser(member)
  expect(
    (await db.query('select public.steerloom_role($1) as role', [first])).rows,
  ).toEqual([{ role: 'admin' }])
  await asUser(owner)
  await db.query('select public.steerloom_set_member_role($1, $2, null)', [
    first,
    member,
  ])
  await asUser(member)
  expect((await db.query('select * from public.workspaces')).rows).toEqual([])
})
it('preserves the last workspace owner', async () => {
  await asUser(owner)
  await expect(
    db.query('select public.steerloom_set_member_role($1, $2, null)', [
      first,
      owner,
    ]),
  ).rejects.toThrow(/at least one/)
})
it('prevents admins from granting admin access', async () => {
  await db.query(
    "update public.workspace_memberships set role = 'admin' where user_id = $1",
    [member],
  )
  await asUser(member)
  await expect(
    db.query('select public.steerloom_invite($1, $2, $3)', [
      first,
      'guest@example.invalid',
      'admin',
    ]),
  ).rejects.toThrow(/Only an owner/)
})
it('allows signup but still rejects membership through an expired invitation', async () => {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.workspace_invitations(workspace_id,email,role,created_by,expires_at) values ($1,$2,$3,$4,now() - interval '1 day') returning id",
    [first, 'guest@example.invalid', 'member', owner],
  )
  await db.exec('set local role supabase_auth_admin')
  const result = await db.query<{ result: unknown }>(
    'select public.steerloom_before_user_created($1) as result',
    [{ user: { email: 'guest@example.invalid' } }],
  )
  expect(result.rows[0]!.result).toEqual({})
  await asUser(guest)
  await expect(
    db.query('select public.steerloom_accept_invitation($1)', [rows[0]!.id]),
  ).rejects.toThrow(/unavailable/)
})

it('denies authenticated clients the server credential RPC even with a forged actor', async () => {
  await asUser(member)
  await expect(
    db.query('select public.steerloom_server_connection($1,$2,$3)', [
      owner,
      first,
      '30000000-0000-4000-8000-000000000001',
    ]),
  ).rejects.toThrow(/permission denied/)
})
it('authorizes server credential reads by workspace and current membership', async () => {
  await db.exec('set local role service_role')
  const result = await db.query<{ secret: { encrypted: string } }>(
    'select public.steerloom_server_connection($1,$2,$3) as secret',
    [member, first, '30000000-0000-4000-8000-000000000001'],
  )
  expect(result.rows[0]!.secret.encrypted).toBe('fictional-ciphertext')
  await expect(
    db.query('select public.steerloom_server_connection($1,$2,$3)', [
      outsider,
      first,
      '30000000-0000-4000-8000-000000000001',
    ]),
  ).rejects.toThrow(/not permitted/)
})
it('blocks members from storing connections even through the server RPC', async () => {
  await db.exec('set local role service_role')
  await expect(
    db.query(
      'select public.steerloom_server_save_connection($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        member,
        first,
        '30000000-0000-4000-8000-000000000002',
        'Fictional',
        'trello',
        null,
        null,
        'encrypted',
      ],
    ),
  ).rejects.toThrow(/Only owners/)
})
it('atomically stores encrypted credentials and cascades dashboard removal on disconnect', async () => {
  const connection = '30000000-0000-4000-8000-000000000002'
  await db.exec('set local role service_role')
  await db.query(
    'select public.steerloom_server_save_connection($1,$2,$3,$4,$5,$6,$7,$8)',
    [owner, first, connection, 'Fictional', 'trello', null, null, 'encrypted'],
  )
  await db.exec('reset role')
  await db.query(
    'insert into public.workspace_dashboards(workspace_id,connection_id,settings,dashboard_key) values($1,$2,$3,$4)',
    [first, connection, { id: 'demo' }, 'demo'],
  )
  await db.exec('set local role service_role')
  await db.query('select public.steerloom_server_remove_connection($1,$2,$3)', [
    owner,
    first,
    connection,
  ])
  await db.exec('reset role')
  expect(
    (
      await db.query(
        'select * from public.workspace_dashboards where connection_id=$1',
        [connection],
      )
    ).rows,
  ).toEqual([])
  expect(
    (
      await db.query(
        'select * from steerloom_private.connection_secrets where connection_id=$1',
        [connection],
      )
    ).rows,
  ).toEqual([])
})
it('rejects a credential refresh after replacement instead of overwriting it', async () => {
  const connection = '30000000-0000-4000-8000-000000000001'
  await db.exec('set local role service_role')
  expect(
    (
      await db.query(
        'select public.steerloom_server_refresh_connection($1,$2,$3,$4,$5) as changed',
        [member, first, connection, 'stale-ciphertext', 'new-ciphertext'],
      )
    ).rows,
  ).toEqual([{ changed: false }])
})
it('does not allow a connection from another workspace to be attached to a dashboard', async () => {
  await asUser(outsider)
  await expect(
    db.query(
      'insert into public.workspace_dashboards(workspace_id,connection_id,settings,dashboard_key) values($1,$2,$3,$4)',
      [second, '30000000-0000-4000-8000-000000000001', {}, 'forged'],
    ),
  ).rejects.toThrow(/foreign key/)
})
