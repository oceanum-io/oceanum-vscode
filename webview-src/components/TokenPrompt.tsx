// Copyright Oceanum Ltd. Apache 2.0
import React from "react";
import { vscode } from "../vscode";

export function TokenPrompt(): React.ReactElement {
  return (
    <div className="oceanum-token-prompt">
      <p>
        Set your{" "}
        <a
          onClick={() => vscode.postMessage({ command: "set-token" })}
          href="#"
        >
          Datamesh token
        </a>{" "}
        to enable Oceanum services.{" "}
        <a
          href="https://home.oceanum.io/account"
          target="_blank"
          rel="noreferrer"
        >
          Get a token
        </a>
      </p>
    </div>
  );
}
