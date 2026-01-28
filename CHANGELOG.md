# Changelog

## [Unreleased]

## [0.2.16] - 2026-01-28

### Fixed
- **Model and path colors restored** — Fixed color regression from v0.2.13 theme refactor:
  - Model segment now uses original pink (`#d787af`) instead of white/gray (`text`)
  - Path segment now uses original cyan (`#00afaf`) instead of muted gray

## [0.2.15] - 2026-01-27

### Added
- **Status notifications above editor** — Extension status messages that look like notifications (e.g., `[pi-annotate] Received: CANCEL`) now appear on a separate line above the editor input
- Notification-style statuses (starting with `[`) appear above editor
- Compact statuses (e.g., `MCP: 6 servers`) remain in the powerline bar

## [0.2.14] - 2026-01-26

### Fixed
- **Theme type mismatch crash** — Fixed `TypeError: theme.fg is not a function` caused by passing `EditorTheme` (from pi-tui) instead of `Theme` (from pi-coding-agent) to segment rendering
- **Invalid theme color** — Changed `"primary"` to `"text"` in default colors since `"primary"` is not a valid `ThemeColor`

## [0.2.13] - 2026-01-27

### Added
- **Theme system** — Colors now integrate with pi's theme system instead of hardcoded values
- Each preset defines its own color scheme with semantic color names
- Optional `theme.json` file for user customization (power user feature)
- Colors can be theme names (`accent`, `primary`, `muted`) or hex values (`#ff5500`)
- Added `theme.example.json` documenting all available color options

### Changed
- Segments now use pi's `Theme` object for color rendering
- Removed hardcoded ANSI color codes in favor of theme-based colors
- Presets include both layout AND color scheme for cohesive looks
- Simplified thinking level colors to use semantic `thinking` color (rainbow preserved for high/xhigh)

## [0.2.12] - 2026-01-27

### Added
- **Responsive segment layout** — Segments dynamically flow between top bar and secondary row based on terminal width
- When terminal is wide: all segments fit in top bar, secondary row hidden
- When terminal is narrow: overflow segments move to secondary row automatically

### Changed
- **Default preset reordered** — New order: π → folder → model → think → git → context% → cache → cost
- Path now appears before model name for better visual hierarchy
- Thinking level now appears right after model name
- Added git, cache_read, and cost to primary row in default preset
- **Thinking label shortened** — `thinking:level` → `think:level` to save 3 characters

### Fixed
- **Narrow terminal crash** — Welcome screen now gracefully skips rendering on terminals < 44 columns wide
- **Editor crash on very narrow terminals** — Falls back to original render when width < 10
- **Streaming footer crash** — Truncation now properly handles edge cases and won't render content that exceeds terminal width
- **Secondary widget crash** — Content width is now validated before rendering
- **Layout cache invalidation** — Cache now properly clears when preset changes or powerline is toggled off

## [0.2.11] - 2026-01-26

### Changed
- Added `pi` manifest to package.json for pi v0.50.0 package system compliance
- Added `pi-package` keyword for npm discoverability

## [0.2.10] - 2026-01-17

### Fixed
- Welcome overlay now properly dismisses for `p "command"` case by:
  - Adding `tool_call` event listener (fires before stream_start)
  - Checking `isStreaming` flag when overlay is about to show
  - Checking session for existing activity (assistant messages, tool calls)
- Refactored dismissal logic into `dismissWelcome()` helper

## [0.2.9] - 2026-01-17

### Fixed
- Welcome overlay/header now dismisses when agent starts streaming (fixes `p "command"` case where welcome would briefly flash)
- Race condition where dismissal request could be lost due to 100ms setup delay in overlay

## [0.2.8] - 2026-01-16

### Changed
- `quietStartup: true` → shows welcome as header (dismisses on first input)
- `quietStartup: false` or not set → shows welcome as centered overlay (dismisses on key/timeout)
- Both modes use same two-column layout: logo, model info, tips, loaded counts, recent sessions
- Refactored welcome.ts to share rendering logic between header and overlay

### Fixed
- `/powerline` toggle off now clears all custom UI (editor, footer, header)

## [0.2.6] - 2026-01-16

