/**
 * Spec Compliance Gate — XSPEC-090
 *
 * 在 Agent 派遣前確認對應的 XSPEC 已存在且狀態為 Approved/Implemented。
 * strict 模式（預設）：找不到 Approved XSPEC → 拒絕執行（exit 1）
 * warn 模式：找不到 → 警告但繼續
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

export type XspecStatus =
  | "Approved"
  | "Implemented"
  | "Draft"
  | "Review"
  | "Archived"
  | "In Progress"
  | "unknown";

export type SpecGateMode = "strict" | "warn";

export interface SpecMatch {
  xspecId: string;
  title: string;
  status: XspecStatus;
  filePath: string;
  score: number;
}

export interface SpecGateOptions {
  taskDescription: string;
  specPaths: string[];
  mode: SpecGateMode;
}

export interface SpecGateResult {
  passed: boolean;
  mode: SpecGateMode;
  match?: SpecMatch;
  reason: string;
}

const APPROVED_STATUSES: XspecStatus[] = ["Approved", "Implemented"];

function extractStatus(content: string): XspecStatus {
  const match =
    content.match(/\*\*狀態\*\*:\s*([^\n|]+)/i) ||
    content.match(/\*\*Status\*\*:\s*([^\n|]+)/i);
  if (!match) return "unknown";
  const raw = match[1].trim().split(/\s+/)[0];
  if (raw.includes("Approved")) return "Approved";
  if (raw.includes("Implemented")) return "Implemented";
  if (raw.includes("Draft")) return "Draft";
  if (raw.includes("Review")) return "Review";
  if (raw.includes("Archived")) return "Archived";
  if (raw.includes("Progress")) return "In Progress";
  return "unknown";
}

function extractXspecId(filename: string): string | null {
  const match = filename.match(/^(XSPEC-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

function extractTitle(content: string): string {
  const match = content.match(/^#\s+\[XSPEC-\d+\]\s+(?:Feature:\s*)?(.+)/m);
  return match ? match[1].trim() : "";
}

const STOP_WORDS = new Set([
  "implement", "implements", "add", "create", "build", "make",
  "update", "with", "from", "into", "using", "that", "this",
  "some", "need", "want", "have", "feature", "support",
]);

function scoreMatch(
  taskDescription: string,
  title: string,
  content: string
): number {
  const taskWords = taskDescription
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  if (taskWords.length === 0) return 0;

  const searchText = (title + " " + content.slice(0, 2000)).toLowerCase();
  let hits = 0;
  for (const word of taskWords) {
    // whole-word match to avoid "implement" matching "Implemented"
    if (new RegExp(`\\b${word}\\b`).test(searchText)) hits++;
  }
  return hits / taskWords.length;
}

export async function checkSpecGate(
  opts: SpecGateOptions
): Promise<SpecGateResult> {
  const { taskDescription, specPaths, mode } = opts;
  const candidates: SpecMatch[] = [];

  for (const dir of specPaths) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!/^XSPEC-\d+.*\.md$/i.test(entry)) continue;
      const xspecId = extractXspecId(entry);
      if (!xspecId) continue;

      const filePath = join(dir, entry);
      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch {
        continue;
      }

      const status = extractStatus(content);
      const title = extractTitle(content);
      const score = scoreMatch(taskDescription, title, content);
      if (score > 0) {
        candidates.push({ xspecId, title, status, filePath, score });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const approvedMatch = candidates.find((c) =>
    APPROVED_STATUSES.includes(c.status)
  );
  if (approvedMatch) {
    return {
      passed: true,
      mode,
      match: approvedMatch,
      reason: `找到 Approved XSPEC：${approvedMatch.xspecId} — ${approvedMatch.title}`,
    };
  }

  const draftMatch = candidates.find((c) => c.status === "Draft");
  if (draftMatch) {
    const msg = `${draftMatch.xspecId} 仍為 Draft 狀態，需核准後才能開始實作`;
    if (mode === "strict") {
      return { passed: false, mode, match: draftMatch, reason: msg };
    }
    return { passed: true, mode, match: draftMatch, reason: `[WARN] ${msg}` };
  }

  const msg = "找不到對應的 Approved XSPEC，請先執行 /xspec 建立規格";
  if (mode === "strict") {
    return { passed: false, mode, reason: msg };
  }
  return { passed: true, mode, reason: `[WARN] ${msg}` };
}
