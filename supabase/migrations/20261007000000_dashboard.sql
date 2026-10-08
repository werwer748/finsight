-- 거래 내역, 사용자별 가맹점 분류 캐시, 업로드 요청 기록을 만든다.
-- 로그인한 사용자는 본인 데이터만 조회·추가하며, 거래 내역만 갱신할 수 있다.
-- 업로드 기록은 최근 24시간의 요청 횟수를 세는 데만 사용한다.

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  merchant text not null,
  amount bigint not null,
  kind text not null check (kind in ('expense', 'income')),
  category text not null,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (user_id, fingerprint)
);

create index transactions_user_id_date_idx
  on public.transactions (user_id, date desc);

create table public.merchant_categories (
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant text not null,
  category text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, merchant)
);

create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index uploads_user_id_created_at_idx
  on public.uploads (user_id, created_at desc);

alter table public.transactions enable row level security;
alter table public.merchant_categories enable row level security;
alter table public.uploads enable row level security;

create policy transactions_select on public.transactions
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy transactions_insert on public.transactions
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy transactions_update on public.transactions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy merchant_categories_select on public.merchant_categories
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy merchant_categories_insert on public.merchant_categories
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy uploads_select on public.uploads
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy uploads_insert on public.uploads
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.transactions to authenticated;
grant select, insert on public.merchant_categories to authenticated;
grant select, insert on public.uploads to authenticated;
