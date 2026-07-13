import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";
import type { Issue, WorkflowSpec } from "./types.js";
import { lintWorkflow } from "./lint.js";

export * from "./types.js";
export { lintWorkflow } from "./lint.js";
export { scanTemplate, classifyVar, TEMPLATE_RE, type TemplateVar, type TemplateRef } from "./template.js";

const schemaPath = fileURLToPath(new URL("../workflow.schema.json", import.meta.url));
export const workflowSchema = JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, unknown>;

let compiled: ValidateFunction | null = null;
function validator(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
    // "regex" format used by gate.pass_when.output_matches; registered here
    // instead of pulling in ajv-formats for a single format
    ajv.addFormat("regex", {
      type: "string",
      validate: (s: string) => {
        try {
          new RegExp(s);
          return true;
        } catch {
          return false;
        }
      },
    });
    compiled = ajv.compile(workflowSchema);
  }
  return compiled;
}

export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: Issue[],
  ) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}

export function validateWorkflow(data: unknown): Issue[] {
  const validate = validator();
  if (validate(data)) return [];
  return (validate.errors ?? []).map((e) => ({
    rule: "schema",
    severity: "error" as const,
    message: `${e.instancePath || "/"} ${e.message ?? "is invalid"}`,
    path: e.instancePath || "/",
  }));
}

export interface ParseResult {
  workflow: WorkflowSpec;
  /** schema errors + lint errors + lint warnings, in that order */
  issues: Issue[];
}

/**
 * Parse and fully check a workflow YAML document. Throws
 * WorkflowValidationError on YAML syntax errors, schema violations, or
 * lint errors; lint warnings are returned, not thrown.
 */
export function parseWorkflow(yamlText: string, opts: { fileName?: string } = {}): ParseResult {
  let data: unknown;
  try {
    data = parseYaml(yamlText);
  } catch (err) {
    throw new WorkflowValidationError(`YAML syntax error: ${(err as Error).message}`, [
      { rule: "yaml-syntax", severity: "error", message: (err as Error).message },
    ]);
  }

  const schemaIssues = validateWorkflow(data);
  if (schemaIssues.length > 0) {
    throw new WorkflowValidationError(
      `workflow does not match schema:\n${schemaIssues.map((i) => `  - ${i.message}`).join("\n")}`,
      schemaIssues,
    );
  }

  const workflow = data as WorkflowSpec;
  if (!workflow.name && opts.fileName) {
    workflow.name = basename(opts.fileName).replace(/\.ya?ml$/, "");
  }

  const lintIssues = lintWorkflow(workflow);
  const errors = lintIssues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    throw new WorkflowValidationError(
      `workflow has lint errors:\n${errors.map((i) => `  - [${i.rule}] ${i.message}`).join("\n")}`,
      lintIssues,
    );
  }

  return { workflow, issues: lintIssues };
}

export function loadWorkflow(filePath: string): ParseResult {
  return parseWorkflow(readFileSync(filePath, "utf8"), { fileName: filePath });
}
