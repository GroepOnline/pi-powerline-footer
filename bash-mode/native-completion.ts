import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import type { CompletionRequest, ExtendedCompletionItem, NativeCompletionAdapter } from "./types.ts";

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      fn();
    };

    const onAbort = () => {
      if (child.exitCode === null) child.kill("SIGKILL");
      finish(() => reject(new Error("aborted")));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      finish(() => {
        if (code !== 0 && stdout.length === 0) {
          console.debug(`[powerline-footer] native completion command failed: ${command} ${args.join(" ")}: ${stderr}`);
        }
        resolve(stdout);
      });
    });
  });
}

function uniqueSuggestions(lines: string[]): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const line of lines) {
    const normalized = line.trim();
    if (!normalized || seen.has(normalized)) continue;
    if (normalized.includes("command not found") || normalized.includes("not enough arguments")) continue;
    if (normalized.startsWith("zsh:") || normalized.startsWith("bash:")) continue;
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
}

const ZSH_CAPTURE_SCRIPT = String.raw`
emulate -LR zsh
setopt rcquotes
zmodload zsh/zpty || exit 0
zpty z zsh -f -i
local line
() {
  zpty -w z source $1
  repeat 60; do
    zpty -r z line
    [[ $line == __PI_CAPTURE_READY__* ]] && return
  done
  exit 0
} =( <<< '
PROMPT=
RPROMPT=
PS1=
DISABLE_AUTO_UPDATE=true
DISABLE_UPDATE_PROMPT=true
stty -echo 2>/dev/null || true
autoload compinit
compinit -d ~/.zcompdump_pi_powerline_capture
bindkey ''^M'' undefined
bindkey ''^J'' undefined
bindkey ''^I'' complete-word
null-line () {
  echo -E - $''\0''
}
compprefuncs=( null-line )
comppostfuncs=( null-line exit )
zstyle '':completion:*'' list-grouped false
zstyle '':completion:*'' insert-tab false
zstyle '':completion:*'' list-separator ''''
zmodload zsh/zutil
compadd () {
  if [[ \${@[1,(i)(-|--)]} == *-(O|A|D)\ * ]]; then
    builtin compadd "$@"
    return $?
  fi
  typeset -a __hits __dscr __tmp
  if (( $@[(I)-d] )); then
    __tmp=\${@[$[\${@[(i)-d]}+1]]}
    if [[ $__tmp == \(* ]]; then
      eval "__dscr=$__tmp"
    else
      __dscr=( "\${(@P)__tmp}" )
    fi
  fi
  builtin compadd -A __hits -D __dscr "$@"
  setopt localoptions norcexpandparam extendedglob
  typeset -A apre hpre hsuf asuf
  zparseopts -E P:=apre p:=hpre S:=asuf s:=hsuf
  integer dirsuf=0
  if [[ -z $hsuf && "\${\${@//-default-/}% -# *}" == *-[[:alnum:]]#f* ]]; then
    dirsuf=1
  fi
  [[ -n $__hits ]] || return
  local dsuf dscr
  for i in {1..$#__hits}; do
    (( dirsuf )) && [[ -d $__hits[$i] ]] && dsuf=/ || dsuf=
    (( $#__dscr >= $i )) && dscr=" -- \${\${__dscr[$i]}##$__hits[$i] #}" || dscr=
    echo -E - $IPREFIX$apre$hpre$__hits[$i]$dsuf$hsuf$asuf$dscr
  done
}
echo __PI_CAPTURE_READY__
')
zpty -w z "$PI_CAPTURE_LINE"$'\t'
integer tog=0
while zpty -r z; do :; done | while IFS= read -r line; do
  if [[ $line == *$'\0\r' || $line == *$'\0' ]]; then
    (( tog++ )) && return 0 || continue
  fi
  (( tog )) && echo -E - $line
done
`;

function parseLabelAndDescription(value: string): { label: string; description?: string } {
  const splitIndex = value.indexOf(" -- ");
  if (splitIndex === -1) return { label: value };
  return {
    label: value.slice(0, splitIndex),
    description: value.slice(splitIndex + 4),
  };
}

export class ZshNativeCompletionAdapter implements NativeCompletionAdapter {
  readonly shellNames = ["zsh"];

