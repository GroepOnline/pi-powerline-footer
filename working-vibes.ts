// working-vibes.ts
// AI-generated contextual working messages that match a user's preferred theme/vibe.
// Uses module-level state (matching powerline-footer pattern).

import { complete, type Context } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";

const DEFAULT_PROMPT = `Generate a 2-4 word "{theme}" themed loading message ending in "...".

Task: {task}

The message should hint at what's being done, but in theme vocabulary.
Examples for "mafia" theme: "Checking the ledger...", "Consulting the family...", "Making arrangements..."
Examples for "star trek" theme: "Scanning sensors...", "Analyzing data...", "Running diagnostics..."

Output only the message, nothing else.`;

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface VibeConfig {
  theme: string | null;        // null = disabled
  modelSpec: string;           // default: "anthropic/claude-haiku-4-5"
  fallback: string;            // default: "Working"
  timeout: number;             // default: 3000ms
  refreshInterval: number;     // default: 30000ms (30s)
  promptTemplate: string;      // template with {theme} and {task} placeholders
}

interface VibeGenContext {
  theme: string;
  userPrompt: string;          // from event.prompt in before_agent_start
}

// ═══════════════════════════════════════════════════════════════════════════
// Module-level State
// ═══════════════════════════════════════════════════════════════════════════

let config: VibeConfig = loadConfig();
let extensionCtx: ExtensionContext | null = null;
let currentGeneration: AbortController | null = null;
let isStreaming = false;
let lastVibeTime = 0;

// ═══════════════════════════════════════════════════════════════════════════
// Configuration Management
// ═══════════════════════════════════════════════════════════════════════════

function getSettingsPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return join(homeDir, ".pi", "agent", "settings.json");
}

function loadConfig(): VibeConfig {
  const settingsPath = getSettingsPath();
  
  let settings: Record<string, unknown> = {};
  try {
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    }
  } catch {}
  
  // Handle "off" in settings.json (same as null/disabled)
  const rawTheme = typeof settings.workingVibe === "string" ? settings.workingVibe : null;
  const theme = rawTheme?.toLowerCase() === "off" ? null : rawTheme;
  
  return {
    theme,
    modelSpec: typeof settings.workingVibeModel === "string" ? settings.workingVibeModel : DEFAULT_MODEL,
    fallback: typeof settings.workingVibeFallback === "string" ? settings.workingVibeFallback : "Working",
    timeout: 3000,
    refreshInterval: typeof settings.workingVibeRefreshInterval === "number" 
      ? settings.workingVibeRefreshInterval * 1000  // config is in seconds
      : 30000, // default 30s
    promptTemplate: typeof settings.workingVibePrompt === "string" ? settings.workingVibePrompt : DEFAULT_PROMPT,
  };
}

function saveConfig(): void {
  const settingsPath = getSettingsPath();
  
  try {
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    }
    
    if (config.theme === null) {
      delete settings.workingVibe;
    } else {
      settings.workingVibe = config.theme;
    }
    
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.debug("[working-vibes] Failed to save settings:", error);
  }
}

