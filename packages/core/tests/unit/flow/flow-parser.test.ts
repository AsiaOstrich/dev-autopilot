// [Implements XSPEC-087 AC-4] FlowParser 單元測試
import { describe, it, expect } from "vitest";
import { FlowParser } from "../../../src/flow/flow-parser.js";
import type { FlowDefinition } from "../../../src/types.js";

// ─────────────────────────────────────────────
// 測試 fixtures
// ─────────────────────────────────────────────

const VALID_COMMIT_FLOW_YAML = `
name: commit
description: "3-step commit flow"
steps:
  - id: generate-message
    type: ai-task
    description: "Generate commit message"
    tool: devap:commit-message-generator
  - id: user-confirm
    type: gate
    gate: HUMAN_CONFIRM
    prompt: "Confirm? [y/n]"
    on_reject: generate-message
    requires: [generate-message]
  - id: execute-commit
    type: shell
    command: "git commit -m '{{commit_message}}'"
    requires: [user-confirm]
`;

// ─────────────────────────────────────────────
// FlowParser tests
// ─────────────────────────────────────────────

describe("FlowParser", () => {
  describe("parse — valid YAML", () => {
    // [Source: XSPEC-087 AC-4]
    it("should_parse_valid_flow_yaml_into_FlowDefinition", () => {
      const result: FlowDefinition = FlowParser.parse(VALID_COMMIT_FLOW_YAML);

      expect(result.name).toBe("commit");
      expect(result.description).toBe("3-step commit flow");
      expect(result.steps).toHaveLength(3);
      expect(result.steps[1].gate).toBe("HUMAN_CONFIRM");
    });

    // [Source: XSPEC-087 AC-1]
    it("should_preserve_all_fields_without_data_loss", () => {
      const result = FlowParser.parse(VALID_COMMIT_FLOW_YAML);

      const confirmStep = result.steps[1];
      expect(confirmStep.id).toBe("user-confirm");
      expect(confirmStep.type).toBe("gate");
      expect(confirmStep.gate).toBe("HUMAN_CONFIRM");
      expect(confirmStep.prompt).toBe("Confirm? [y/n]");
      expect(confirmStep.on_reject).toBe("generate-message");
      expect(confirmStep.requires).toEqual(["generate-message"]);

      const commitStep = result.steps[2];
      expect(commitStep.command).toBe("git commit -m '{{commit_message}}'");
      expect(commitStep.requires).toEqual(["user-confirm"]);
    });

    it("should_parse_minimal_valid_yaml_without_optional_fields", () => {
      const minimal = `
name: minimal
steps:
  - id: step-1
    type: shell
    command: echo hello
`;
      const result = FlowParser.parse(minimal);
      expect(result.name).toBe("minimal");
      expect(result.description).toBeUndefined();
      expect(result.steps[0].description).toBeUndefined();
    });
  });

  describe("parse — invalid YAML", () => {
    it("should_throw_when_name_is_missing", () => {
      const yaml = `
steps:
  - id: s1
    type: shell
`;
      expect(() => FlowParser.parse(yaml)).toThrow(/name/);
    });

    it("should_throw_when_steps_is_missing", () => {
      const yaml = "name: myflow\n";
      expect(() => FlowParser.parse(yaml)).toThrow(/steps/);
    });

    it("should_throw_when_step_id_is_missing", () => {
      const yaml = `
name: test
steps:
  - type: shell
    command: echo hi
`;
      expect(() => FlowParser.parse(yaml)).toThrow(/id/);
    });

    it("should_throw_when_step_type_is_invalid", () => {
      const yaml = `
name: test
steps:
  - id: s1
    type: unknown-type
`;
      expect(() => FlowParser.parse(yaml)).toThrow(/type/);
    });

    it("should_throw_when_gate_type_is_invalid_on_gate_step", () => {
      const yaml = `
name: test
steps:
  - id: s1
    type: gate
    gate: INVALID_GATE
`;
      expect(() => FlowParser.parse(yaml)).toThrow(/gate/);
    });

    it("should_throw_on_malformed_yaml", () => {
      expect(() => FlowParser.parse("{ unclosed:")).toThrow();
    });
  });
});
