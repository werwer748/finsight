import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "@/components/ui/card";

describe("Card", () => {
  it("자식 내용을 렌더링한다", () => {
    render(
      <Card>
        <p>총 지출</p>
      </Card>,
    );

    expect(screen.getByText("총 지출")).toBeInTheDocument();
  });
});
