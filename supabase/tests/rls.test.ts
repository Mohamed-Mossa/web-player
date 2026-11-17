// Runs the real migration in an in-process Postgres (PGlite) with a minimal Supabase auth shim,
// then checks that row-level security keeps every user's data private.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
let db: PGlite;

async function as(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${user ? 'authenticated' : 'anon'};`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role;');
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin; create role authenticated nologin;
    create publication supabase_realtime;
    insert into auth.users values ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
  `);
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  await db.exec(`
    grant usage on schema public, auth to anon, authenticated;
    grant all on all tables in schema public to authenticated;
    grant select on all tables in schema public to anon;
    grant execute on all functions in schema auth to anon, authenticated;
  `);
});

describe('row-level security', () => {
  it('users only see and change their own rows', async () => {
    await as(A, `insert into favorites (key, data) values ('p|movie|pl|1', '{"title":"A fav"}')`);
    await as(B, `insert into favorites (key, data) values ('p|movie|pl|9', '{"title":"B fav"}')`);
    expect((await as(A, 'select key from favorites')).rows).toEqual([{ key: 'p|movie|pl|1' }]);
    expect((await as(B, 'select key from favorites')).rows).toEqual([{ key: 'p|movie|pl|9' }]);
    const upd = await as(B, `update favorites set data = '{"x":1}' where key = 'p|movie|pl|1'`);
    expect(upd.affectedRows).toBe(0);
    const del = await as(B, `delete from favorites where key = 'p|movie|pl|1'`);
    expect(del.affectedRows).toBe(0);
  });

  it('cannot insert rows for another user', async () => {
    await expect(as(A, `insert into watch_progress (user_id, key, data) values ('${B}', 'k', '{}')`)).rejects.toThrow(/row-level security/);
  });

  it('anonymous visitors see nothing', async () => {
    expect((await as(null, 'select * from playlists')).rows).toEqual([]);
    expect((await as(null, 'select * from favorites')).rows).toEqual([]);
  });

  it('device codes are not readable by clients', async () => {
    await db.exec(`insert into device_codes (code, device_secret, expires_at) values ('ABC123', 's', now() + interval '10 minutes')`);
    expect((await as(A, 'select * from device_codes')).rows).toEqual([]);
  });

  it('updated_at moves forward on every write (used for incremental pulls)', async () => {
    await as(A, `insert into settings (key, data) values ('ui', '{"lang":"ar"}')`);
    const t1 = (await as(A, `select updated_at from settings where key = 'ui'`)).rows[0] as { updated_at: Date };
    await new Promise((r) => setTimeout(r, 20));
    await as(A, `update settings set data = '{"lang":"en"}' where key = 'ui'`);
    const t2 = (await as(A, `select updated_at from settings where key = 'ui'`)).rows[0] as { updated_at: Date };
    expect(new Date(t2.updated_at).getTime()).toBeGreaterThan(new Date(t1.updated_at).getTime());
  });

  it('commands can only target your own devices', async () => {
    const dev = (await as(A, `insert into devices (name, kind) values ('Living room TV', 'tv') returning id`)).rows[0] as { id: string };
    await as(A, `insert into remote_commands (target_device, command) values ($1, '{"type":"play"}')`, [dev.id]);
    expect((await as(B, 'select * from remote_commands')).rows).toEqual([]);
    expect((await as(B, 'select * from devices')).rows).toEqual([]);
  });
});
