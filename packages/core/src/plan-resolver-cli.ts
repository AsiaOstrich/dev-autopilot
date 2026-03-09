#!/usr/bin/env node
/**
 * Plan Resolver CLI 入口
 *
 * 讀取 plan JSON → resolvePlan() → stdout JSON
 *
 * 用法：
 *   node plan-resolver-cli.js <plan-path> [--claude-md <path>]
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolvePlan } from "./plan-resolver.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.error("用法: plan-resolver <plan.json> [--claude-md <path>]");
    console.error("");
    console.error("選項:");
    console.error("  --claude-md <path>  專案原始 CLAUDE.md 路徑");
    process.exit(1);
  }

  const planPath = resolve(args[0]);

  // 解析 --claude-md 選項
  let existingClaudeMdPath: string | undefined;
  const claudeMdIdx = args.indexOf("--claude-md");
  if (claudeMdIdx !== -1 && args[claudeMdIdx + 1]) {
    existingClaudeMdPath = resolve(args[claudeMdIdx + 1]);
  }

  try {
    const raw = await readFile(planPath, "utf-8");
    const plan = JSON.parse(raw);
    const resolved = await resolvePlan(plan, { existingClaudeMdPath });

    // JSON 輸出到 stdout
    console.log(JSON.stringify(resolved, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`錯誤：${message}`);
    process.exit(1);
  }
}

main();
