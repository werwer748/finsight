-- on-call 웹훅(/api/oncall/posthog)이 받은 PostHog alert의 멱등 키를 기록한다.
-- 핸들러가 CI에 넘기기 전에 먼저 삽입하고, 같은 alert가 다시 오면 기본 키 위반으로 중복임을 안다.
-- 사용자 데이터가 아니라서 user_id가 없다. RLS를 켜고 정책을 두지 않아 서버의 secret key로만 접근한다.

create table public.oncall_events (
  event_id text primary key check (char_length(event_id) <= 100),
  received_at timestamptz not null default now()
);

alter table public.oncall_events enable row level security;

revoke all on public.oncall_events from anon, authenticated;
grant select, insert, delete on public.oncall_events to service_role;
