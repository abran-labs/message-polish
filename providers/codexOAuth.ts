/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PluginNative } from "@utils/types";

import type {
    ImproveTextProviderError,
    ImproveTextRequest,
    ImproveTextResponse,
    ProviderAdapter,
} from "../types";

const Native = VencordNative.pluginHelpers.MessagePolish as PluginNative<typeof import("../native")>;

type CodexSseEvent = {
    type?: unknown;
    delta?: unknown;
    item?: unknown;
    response?: unknown;
    error?: unknown;
};

class CodexOAuthHttpError extends Error {
    constructor(
        public readonly status: number,
        public readonly responseBody?: unknown,
    ) {
        super(`Codex OAuth request failed with status ${status}`);
        this.name = "CodexOAuthHttpError";
    }
}

class CodexOAuthNativeTransportError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CodexOAuthNativeTransportError";
    }
}

function createNativeRequestId(prefix: string): string {
    return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function bindAbortToNativeRequest(signal: AbortSignal | undefined, requestId: string): (() => void) | null {
    if (!signal) return null;

    const cancel = () => void Native.cancelNativeRequest(requestId);
    signal.addEventListener("abort", cancel, { once: true });

    if (signal.aborted) {
        cancel();
    }

    return () => signal.removeEventListener("abort", cancel);
}

async function parseJsonSafe(data: string): Promise<unknown> {
    try {
        return JSON.parse(data);
    } catch {
        return null;
    }
}

function isAbortError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "name" in error
        && (error as { name?: unknown; }).name === "AbortError";
}

function isNativeAbortData(data: string): boolean {
    return /aborterror|aborted|cancelled|canceled/i.test(data);
}

function isCodexAuthError(error: unknown): boolean {
    return error instanceof Error && /^CodexAuthError:/i.test(error.message);
}

function sanitizeNativeError(data: string): string {
    return data.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").trim();
}

async function fetchCodex(dataPromise: Promise<{ status: number; data: string; }>): Promise<string> {
    const response = await dataPromise;

    if (response.status >= 200 && response.status < 300) return response.data;
    if (response.status === -1) {
        if (isNativeAbortData(response.data)) {
            throw new DOMException("Aborted", "AbortError");
        }

        throw new CodexOAuthNativeTransportError(sanitizeNativeError(response.data));
    }

    const responseBody = await parseJsonSafe(response.data);
    throw new CodexOAuthHttpError(response.status, responseBody);
}

function extractDoneItemText(item: unknown): string[] {
    if (!item || typeof item !== "object") return [];

    const { content } = item as { content?: unknown; };
    if (!Array.isArray(content)) return [];

    const textParts: string[] = [];
    for (const contentItem of content) {
        if (!contentItem || typeof contentItem !== "object") continue;

        const { type, text } = contentItem as { type?: unknown; text?: unknown; };
        if ((type === "output_text" || type === "text") && typeof text === "string" && text.trim()) {
            textParts.push(text.trim());
        }
    }

    return textParts;
}

function parseCodexSseText(streamText: string): string {
    const textParts: string[] = [];

    for (const eventBlock of streamText.split(/\r?\n\r?\n/)) {
        const dataLines = eventBlock
            .split(/\r?\n/)
            .filter(line => line.startsWith("data:"))
            .map(line => line.slice(5).trimStart());
        if (dataLines.length === 0) continue;

        const data = dataLines.join("\n").trim();
        if (!data || data === "[DONE]") continue;

        const event = JSON.parse(data) as CodexSseEvent;
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
            textParts.push(event.delta);
            continue;
        }

        if (event.type === "response.output_item.done") {
            textParts.push(...extractDoneItemText(event.item));
            continue;
        }

        if (event.type === "response.failed") {
            throw new CodexOAuthHttpError(500, event.error ?? event.response ?? null);
        }
    }

    const output = textParts.join("").trim();
    if (!output) throw new CodexOAuthHttpError(502, null);

    return output;
}

function buildCodexPayload(request: ImproveTextRequest): string {
    return JSON.stringify({
        model: request.model,
        instructions: "",
        input: [
            {
                type: "message",
                role: "user",
                content: [
                    {
                        type: "input_text",
                        text: request.input,
                    },
                ],
            },
        ],
        tools: [],
        tool_choice: "auto",
        parallel_tool_calls: true,
        reasoning: null,
        store: false,
        stream: true,
        include: [],
        service_tier: null,
        prompt_cache_key: null,
        text: null,
        client_metadata: null,
    });
}

async function improveText(request: ImproveTextRequest): Promise<ImproveTextResponse> {
    if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const requestId = createNativeRequestId("codex-oauth-improve");
    const unbindAbort = bindAbortToNativeRequest(request.signal, requestId);

    try {
        const response = await fetchCodex(Native.improveCodexOAuthText(requestId, buildCodexPayload(request)));
        const output = parseCodexSseText(response);

        return {
            providerId: "codex_oauth",
            model: request.model,
            output,
            finishReason: "stop",
        };
    } finally {
        unbindAbort?.();
    }
}

function mapError(error: unknown): ImproveTextProviderError {
    if (isAbortError(error)) {
        return {
            providerId: "codex_oauth",
            code: "aborted",
            message: "Codex OAuth request was cancelled.",
            retryable: false,
            cause: error,
        };
    }

    if (isCodexAuthError(error)) {
        return {
            providerId: "codex_oauth",
            code: "codex_login_required",
            message: "Codex OAuth login is missing or invalid. Run `codex login` and try again.",
            retryable: false,
            cause: error,
        };
    }

    if (error instanceof CodexOAuthHttpError) {
        if (error.status === 401 || error.status === 403) {
            return {
                providerId: "codex_oauth",
                code: "auth_error",
                message: "Codex OAuth authentication failed. Run `codex login` again and try again.",
                retryable: false,
                cause: error,
            };
        }

        if (error.status === 429) {
            return {
                providerId: "codex_oauth",
                code: "rate_limited",
                message: "Codex OAuth rate limit reached. Try again shortly.",
                retryable: true,
                cause: error,
            };
        }

        return {
            providerId: "codex_oauth",
            code: "request_failed",
            message: `Codex OAuth request failed with status ${error.status}.`,
            retryable: error.status >= 500,
            cause: error,
        };
    }

    if (error instanceof CodexOAuthNativeTransportError) {
        return {
            providerId: "codex_oauth",
            code: isCodexAuthError(error) ? "codex_login_required" : "network_error",
            message: isCodexAuthError(error)
                ? "Codex OAuth login is missing or invalid. Run `codex login` and try again."
                : `Network error while contacting Codex OAuth backend. ${error.message}`,
            retryable: !isCodexAuthError(error),
            cause: error,
        };
    }

    return {
        providerId: "codex_oauth",
        code: "unknown_error",
        message: "Unexpected Codex OAuth provider error.",
        retryable: false,
        cause: error,
    };
}

export const codexOAuthProviderAdapter: ProviderAdapter = {
    id: "codex_oauth",
    improveText,
    mapError,
};