  async getCompletions(request: CompletionRequest): Promise<ExtendedCompletionItem[]> {
    const stdout = await runProcess(
      request.shellPath,
      ["-fc", ZSH_CAPTURE_SCRIPT],
      request.cwd,
      {
        ...process.env,
        PI_CAPTURE_LINE: request.line,
        DISABLE_AUTO_UPDATE: "true",
        DISABLE_UPDATE_PROMPT: "true",
      },
      request.signal,
    );

    return uniqueSuggestions(stdout.split("\n")).map((rawValue) => {
      const parsed = parseLabelAndDescription(rawValue);
      const value = appendDirectorySuffix(request.cwd, parsed.label);
      return {
        value,
        label: value,
        description: parsed.description,
        replacement: value,
        startCol: 0,
        endCol: 0,
        source: "native",
        score: 60,
      } satisfies ExtendedCompletionItem;
    });
  }
}

export class FishNativeCompletionAdapter implements NativeCompletionAdapter {
  readonly shellNames = ["fish"];

  async getCompletions(request: CompletionRequest): Promise<ExtendedCompletionItem[]> {
    const stdout = await runProcess(
      request.shellPath,
      ["-ic", `complete --do-complete ${quoteShellArg(request.line)}`],
      request.cwd,
      process.env,
      request.signal,
    );

    return uniqueSuggestions(stdout.split("\n")).map((line) => {
      const [rawValue, description] = line.split("\t", 2);
      const value = appendDirectorySuffix(request.cwd, rawValue);
      return {
        value,
        label: value,
        description: description || undefined,
        replacement: value,
        startCol: 0,
        endCol: 0,
        source: "native",
        score: 60,
      } satisfies ExtendedCompletionItem;
    });
  }
}

function currentToken(line: string, cursorCol: number): string {
  const beforeCursor = line.slice(0, cursorCol);
  const match = beforeCursor.match(/[^\s]+$/);
  return match?.[0] ?? "";
}

function tokenIndex(line: string, cursorCol: number): number {
  const beforeCursor = line.slice(0, cursorCol).trimStart();
  if (!beforeCursor) {
    return 0;
  }

  return beforeCursor.split(/\s+/).length - 1;
}

function unescapeShellValue(value: string): string {
  return value.replace(/\\([\\\s"'`$&|;<>()[\]{}?!*])/g, "$1");
}

function appendDirectorySuffix(cwd: string, value: string): string {
  if (value.endsWith("/")) {
    return value;
  }

  try {
    return statSync(resolve(cwd, unescapeShellValue(value))).isDirectory() ? `${value}/` : value;
  } catch {
    // Non-path completions and unresolved paths should keep the shell-provided value unchanged.
    return value;
  }
}

export class BashNativeCompletionAdapter implements NativeCompletionAdapter {
  readonly shellNames = ["bash"];

  async getCompletions(request: CompletionRequest): Promise<ExtendedCompletionItem[]> {
    const token = currentToken(request.line, request.cursorCol);
    if (!token) return [];

    const isCommandPosition = tokenIndex(request.line, request.cursorCol) === 0;

    const script = `
TOKEN=${quoteShellArg(token)}
if [ -f /opt/homebrew/etc/profile.d/bash_completion.sh ]; then . /opt/homebrew/etc/profile.d/bash_completion.sh; fi
if [ -f /etc/bash_completion ]; then . /etc/bash_completion; fi
{
  ${isCommandPosition ? 'compgen -abck -A function -A command -- "$TOKEN"' : ""}
  compgen -A file -- "$TOKEN"
} | awk 'NF' | awk '!seen[$0]++'
`;
    const stdout = await runProcess(request.shellPath, ["-ic", script], request.cwd, process.env, request.signal);
    return uniqueSuggestions(stdout.split("\n")).map((rawValue) => {
      const value = appendDirectorySuffix(request.cwd, rawValue);
      return {
        value,
        label: value,
        replacement: value,
        startCol: 0,
        endCol: 0,
        source: "native",
        score: 55,
      } satisfies ExtendedCompletionItem;
    });
  }
}

export function createNativeCompletionAdapters(): NativeCompletionAdapter[] {
  return [
    new ZshNativeCompletionAdapter(),
    new FishNativeCompletionAdapter(),
    new BashNativeCompletionAdapter(),
  ];
}
