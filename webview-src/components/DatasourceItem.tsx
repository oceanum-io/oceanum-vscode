// Copyright Oceanum Ltd. Apache 2.0
import React, { useState } from "react";
import { vscode } from "../vscode";
import type { IDatasource } from "../types";

export function DatasourceItem({
  datasource,
}: {
  datasource: IDatasource;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  const insert = () =>
    vscode.postMessage({ command: "insert-datasource", datasource });

  return (
    <div className={`datasource-item${expanded ? " expanded" : ""}`}>
      <div className="datasource-item-header">
        <button
          className="datasource-item-toggle"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <span
          className="datasource-item-name"
          onClick={() => setExpanded(!expanded)}
        >
          {datasource.description || datasource.datasource}
        </span>
        <button
          className="datasource-item-insert"
          title="Insert code"
          onClick={insert}
        >
          ↵
        </button>
      </div>

      {expanded && (
        <div className="datasource-item-details">
          <div className="datasource-detail-row">
            <span className="label">ID</span>
            <span>{datasource.datasource}</span>
          </div>
          {datasource.variables && (
            <div className="datasource-detail-row">
              <span className="label">Variables</span>
              <span>{datasource.variables.join(", ")}</span>
            </div>
          )}
          {datasource.timefilter && (
            <div className="datasource-detail-row">
              <span className="label">Time</span>
              <span>
                {datasource.timefilter.times[0]} –{" "}
                {datasource.timefilter.times[1]}
              </span>
            </div>
          )}
          {datasource.geofilter && (
            <div className="datasource-detail-row">
              <span className="label">Geofilter</span>
              <span>
                {(datasource.geofilter as { type?: string }).type ?? "custom"}
              </span>
            </div>
          )}
          {datasource.spatialref && (
            <div className="datasource-detail-row">
              <span className="label">CRS</span>
              <span>{datasource.spatialref}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
