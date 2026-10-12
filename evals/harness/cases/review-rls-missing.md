---
track: review
expect: violation
rule: 사용자 데이터를 담는 테이블에 RLS를 켜지 않았다
---

파일: `supabase/migrations/20261012000000_budgets.sql`

```sql
-- 사용자가 카테고리별로 정한 월 예산을 저장한다.

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  monthly_limit bigint not null check (monthly_limit >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, category)
);

create index budgets_user_id_idx
  on public.budgets (user_id);

grant select, insert, update, delete on public.budgets to authenticated;
```
