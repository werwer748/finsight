import { afterEach, describe, expect, it, vi } from "vitest";

const init = vi.hoisted(() => vi.fn());

vi.mock("posthog-js", () => ({ default: { init } }));

// 파일을 불러오는 순간 초기화하므로 환경변수를 바꾼 뒤 새로 불러온다.
async function load(env: Record<string, string>): Promise<void> {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
  Object.entries(env).forEach(([name, value]) => vi.stubEnv(name, value));
  vi.resetModules();
  await import("./instrumentation-client");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("PostHog 브라우저 초기화", () => {
  it("화면 글자와 요소 속성을 가리는 옵션으로 초기화한다", async () => {
    await load({
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_test",
      NEXT_PUBLIC_POSTHOG_HOST: "https://posthog.example",
    });

    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        api_host: "https://posthog.example",
        mask_all_text: true,
        mask_all_element_attributes: true,
        session_recording: { maskTextSelector: "*" },
      }),
    );
  });

  it.each(["NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "NEXT_PUBLIC_POSTHOG_HOST"])(
    "개발 환경에서 %s 가 없으면 예외 없이 초기화를 건너뛴다",
    async (missing) => {
      const env = {
        NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_test",
        NEXT_PUBLIC_POSTHOG_HOST: "https://posthog.example",
        NODE_ENV: "development",
        [missing]: "",
      };

      await expect(load(env)).resolves.toBeUndefined();

      expect(init).not.toHaveBeenCalled();
    },
  );
});
