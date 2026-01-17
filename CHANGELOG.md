# Changelog

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
