import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LandingFooter } from "@/components/landing/footer";

describe("LandingFooter", () => {
  it("올해 연도와 FinSight가 들어간 저작권 문구를 보여준다", () => {
    render(<LandingFooter />);

    const year = new Date().getFullYear();
    expect(screen.getByText(`© ${year} FinSight`)).toBeInTheDocument();
  });
});
