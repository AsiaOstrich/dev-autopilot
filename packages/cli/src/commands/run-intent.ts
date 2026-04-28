import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

interface PackageJson {
  scripts?: Record<string, string>;
}

const KNOWN_INTENTS: Record<string, string[]> = {
  test:     ["test", "test:unit", "test:ci", "vitest", "jest"],
  lint:     ["lint", "eslint", "lint:check"],
  build:    ["build", "compile", "tsc"],
  security: ["security", "audit", "snyk"],
  format:   ["format", "prettier", "fmt"],
  typecheck:["typecheck", "type-check", "types"],
};

function resolveCommand(intent: string, cwd: string): string | null {
  // 1. .devap/project.yaml (DevAP 自訂 intent 設定)
  const devapConfig = join(cwd, ".devap", "project.yaml");
  if (existsSync(devapConfig)) {
    try {
      const content = readFileSync(devapConfig, "utf8");
      const escapedIntent = intent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = content.match(new RegExp(`${escapedIntent}:\\s*["']?([^"'\\n]+)["']?`));
      if (match) return match[1].trim();
    } catch {
      // ignore
    }
  }

  // 2. package.json scripts
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
      const scripts = pkg.scripts ?? {};

      // 直接匹配
      if (scripts[intent]) return `npm run ${intent}`;

      // 已知 intent 的別名搜尋
      const aliases = KNOWN_INTENTS[intent] ?? [intent];
      for (const alias of aliases) {
        if (scripts[alias]) return `npm run ${alias}`;
      }
    } catch {
      // ignore
    }
  }

  // 3. Makefile targets
  const makefile = join(cwd, "Makefile");
  if (existsSync(makefile)) {
    const content = readFileSync(makefile, "utf8");
    const aliases = KNOWN_INTENTS[intent] ?? [intent];
    for (const alias of aliases) {
      if (new RegExp(`^${alias}:`, "m").test(content)) {
        return `make ${alias}`;
      }
    }
  }

  return null;
}

export function createRunIntentCommand(): Command {
  return new Command("run-intent")
    .description("解析並執行已知 intent（test / lint / build / security 等）")
    .argument("<intent>", "Intent 名稱（test | lint | build | security | format | typecheck）")
    .option("--dry-run", "只顯示解析出的命令，不執行")
    .option("--list", "列出所有已知 intent 與對應別名")
    .option("--cwd <path>", "指定工作目錄（預設：目前目錄）")
    .action((intent: string, opts: { dryRun?: boolean; list?: boolean; cwd?: string }) => {
      const cwd = resolve(opts.cwd ?? process.cwd());

      if (opts.list) {
        console.log("\n📋 devap run-intent — 已知 intent 清單\n");
        for (const [name, aliases] of Object.entries(KNOWN_INTENTS)) {
          console.log(`  ${name.padEnd(12)} → 搜尋順序：${aliases.join(", ")}`);
        }
        console.log("\n  自訂 intent 可加入 .devap/project.yaml：");
        console.log("    intents:");
        console.log("      my-intent: npm run custom-script");
        return;
      }

      const cmd = resolveCommand(intent, cwd);

      if (!cmd) {
        console.error(`❌ 無法解析 intent '${intent}'`);
        console.error(`   搜尋順序：.devap/project.yaml → package.json scripts → Makefile`);
        console.error(`   已知別名：${(KNOWN_INTENTS[intent] ?? [intent]).join(", ")}`);
        process.exit(1);
      }

      if (opts.dryRun) {
        console.log(`🔍 [dry-run] ${intent} → ${cmd}`);
        return;
      }

      console.log(`▶  ${intent} → ${cmd}`);
      const result = spawnSync(cmd, {
        shell: true,
        stdio: "inherit",
        cwd,
      });

      if (result.status !== 0) {
        process.exit(result.status ?? 1);
      }
    });
}
