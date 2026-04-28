import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAutoSweep } from "../auto-sweep.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "sweep-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeTS(name: string, content: string): Promise<string> {
  const p = join(tmpDir, name);
  await writeFile(p, content, "utf8");
  return p;
}

describe("runAutoSweep", () => {
  it("returns zero findings for clean file", async () => {
    await writeTS("clean.ts", 'const x = "hello";\nconsole.error("legit error");\n');
    const result = await runAutoSweep({ cwd: tmpDir });
    expect(result.findings).toHaveLength(0);
    expect(result.scannedFiles).toBe(1);
  });

  it("detects console.log", async () => {
    await writeTS("dirty.ts", 'const x = 1;\nconsole.log("debug", x);\n');
    const result = await runAutoSweep({ cwd: tmpDir });
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    const f = result.findings.find((f) => f.patternId === "console-log");
    expect(f).toBeDefined();
    expect(f?.line).toBe(2);
  });

  it("detects debugger statement", async () => {
    await writeTS("debug.ts", "function foo() {\n  debugger;\n  return 1;\n}\n");
    const result = await runAutoSweep({ cwd: tmpDir });
    const f = result.findings.find((f) => f.patternId === "debugger");
    expect(f).toBeDefined();
    expect(f?.line).toBe(2);
  });

  it("detects TODO comment", async () => {
    await writeTS("todo.ts", "// TODO: fix this later\nconst x = 1;\n");
    const result = await runAutoSweep({ cwd: tmpDir });
    const f = result.findings.find((f) => f.patternId === "todo-fixme");
    expect(f).toBeDefined();
  });

  it("detects TypeScript any", async () => {
    await writeTS("anytype.ts", "function foo(x: any): any { return x; }\n");
    const result = await runAutoSweep({ cwd: tmpDir });
    const anyFindings = result.findings.filter((f) => f.patternId === "ts-any");
    expect(anyFindings.length).toBeGreaterThanOrEqual(1);
  });

  it("fixes console.log when --fix is set", async () => {
    const { readFile } = await import("node:fs/promises");
    await writeTS("fixable.ts", 'const x = 1;\nconsole.log("remove me");\nconst y = 2;\n');
    const result = await runAutoSweep({ cwd: tmpDir, fix: true });
    expect(result.fixed).toBeGreaterThanOrEqual(1);
    const content = await readFile(join(tmpDir, "fixable.ts"), "utf8");
    expect(content).not.toContain("console.log");
    expect(content).toContain("const x = 1");
    expect(content).toContain("const y = 2");
  });

  it("fixes debugger statement when --fix is set", async () => {
    const { readFile } = await import("node:fs/promises");
    await writeTS("fixdebug.ts", "function foo() {\n  debugger;\n  return 1;\n}\n");
    const result = await runAutoSweep({ cwd: tmpDir, fix: true });
    expect(result.fixed).toBeGreaterThanOrEqual(1);
    const content = await readFile(join(tmpDir, "fixdebug.ts"), "utf8");
    expect(content).not.toContain("debugger");
    expect(content).toContain("return 1");
  });

  it("does not fix TODO or any (non-fixable patterns)", async () => {
    const { readFile } = await import("node:fs/promises");
    await writeTS("nofixable.ts", "// TODO: review\nfunction foo(x: any) { return x; }\n");
    const result = await runAutoSweep({ cwd: tmpDir, fix: true });
    const content = await readFile(join(tmpDir, "nofixable.ts"), "utf8");
    expect(content).toContain("TODO");
    expect(content).toContain("any");
    const f = result.findings.filter((f) => !f.fixable);
    expect(f.length).toBeGreaterThan(0);
  });

  it("filters by pattern id when patterns option given", async () => {
    await writeTS("multi.ts", 'console.log("x");\n// TODO: later\n');
    const result = await runAutoSweep({ cwd: tmpDir, patterns: ["console-log"] });
    expect(result.findings.every((f) => f.patternId === "console-log")).toBe(true);
    expect(result.skippedPatterns).toContain("todo-fixme");
  });

  it("excludes node_modules by default", async () => {
    await mkdir(join(tmpDir, "node_modules", "lib"), { recursive: true });
    await writeFile(join(tmpDir, "node_modules", "lib", "index.ts"), 'console.log("pkg");\n');
    const result = await runAutoSweep({ cwd: tmpDir });
    expect(result.findings.every((f) => !f.file.includes("node_modules"))).toBe(true);
  });

  it("reports file path relative to cwd", async () => {
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src", "main.ts"), 'console.log("x");\n');
    const result = await runAutoSweep({ cwd: tmpDir });
    const f = result.findings.find((f) => f.patternId === "console-log");
    expect(f?.file).toBe("src/main.ts");
  });
});
