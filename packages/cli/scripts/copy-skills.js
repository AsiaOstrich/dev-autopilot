/**
 * prepublishOnly 腳本：將 .claude/skills/ 中的 devap 專有 skills 複製到 packages/cli/skills/
 *
 * 用法：node packages/cli/scripts/copy-skills.js
 */

import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");

const SKILLS = ["plan", "orchestrate", "dev-workflow-guide"];
const srcBase = resolve(repoRoot, ".claude", "skills");
const destBase = resolve(__dirname, "..", "skills");

// 清除舊的 skills 目錄
if (existsSync(destBase)) {
  rmSync(destBase, { recursive: true });
}
mkdirSync(destBase, { recursive: true });

for (const skill of SKILLS) {
  const src = resolve(srcBase, skill);
  const dest = resolve(destBase, skill);

  if (!existsSync(src)) {
    console.error(`❌ 來源不存在：${src}`);
    process.exit(1);
  }

  cpSync(src, dest, { recursive: true });
  console.log(`✅ 已複製 ${skill}`);
}

console.log(`\n📦 Skills 已複製到 ${destBase}`);
