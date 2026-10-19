import type { SerializedValue } from "./types";

/** Human-readable, Python-flavored rendering of a serialized value. */
export function formatValue(value: SerializedValue): string {
  switch (value.type) {
    case "null":
      return "None";
    case "boolean":
      return value.value ? "True" : "False";
    case "number":
      return String(value.value);
    case "string":
      return JSON.stringify(value.value);
    case "function":
      return `<function ${value.name}>`;
    case "object":
      return value.label;
    case "array":
      return `[${value.value.map(formatValue).join(", ")}]`;
    default:
      return "?";
  }
}
