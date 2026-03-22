import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

// Mock homedir to use temp directory
const testHome = resolve(tmpdir(), `devap-test-${Date.now()}`);
vi.mock("node:os", async () => {
  const actual = await vi.importActual("node:os");
  return {
    ...actual,
    homedir: () => testHome,
  };
});

// Dynamic import after mock setup
const { checkTermsAccepted, warnIfNoApiKey } = await import("./compliance.js");

describe("checkTermsAccepted", () => {
  beforeEach(() => {
    mkdirSync(testHome, { recursive: true });
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    delete process.env.DEVAP_ACCEPT_TERMS;
  });

  it("顯示提醒並建立標記檔（首次執行）", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    checkTermsAccepted();

    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls.map(c => c[0]).join("");
    expect(output).toContain("Anthropic API");
    expect(output).toContain("ANTHROPIC_API_KEY");

    // 標記檔已建立
    const marker = resolve(testHome, ".devap", "terms-accepted");
    expect(existsSync(marker)).toBe(true);

    spy.mockRestore();
  });

  it("已接受過則不顯示（標記檔存在）", () => {
    const devapDir = resolve(testHome, ".devap");
    mkdirSync(devapDir, { recursive: true });
    writeFileSync(resolve(devapDir, "terms-accepted"), "2026-01-01");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    checkTermsAccepted();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("DEVAP_ACCEPT_TERMS=1 靜默提醒", () => {
    process.env.DEVAP_ACCEPT_TERMS = "1";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    checkTermsAccepted();

    expect(spy).not.toHaveBeenCalled();

    // 但仍建立標記檔
    const marker = resolve(testHome, ".devap", "terms-accepted");
    expect(existsSync(marker)).toBe(true);
    spy.mockRestore();
  });

  it("--accept-terms flag 靜默提醒", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    checkTermsAccepted(true);

    expect(spy).not.toHaveBeenCalled();

    const marker = resolve(testHome, ".devap", "terms-accepted");
    expect(existsSync(marker)).toBe(true);
    spy.mockRestore();
  });
});

describe("warnIfNoApiKey", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("claude agent 且無 API key 時印出警告", () => {
    delete process.env.ANTHROPIC_API_KEY;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfNoApiKey("claude");

    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls[0][0];
    expect(output).toContain("ANTHROPIC_API_KEY");
    expect(output).toContain("Commercial Terms");
    spy.mockRestore();
  });

  it("cli agent 且無 API key 時印出警告", () => {
    delete process.env.ANTHROPIC_API_KEY;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfNoApiKey("cli");

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("有 API key 時不警告", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfNoApiKey("claude");

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("opencode agent 不檢查", () => {
    delete process.env.ANTHROPIC_API_KEY;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfNoApiKey("opencode");

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("vibeops agent 不檢查", () => {
    delete process.env.ANTHROPIC_API_KEY;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfNoApiKey("vibeops");

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
