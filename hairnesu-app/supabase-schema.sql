-- 配線表アプリ用 Supabase スキーマ
-- Supabase ダッシュボード -> SQL Editor に貼り付けて実行してください。

create extension if not exists "pgcrypto";

-- 配線表(シート)
create table if not exists public.sheets (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 配線行(接続一覧の各行)
create table if not exists public.wire_rows (
  id uuid primary key,
  sheet_id uuid not null references public.sheets(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  "order" integer not null default 0,
  terminal_no text default '',
  to_location text default '',
  to_terminal text default '',
  cable_type text default '',
  cable_no text default '',
  length text default '',
  color text default '',
  note text default '',
  updated_at timestamptz not null default now()
);

create index if not exists wire_rows_sheet_id_idx on public.wire_rows (sheet_id);
create index if not exists sheets_user_id_idx on public.sheets (user_id);
create index if not exists wire_rows_user_id_idx on public.wire_rows (user_id);

-- Row Level Security: 自分のデータのみ読み書きできる
alter table public.sheets enable row level security;
alter table public.wire_rows enable row level security;

drop policy if exists "sheets_select_own" on public.sheets;
create policy "sheets_select_own" on public.sheets for select using (auth.uid() = user_id);
drop policy if exists "sheets_insert_own" on public.sheets;
create policy "sheets_insert_own" on public.sheets for insert with check (auth.uid() = user_id);
drop policy if exists "sheets_update_own" on public.sheets;
create policy "sheets_update_own" on public.sheets for update using (auth.uid() = user_id);
drop policy if exists "sheets_delete_own" on public.sheets;
create policy "sheets_delete_own" on public.sheets for delete using (auth.uid() = user_id);

drop policy if exists "wire_rows_select_own" on public.wire_rows;
create policy "wire_rows_select_own" on public.wire_rows for select using (auth.uid() = user_id);
drop policy if exists "wire_rows_insert_own" on public.wire_rows;
create policy "wire_rows_insert_own" on public.wire_rows for insert with check (auth.uid() = user_id);
drop policy if exists "wire_rows_update_own" on public.wire_rows;
create policy "wire_rows_update_own" on public.wire_rows for update using (auth.uid() = user_id);
drop policy if exists "wire_rows_delete_own" on public.wire_rows;
create policy "wire_rows_delete_own" on public.wire_rows for delete using (auth.uid() = user_id);
