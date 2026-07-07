export function shouldShowStartupWelcome(reason: unknown, welcomeEnabled: boolean): boolean {
  return reason === "startup" && welcomeEnabled;
}

export function shouldResetExtendedKeyboardModesOnShutdown(reason: unknown): boolean {
  return reason === "quit";
}

export function isStaleExtensionContextError(error: unknown): boolean {
  return error instanceof Error && (
    error.message.includes("This extension instance is stale")
    || error.message.includes("This extension ctx is stale")
  );
}
