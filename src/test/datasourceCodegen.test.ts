// Copyright Oceanum Ltd. Apache 2.0
import { describe, it, expect } from "vitest";
import {
  generateDatasourceCode,
  generateTokenLine,
} from "../codegen/datasourceCodegen";
import type { IDatasource } from "../types";

const base: IDatasource = {
  id: "abc",
  label: "My Dataset",
  datasource: "my-dataset-id",
  description: "Test dataset",
};

describe("generateDatasourceCode", () => {
  it("generates a simple load_datasource call", () => {
    const code = generateDatasourceCode(base, false);
    expect(code).toContain("from oceanum.datamesh import Connector");
    expect(code).toContain("datamesh = Connector()");
    expect(code).toContain(
      "My_Dataset = datamesh.load_datasource('my-dataset-id')",
    );
  });

  it("injects token argument when injectToken is true", () => {
    const code = generateDatasourceCode(base, true);
    expect(code).toContain("datamesh = Connector(token=DATAMESH_TOKEN)");
  });

  it("uses datasource slug as fallback variable name when label is empty", () => {
    const code = generateDatasourceCode({ ...base, label: "" }, false);
    expect(code).toContain("my_dataset_id = datamesh.load_datasource");
  });

  it("prefixes ds_ when variable name starts with a digit", () => {
    const code = generateDatasourceCode({ ...base, label: "1bad-name" }, false);
    expect(code).toContain("ds_1bad_name");
  });

  it("generates a query call when variables are present", () => {
    const ds: IDatasource = { ...base, variables: ["u", "v"] };
    const code = generateDatasourceCode(ds, false);
    expect(code).toContain("datamesh.query(");
    expect(code).toContain("datasource='my-dataset-id'");
    expect(code).toContain("variables=['u', 'v']");
    expect(code).not.toContain("load_datasource");
  });

  it("generates a query call when timefilter is present", () => {
    const ds: IDatasource = {
      ...base,
      timefilter: { times: ["2020-01-01", "2021-01-01"] },
    };
    const code = generateDatasourceCode(ds, false);
    expect(code).toContain("datamesh.query(");
    expect(code).toContain("'times': ['2020-01-01', '2021-01-01']");
  });

  it("generates a query call when geofilter is present", () => {
    const ds: IDatasource = {
      ...base,
      geofilter: { type: "Point", coordinates: [170.5, -45.0] },
    };
    const code = generateDatasourceCode(ds, false);
    expect(code).toContain("datamesh.query(");
    expect(code).toContain("'type': 'Point'");
    expect(code).toContain("'coordinates': [170.5, -45]");
  });

  it("generates a query call when spatialref is present", () => {
    const ds: IDatasource = { ...base, spatialref: "EPSG:4326" };
    const code = generateDatasourceCode(ds, false);
    expect(code).toContain("datamesh.query(");
    expect(code).toContain("spatialref='EPSG:4326'");
  });

  it("serialises null values as Python None", () => {
    const ds: IDatasource = {
      ...base,
      geofilter: {
        type: "Polygon",
        coordinates: null as unknown as Record<string, unknown>,
      },
    };
    const code = generateDatasourceCode(ds, false);
    expect(code).toContain("None");
    expect(code).not.toContain("null");
  });
});

describe("generateTokenLine", () => {
  it("produces a valid Python assignment", () => {
    const line = generateTokenLine();
    expect(line).toMatch(/^DATAMESH_TOKEN\s*=/);
  });
});
