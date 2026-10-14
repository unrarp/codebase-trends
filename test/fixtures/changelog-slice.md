# Changelog

## 2.1.299

- Added `CLAUDE_CODE_DISABLE_FILE_MENTIONS` environment variable: Claude gets the paths of `@` file mentions to read with its file tools, not the files' contents
- Fixed Edit and Retry in Cowork and claude.ai cloud sessions failing on a message stopped while its `UserPromptSubmit` or mod `prompt.submit` hooks were still running (regression in 2.1.296)

## 2.1.126

- **Security:** Fixed `allowManagedDomainsOnly` / `allowManagedReadPathsOnly` being ignored when a higher-priority managed-settings source lacked a `sandbox` block

## 2.1.49

- Fixed `disableAllHooks` setting to respect managed settings hierarchy — non-managed settings can no longer disable managed hooks set by policy (#26637)

## 2.1.19

- Added env var `CLAUDE_CODE_ENABLE_TASKS`, set to `false` to keep the old system temporarily
- Added shorthand `$0`, `$1`, etc. for accessing individual arguments in custom commands
- Fixed crashes on processors without AVX instruction support
- Fixed dangling Claude Code processes when terminal is closed by catching EIO errors from `process.exit()` and using SIGKILL as fallback
- Fixed `/rename` and `/tag` not updating the correct session when resuming from a different directory (e.g., git worktrees)
- Fixed resuming sessions by custom title not working when run from a different directory
- Fixed pasted text content being lost when using prompt stash (Ctrl+S) and restore
- Fixed agent list displaying "Sonnet (default)" instead of "Inherit (default)" for agents without an explicit model setting
- Fixed backgrounded hook commands not returning early, potentially causing the session to wait on a process that was intentionally backgrounded
- Fixed file write preview omitting empty lines
- Changed skills without additional permissions or hooks to be allowed without requiring approval
- Changed indexed argument syntax from `$ARGUMENTS.0` to `$ARGUMENTS[0]` (bracket syntax)
- [SDK] Added replay of `queued_command` attachment messages as `SDKUserMessageReplay` events when `replayUserMessages` is enabled
- [VSCode] Enabled session forking and rewind functionality for all users

## 2.1.18

- Added customizable keyboard shortcuts. Configure keybindings per context, create chord sequences, and personalize your workflow. Run `/keybindings` to get started. Learn more at https://code.claude.com/docs/en/keybindings

## 2.1.17

- Fixed crashes on processors without AVX instruction support

## 2.1.0 (2026-01-07)

- Added automatic skill hot-reload - skills created or modified in `~/.claude/skills` or `.claude/skills` are now immediately available without restarting the session
- Added support for running skills and slash commands in a forked sub-agent context using `context: fork` in skill frontmatter
- Added support for `agent` field in skills to specify agent type for execution
- Added `language` setting to configure Claude's response language (e.g., language: "japanese")
