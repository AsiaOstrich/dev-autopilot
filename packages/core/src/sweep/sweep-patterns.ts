export interface SweepPattern {
  id: string;
  label: string;
  regex: RegExp;
  fixable: boolean;
  fixer?: (line: string) => string | null;
}

function removeLineIfOnlyMatch(line: string, regex: RegExp): string | null {
  return regex.test(line.trim()) ? null : line;
}

export const SWEEP_PATTERNS: SweepPattern[] = [
  {
    id: "console-log",
    label: "console.log / console.debug / console.trace",
    regex: /\bconsole\.(log|debug|trace)\s*\(/,
    fixable: true,
    fixer: (line) => removeLineIfOnlyMatch(line, /^\s*console\.(log|debug|trace)\s*\(.*\)\s*;?\s*$/),
  },
  {
    id: "debugger",
    label: "debugger statement",
    regex: /\bdebugger\s*;?/,
    fixable: true,
    fixer: (line) => removeLineIfOnlyMatch(line, /^\s*debugger\s*;?\s*$/),
  },
  {
    id: "todo-fixme",
    label: "TODO / FIXME / HACK / XXX comment",
    regex: /\/\/\s*(TODO|FIXME|HACK|XXX)\b/i,
    fixable: false,
  },
  {
    id: "ts-any",
    label: "TypeScript 'any' type usage",
    regex: /(?::\s*any\b|as\s+any\b|<any>)/,
    fixable: false,
  },
];