### Fixed
- Removed invalid `?` keyboard shortcut tip, replaced with `Shift+Tab` for cycling thinking level

## [0.2.5] - 2026-01-16

### Added
- **Welcome overlay** — Branded "pi agent" splash screen shown as centered overlay on startup
- Two-column boxed layout with gradient PI logo (magenta → cyan)
- Shows current model name and provider
- Keyboard tips section (?, /, !)
- Loaded counts: context files (AGENTS.md), extensions, skills, and prompt templates
- Recent sessions list (up to 3, with time ago)
- Auto-dismisses after 30 seconds or on any key press
- Version now reads from package.json instead of being hardcoded
- Context file discovery now checks `.claude/AGENTS.md` paths (matching pi-mono)

## [0.2.4] - 2026-01-15

### Fixed
- Compatible with pi-tui 0.47.0 breaking change: CustomEditor constructor now requires `tui` as first argument

## [0.2.3] - 2026-01-15

### Fixed
- npm bin entry now works correctly with `npx pi-powerline-footer`

## [0.2.2] - 2026-01-15

### Changed
- **Path segment defaults to basename** — Shows just the directory name (e.g., `powerline-footer`) instead of full path to save space
- **New path modes** — `basename` (default), `abbreviated` (truncated full path), `full` (complete path)
- Simplified path options: replaced `abbreviate`, `stripWorkPrefix` with cleaner `mode` option
- Full/nerd presets use `abbreviated` mode, default/minimal/compact use `basename`
- Thinking segment now uses dedicated gradient colors (thinkingOff → thinkingMedium)

### Fixed
- Path basename extraction now uses `path.basename()` for Windows compatibility
- Git branch cache now stores `null` results, preventing repeated git calls in non-git directories
- Git status cache now stores empty results for non-git directories (was also spawning repeatedly)
- Removed dead `footerDispose` variable (cleanup handled by pi internally)

## [0.2.1] - 2026-01-10

### Added
- **Live git branch updates** — Branch now updates in real-time when switching via `git checkout`, `git switch`, etc.
- **Own branch fetching** — Extension fetches branch directly via `git branch --show-current` instead of relying solely on FooterDataProvider
- **Branch cache with 500ms TTL** — Faster refresh cycle for branch changes
- **Staggered re-renders for escape commands** — Multiple re-renders at 100/300/500ms to catch updates from `!` commands

### Fixed
- Git branch not updating after `git checkout` to existing branches
- Race condition where FooterDataProvider's branch cache wasn't updating in time

## [0.2.0] - 2026-01-10

### Added
- **Extension statuses segment** — Displays status text from other extensions (e.g., rewind checkpoint count)
- **Thinking level segment** — Live-updating display of current thinking level (`thinking:off`, `thinking:med`, etc.)
- **Rainbow effect** — High and xhigh thinking levels display with rainbow gradient inspired by Claude Code's ultrathink
- **Color gradient** — Thinking levels use progressive colors: gray → purple-gray → blue → teal → rainbow
- **Streaming visibility** — Status bar now renders in footer during streaming so it's always visible

### Changed
- Extension statuses appear at end of status bar (last item in default/full/nerd presets)
- Default preset now includes `thinking` segment after model
- Thinking level reads from session branch entries for live updates
- Footer invalidate() now triggers re-render for settings changes
- Responsive truncation — progressively removes segments on narrow windows instead of hiding status

### Fixed
- ANSI color reset after status content to prevent color bleeding
- ANSI color reset after rainbow text

### Removed
- Unused brain icon definitions

## [0.1.0] - 2026-01-10

### Added
- Initial release
- Rounded box design rendering in editor top border
- 18 segment types: pi, model, thinking, path, git, subagents, token_in, token_out, token_total, cost, context_pct, context_total, time_spent, time, session, hostname, cache_read, cache_write
- 6 presets: default, minimal, compact, full, nerd, ascii
- 10 separator styles: powerline, powerline-thin, slash, pipe, dot, chevron, star, block, none, ascii
- Git integration with async status fetching and 1s cache TTL
- Nerd Font auto-detection for common terminals
- oh-my-pi dark theme color matching
- Context percentage warnings at 70%/90%
- Auto-compact indicator
- Subscription detection
