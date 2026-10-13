import type { SupabaseClient } from "@supabase/supabase-js";

// secret key 클라이언트(createAdminClient)를 받아 서버에서만 호출한다. oncall_events에는 RLS 정책이 없다.
const UNIQUE_VIOLATION = "23505";

// 처음 보는 alert면 true, 이미 받은 alert면 false.
// 조회하지 않고 먼저 삽입해서, 동시에 온 같은 alert도 하나만 통과시킨다.
export async function claimEvent(
  supabase: SupabaseClient,
  eventId: string,
): Promise<boolean> {
  const { error } = await supabase.from("oncall_events").insert({ event_id: eventId });
  if (!error) return true;
  if (error.code === UNIQUE_VIOLATION) return false;
  throw new Error("on-call alert를 기록하지 못했어요.");
}

// CI에 넘기지 못한 alert의 기록을 지운다. 남겨 두면 PostHog의 재시도가 중복으로 버려진다.
export async function releaseEvent(
  supabase: SupabaseClient,
  eventId: string,
): Promise<void> {
  const { error } = await supabase.from("oncall_events").delete().eq("event_id", eventId);
  if (error) throw new Error("on-call alert 기록을 지우지 못했어요.");
}
