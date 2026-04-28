// [Implements XSPEC-086 Phase 4] devap review CLI command tests
import { describe, it, expect } from "vitest";
import { createReviewCommand } from "../review.js";

describe("createReviewCommand", () => {
  it("should_register_review_command", () => {
    const cmd = createReviewCommand();
    expect(cmd.name()).toBe("review");
  });

  it("should_accept_target_argument", () => {
    const cmd = createReviewCommand();
    expect(cmd.registeredArguments.length).toBeGreaterThan(0);
    expect(cmd.registeredArguments[0]?.name()).toBe("target");
  });

  it("should_have_branch_option", () => {
    const cmd = createReviewCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--branch");
  });

  it("should_have_categories_option", () => {
    const cmd = createReviewCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--categories");
  });

  it("should_describe_8_category_review_in_help", () => {
    const cmd = createReviewCommand();
    const desc = cmd.description();
    expect(desc).toContain("8-category");
    expect(desc).toContain("XSPEC-086");
  });

  it("should_describe_outcome_types_in_help", () => {
    const cmd = createReviewCommand();
    const desc = cmd.description();
    expect(desc).toContain("report");
    expect(desc).toContain("summarize");
  });
});
