# Change Log

All notable changes to the "oceanum" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.5.0]

### Added

- **New chat** button in the AI panel. It clears the conversation and starts a
  new one. A response still in progress is stopped, without a "Stopped."
  message in the new conversation.
- **The AI panel says what the agent is doing** while it works — "Searching
  the catalogue…", "Reading dataset details…", "Running the code…" — instead
  of a static "Thinking…" for the whole request. The extension asks
  `/api/chat` and `/api/chat/observe` for their `text/event-stream` form, and
  Stop still ends a response mid-stream (OCE-175).

### Changed

- **Each chat has its own notebook.** It is the notebook in the active tab when
  the chat starts (with New chat, or the first message), or, when that tab is
  not a notebook, a new one: created beside the file in the active tab, else in
  the first workspace folder, else untitled when no folder is open. The panel
  shows its name. Its cells are the chat's context, and every answer's cells go
  into it whichever tab is in front: it is brought to the front, opened again
  if it was closed, and followed if it is renamed, moved, or saved from untitled. If it was deleted,
  a new notebook takes its place when an answer has cells to place.
- Answers go below the selected cell when you are working in the chat's
  notebook, and at its end otherwise. Focus stays in the chat.
- Markdown cells are sent as context along with code cells.
- **The chat input follows the conversation.** It is at the top of an empty
  chat and just under the latest answer as the chat grows, instead of pinned
  to the bottom of the panel.

### Fixed

- **An answer's code is no longer shown twice.** It goes into the notebook
  only; the chat shows the agent's message. A block appears in the chat only
  when it could not be placed: the notebook refused it (for example, it is
  read-only) or could not be opened.
- A notebook created for a chat is never written over an existing file.
- The chat's conversation, input and scroll position survive switching
  between the Workspace and AI Chat tabs.

## [0.4.0]

### Removed

- **Auth0 sign-in.** The `Oceanum: Sign In` and `Oceanum: Sign Out` commands,
  the device-authorization flow behind them, and the
  `oceanum.auth0Domain` / `oceanum.auth0ClientId` / `oceanum.auth0Audience`
  settings are gone. The extension now authenticates with the Datamesh token
  alone.

  It was a second credential for the same access. The AI sidebar never used the
  Auth0 token — it sends the Datamesh token as `X-Datamesh-Token` — and the
  embedded Datamesh UI treats the two as alternatives for one header, using
  `Bearer <jwt>` when an Auth0 token is present and `Token <datamesh token>`
  otherwise. Removing it halves what can leak or expire and drops a whole
  refresh/expiry code path.

  The panel's REST calls therefore go out as `Token <datamesh token>` rather
  than `Bearer <jwt>`. The Datamesh gateway accepts both.

  **What you need to do:** if you signed in rather than configuring a token,
  set one with `Oceanum: Configure Token` (get it from
  [home.oceanum.io/account](https://home.oceanum.io/account)). Opening the
  Datamesh UI without a token now prompts for one, as signing in used to.
  Access and refresh tokens stored by earlier versions are deleted from secret
  storage on first activation. If you had set any `oceanum.auth0*` value, VS
  Code will flag it as an unknown setting until you remove the line.

## [0.3.0]

### Added

- `oceanum.autoRunCode`: run code cells the AI inserts as soon as they are placed.
- `oceanum.iterate`: send each cell's output back to the AI so it can fix an error or take the next step (requires `oceanum.autoRunCode`).
- Stop button in the chat panel to abort the current request, including cells it is running.

## [0.2.0]

### Added

- Automatic access-token refresh: stale Auth0 tokens are refreshed silently via the stored refresh token when opening the Datamesh UI.

### Fixed

- Opening the Datamesh UI with an expired access token no longer leaves a blank sign-in screen. Tokens are now validated by expiry, refreshed when possible, and otherwise cleared so the device-login flow runs automatically.

## [0.1.0]

- Initial release
