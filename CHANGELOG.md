# Change Log

All notable changes to the "oceanum" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.2.0]

### Added
- Automatic access-token refresh: stale Auth0 tokens are refreshed silently via the stored refresh token when opening the Datamesh UI.

### Fixed
- Opening the Datamesh UI with an expired access token no longer leaves a blank sign-in screen. Tokens are now validated by expiry, refreshed when possible, and otherwise cleared so the device-login flow runs automatically.

## [0.1.0]

- Initial release