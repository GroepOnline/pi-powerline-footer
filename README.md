# pi-powerline-footer

A powerline-style status bar extension for [pi](https://github.com/badlogic/pi-mono), the coding agent. Inspired by [oh-my-pi](https://github.com/can1357/oh-my-pi).

<img width="1782" height="170" alt="image" src="https://github.com/user-attachments/assets/e9d2aded-8cd7-4b35-bb8e-f7c55b01b16c" />

## Features

**Rounded box design** — Status renders directly in the editor's top border, not as a separate footer.

**Smart defaults** — Nerd Font auto-detection for iTerm, WezTerm, Kitty, Ghostty, and Alacritty with ASCII fallbacks. Colors matched to oh-my-pi's dark theme.

**Git integration** — Async status fetching with 1s cache TTL. Automatically invalidates on file writes/edits. Shows branch, staged (+), unstaged (*), and untracked (?) counts.

**Context awareness** — Color-coded warnings at 70% (yellow) and 90% (red) context usage. Auto-compact indicator when enabled.

**Token intelligence** — Smart formatting (1.2k, 45M), thinking level display for reasoning models, subscription detection (shows "(sub)" vs dollar cost).

## Installation

Copy to `~/.pi/agent/extensions/powerline-footer/`

## Usage

Activates automatically. Toggle with `/powerline`, switch presets with `/powerline <name>`.

| Preset | Description |
|--------|-------------|
| `default` | Model, path, git, context, tokens, cost |
| `minimal` | Just path, git, context |
| `compact` | Model, git, cost, context |
| `full` | Everything including hostname and time |
| `nerd` | Maximum detail for Nerd Font users |
| `ascii` | Safe for any terminal |

**Environment:** `POWERLINE_NERD_FONTS=1` to force Nerd Fonts, `=0` for ASCII.

## Segments

`pi` · `model` · `path` · `git` · `subagents` · `token_in` · `token_out` · `token_total` · `cost` · `context_pct` · `context_total` · `time_spent` · `time` · `session` · `hostname` · `cache_read` · `cache_write`

## Separators

`powerline` · `powerline-thin` · `slash` · `pipe` · `dot` · `chevron` · `star` · `block` · `none` · `ascii`