function saveModelConfig(): void {
  const settingsPath = getSettingsPath();
  
  try {
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    }
    
    // Only save if different from default
    if (config.modelSpec === DEFAULT_MODEL) {
      delete settings.workingVibeModel;
    } else {
      settings.workingVibeModel = config.modelSpec;
    }
    
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.debug("[working-vibes] Failed to save model settings:", error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Prompt Building & Response Parsing (Pure Functions)
// ═══════════════════════════════════════════════════════════════════════════

function buildVibePrompt(ctx: VibeGenContext): string {
  // Truncate user prompt to save tokens (most context in first 100 chars)
  const task = ctx.userPrompt.slice(0, 100);
  
  // Use configured template with variable substitution
  return config.promptTemplate
    .replace(/\{theme\}/g, ctx.theme)
    .replace(/\{task\}/g, task);
}

function parseVibeResponse(response: string, fallback: string): string {
  if (!response) return `${fallback}...`;
  
  // Take only the first line (AI sometimes adds explanations)
  let vibe = response.trim().split('\n')[0].trim();
  
  // Remove quotes if model wrapped the response
  vibe = vibe.replace(/^["']|["']$/g, "");
  
  // Ensure ellipsis
  if (!vibe.endsWith("...")) {
    vibe = vibe.replace(/\.+$/, "") + "...";
  }
  
  // Enforce length limit (50 chars max)
  if (vibe.length > 50) {
    vibe = vibe.slice(0, 47) + "...";
  }
  
  // Final validation
  if (!vibe || vibe === "...") {
    return `${fallback}...`;
  }
  
  return vibe;
}

// ═══════════════════════════════════════════════════════════════════════════
// AI Generation
// ═══════════════════════════════════════════════════════════════════════════

async function generateVibe(
  ctx: VibeGenContext,
  signal: AbortSignal,
): Promise<string> {
  if (!extensionCtx) {
    return `${config.fallback}...`;
  }
  
  // Parse model spec (provider/modelId format, where modelId may contain slashes)
  const slashIndex = config.modelSpec.indexOf("/");
  if (slashIndex === -1) {
    return `${config.fallback}...`;
  }
  const provider = config.modelSpec.slice(0, slashIndex);
  const modelId = config.modelSpec.slice(slashIndex + 1);
  if (!provider || !modelId) {
    return `${config.fallback}...`;
  }
  
  // Resolve model from registry
  const model = extensionCtx.modelRegistry.find(provider, modelId);
  if (!model) {
    console.debug(`[working-vibes] Model not found: ${config.modelSpec}`);
    return `${config.fallback}...`;
  }
  
  // Get API key
  const apiKey = await extensionCtx.modelRegistry.getApiKey(model);
  if (!apiKey) {
    console.debug(`[working-vibes] No API key for provider: ${provider}`);
    return `${config.fallback}...`;
  }
  
  // Build minimal context (just a user message, no system prompt or tools)
  const aiContext: Context = {
    messages: [{
      role: "user",
      content: [{ type: "text", text: buildVibePrompt(ctx) }],
      timestamp: Date.now(),
    }],
  };
  
  // Call model with timeout
  const response = await complete(model, aiContext, { apiKey, signal });
  
  // Extract and parse response
  const textContent = response.content.find(c => c.type === "text");
  return parseVibeResponse(textContent?.text || "", config.fallback);
}

async function generateAndUpdate(
  prompt: string, 
  setWorkingMessage: (msg?: string) => void,
): Promise<void> {
  // Cancel any in-flight generation
  currentGeneration?.abort();
  currentGeneration = new AbortController();
  
  // Create timeout signal (3 seconds)
  const timeoutSignal = AbortSignal.timeout(config.timeout);
  const combinedSignal = AbortSignal.any([
    currentGeneration.signal,
    timeoutSignal,
  ]);
  
  try {
    const vibe = await generateVibe(
      { theme: config.theme!, userPrompt: prompt },
      combinedSignal,
    );
    
    // Only update if still streaming and not aborted
    if (isStreaming && !currentGeneration.signal.aborted) {
      setWorkingMessage(vibe);
    }
  } catch (error) {
    // AbortError is expected on timeout/cancel - don't log as error
    if (error instanceof Error && error.name === "AbortError") {
      console.debug("[working-vibes] Generation aborted");
    } else {
      console.debug("[working-vibes] Generation failed:", error);
    }
    // Fallback already showing, no action needed
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Exported Functions (called from index.ts)
// ═══════════════════════════════════════════════════════════════════════════

export function initVibeManager(ctx: ExtensionContext): void {
  extensionCtx = ctx;
  config = loadConfig(); // Refresh config in case settings changed
}

export function getVibeTheme(): string | null {
  return config.theme;
}

export function setVibeTheme(theme: string | null): void {
  config = { ...config, theme };
  saveConfig();
}

export function getVibeModel(): string {
  return config.modelSpec;
}

export function setVibeModel(modelSpec: string): void {
  config = { ...config, modelSpec };
  saveModelConfig();
}

export function onVibeBeforeAgentStart(
  prompt: string, 
  setWorkingMessage: (msg?: string) => void,
): void {
  // Skip if no theme configured or no extensionCtx
  if (!config.theme || !extensionCtx) return;
  
  // Queue themed placeholder BEFORE agent_start creates the loader
  // This sets pendingWorkingMessage which is applied when loader is created
  setWorkingMessage(`Channeling ${config.theme}...`);
  
  // Mark vibe generation time for rate limiting
  lastVibeTime = Date.now();
  
  // Async: generate and update (fire-and-forget, don't await)
  generateAndUpdate(prompt, setWorkingMessage);
}

export function onVibeAgentStart(): void {
  isStreaming = true;
}

export function onVibeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  setWorkingMessage: (msg?: string) => void,
): void {
  // Skip if no theme, not streaming, or no extensionCtx
  if (!config.theme || !extensionCtx || !isStreaming) return;
  
  // Rate limit: skip if not enough time has passed
  const now = Date.now();
  if (now - lastVibeTime < config.refreshInterval) return;
  
  // Build context hint from tool name and input
  let hint = `using ${toolName} tool`;
  if (toolName === "read" && toolInput.path) {
    hint = `reading file: ${toolInput.path}`;
  } else if (toolName === "write" && toolInput.path) {
    hint = `writing file: ${toolInput.path}`;
  } else if (toolName === "edit" && toolInput.path) {
    hint = `editing file: ${toolInput.path}`;
  } else if (toolName === "bash" && toolInput.command) {
    const cmd = String(toolInput.command).slice(0, 40);
    hint = `running command: ${cmd}`;
  }
  
  // Update time and generate new vibe
  lastVibeTime = now;
  generateAndUpdate(hint, setWorkingMessage);
}

export function onVibeAgentEnd(setWorkingMessage: (msg?: string) => void): void {
  isStreaming = false;
  // Cancel any in-flight generation
  currentGeneration?.abort();
  // Reset to pi's default working message
  setWorkingMessage(undefined);
}
