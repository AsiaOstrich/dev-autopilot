// [Implements XSPEC-088 runtime] devap commit CLI command tests
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createCommitCommand } from "../commit.js";

describe("createCommitCommand", () => {
  it("should_register_commit_command_with_options", () => {
    const cmd = createCommitCommand();
    expect(cmd.name()).toBe("commit");

    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--message");
    expect(opts).toContain("--skip-confirm");
  });

  it("should_provide_short_alias_m_for_message", () => {
    const cmd = createCommitCommand();
    const messageOpt = cmd.options.find((o) => o.long === "--message");
    expect(messageOpt?.short).toBe("-m");
  });

  it("should_describe_3_step_flow_in_help", () => {
    const cmd = createCommitCommand();
    expect(cmd.description()).toContain("HUMAN_CONFIRM");
    expect(cmd.description()).toContain("XSPEC-088");
  });
});

describe("devap commit — guard rails", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("should_exit_when_no_staged_changes", async () => {
    // 在已知絕對沒有 staged changes 的目錄中執行
    // 用 /tmp（非 git repo）— git diff --cached 會失敗 → checkStagedChanges 回 false
    const originalCwd = process.cwd();
    process.chdir("/tmp");
    try {
      const cmd = createCommitCommand();
      await expect(
        cmd.parseAsync(["node", "commit", "-m", "feat: nope", "--skip-confirm"])
      ).rejects.toThrow("process.exit(1)");

      const errors = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(errors).toContain("沒有 staged 變更");
    } finally {
      process.chdir(originalCwd);
    }
  });
});

// 注意：實際 git commit 路徑的測試需要建立 temp git repo + staged change，
// 較適合放在 integration test 層；此處僅驗證命令註冊與守衛邏輯。
