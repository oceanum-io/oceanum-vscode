// Copyright Oceanum Ltd. Apache 2.0
import type { IDatasource } from "../types";

function toVarName(label: string, datasource: string): string {
  const base = (label || datasource)
    .replace(/[\s\-.]/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "");
  return /^\d/.test(base) ? `ds_${base}` : base;
}

/** Serialize a JSON value to a Python literal (handles null→None, bool→True/False). */
function toPythonLiteral(value: unknown, indent = ""): string {
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string") return `'${value.replace(/'/g, "\\'")}'`;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => toPythonLiteral(v, indent)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const inner = indent + "  ";
    const pairs = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${inner}'${k}': ${toPythonLiteral(v, inner)}`)
      .join(",\n");
    return `{\n${pairs}\n${indent}}`;
  }
  return JSON.stringify(value);
}

export function generateDatasourceCode(
  datasource: IDatasource,
  injectToken: boolean,
): string {
  const varName = toVarName(datasource.label, datasource.datasource);
  const tokenArg = injectToken ? "token=DATAMESH_TOKEN" : "";
  const header = `from oceanum.datamesh import Connector\ndatamesh = Connector(${tokenArg})`;

  const hasQuery =
    datasource.variables ||
    datasource.geofilter ||
    datasource.timefilter ||
    datasource.spatialref;

  if (!hasQuery) {
    return `${header}\n${varName} = datamesh.load_datasource('${datasource.datasource}')`;
  }

  const queryArgs: string[] = [`  datasource='${datasource.datasource}'`];
  if (datasource.variables) {
    queryArgs.push(
      `  variables=${toPythonLiteral(datasource.variables, "  ")}`,
    );
  }
  if (datasource.timefilter) {
    queryArgs.push(
      `  timefilter=${toPythonLiteral(datasource.timefilter, "  ")}`,
    );
  }
  if (datasource.geofilter) {
    queryArgs.push(
      `  geofilter=${toPythonLiteral(datasource.geofilter, "  ")}`,
    );
  }
  if (datasource.spatialref) {
    queryArgs.push(`  spatialref='${datasource.spatialref}'`);
  }

  return `${header}\n${varName} = datamesh.query(\n${queryArgs.join(",\n")}\n)`;
}

export function generateTokenLine(): string {
  return "DATAMESH_TOKEN=''  # Set your Datamesh token here";
}
