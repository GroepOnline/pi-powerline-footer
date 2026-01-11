# Changelog

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
