/**
 * Agent Communication Protocol — DevAP Envelope Adapter
 *
 * Converts between DevAP's internal TaskResult/TaskStatus and the
 * UDS Agent Communication Protocol v1.0 (SPEC-AGENT-COMM-001).
 */

import type { TaskResult, TaskStatus } from "./types.js";

// ─── Unified Types (from UDS SPEC-AGENT-COMM-001) ───────

export type UnifiedStatus =
  | "success"
  | "success_partial"
  | "failed"
  | "blocked"
  | "needs_context"
  | "skipped"
  | "timeout"
  | "unknown";

export interface AgentEnvelope {
  envelope_version: string;
  message_id: string;
  source: { agent_id: string; agent_type: string; project: string };
  target?: { agent_id?: string; agent_type: string };
  status: UnifiedStatus;
  timestamp: string;
  payload: { artifact_type: string; artifact_id: string; content: Record<string, unknown> };
  correlation_id?: string;
  parent_message_id?: string;
  metadata?: Record<string, unknown>;
  concerns?: string[];
}

export interface AgentHandoff {
  from: { agent_id: string; agent_type: string; message_id: string };
  to: { agent_type: string };
  artifacts: Array<{ artifact_id: string; artifact_type: string; summary: string }>;
  decision_log?: Array<{ decision: string; reason: string; agent_id: string; timestamp: string }>;
  pending_items?: Array<{ item: string; priority: "high" | "medium" | "low"; context?: string }>;
  constraints?: string[];
}

// ─── Status Mapping ─────────────────────────────────────

const DEVAP_TO_UNIFIED: Record<TaskStatus, UnifiedStatus> = {
  success: "success",
  failed: "failed",
  skipped: "skipped",
  timeout: "timeout",
  done_with_concerns: "success_partial",
  needs_context: "needs_context",
  blocked: "blocked",
};

const UNIFIED_TO_DEVAP: Record<UnifiedStatus, TaskStatus> = {
  success: "success",
  success_partial: "done_with_concerns",
  failed: "failed",
  blocked: "blocked",
  needs_context: "needs_context",
  skipped: "skipped",
  timeout: "timeout",
  unknown: "failed", // fallback
};

export function mapDevapStatusToUnified(status: string): UnifiedStatus {
  return DEVAP_TO_UNIFIED[status as TaskStatus] ?? "unknown";
}

export function mapUnifiedStatusToDevap(status: string): TaskStatus {
  return UNIFIED_TO_DEVAP[status as UnifiedStatus] ?? "failed";
}

// ─── Converters ─────────────────────────────────────────

let counter = 0;
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++counter}`;
}

export function taskResultToEnvelope(
  result: TaskResult,
  source: { agent_id: string; agent_type: string },
): AgentEnvelope {
  const unified = mapDevapStatusToUnified(result.status);

  const envelope: AgentEnvelope = {
    envelope_version: "1.0",
    message_id: generateId("msg"),
    source: { ...source, project: "devap" },
    status: unified,
    timestamp: new Date().toISOString(),
    payload: {
      artifact_type: "plan",
      artifact_id: generateId("art"),
      content: {
        task_id: result.task_id,
        verification_passed: result.verification_passed,
        judge_verdict: result.judge_verdict,
      },
    },
    metadata: {
      cost_usd: result.cost_usd,
      duration_ms: result.duration_ms,
      retry_count: result.retry_count,
    },
  };

  if (result.concerns && result.concerns.length > 0) {
    envelope.concerns = result.concerns;
  }

  if (result.session_id) {
    envelope.correlation_id = result.session_id;
  }

  return envelope;
}

export function envelopeToTaskResult(envelope: AgentEnvelope): Partial<TaskResult> {
  const status = mapUnifiedStatusToDevap(envelope.status);
  const content = envelope.payload?.content ?? {};

  const result: Partial<TaskResult> = {
    task_id: (content.task_id as string) ?? envelope.payload?.artifact_id,
    status,
  };

  if (envelope.metadata) {
    if (typeof envelope.metadata.cost_usd === "number") result.cost_usd = envelope.metadata.cost_usd;
    if (typeof envelope.metadata.duration_ms === "number") result.duration_ms = envelope.metadata.duration_ms;
    if (typeof envelope.metadata.retry_count === "number") result.retry_count = envelope.metadata.retry_count;
  }

  if (envelope.concerns && envelope.concerns.length > 0) {
    result.concerns = envelope.concerns;
  }

  if (envelope.correlation_id) {
    result.session_id = envelope.correlation_id;
  }

  return result;
}
