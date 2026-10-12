import posthog from "posthog-js";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

// 설정이 없으면 PostHog 없이 동작한다.
if (projectToken && host) {
  posthog.init(projectToken, {
    api_host: host,
    defaults: "2026-01-30",
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
    // 화면에 나오는 거래 내역이 PostHog로 나가지 않게 글자와 요소 속성을 가린다.
    mask_all_text: true,
    mask_all_element_attributes: true,
    session_recording: { maskTextSelector: "*" },
  });
}
