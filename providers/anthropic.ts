/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PluginNative } from "@utils/types";

import { settings } from "../settings";
import type {
    ImproveTextProviderError,
    ImproveTextRequest,
    ImproveTextResponse,
    ProviderAdapter,
} from "../types";

const Native = VencordNative.pluginHelpers.MessagePolish as PluginNative<typeof import("../native")>;

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

class AnthropicHttpError extends Error {
    constructor(
        public readonly status: number,
        public readonly responseBody?: unknown,
    ) {
        super(`Anthropic request failed with status ${status}`);
        this.name = "AnthropicHttpError";
    }
}

class AnthropicConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AnthropicConfigurationError";
    }
}

type AnthropicTextContentBlock = {
    type?: unknown;
    text?: unknown;
};

type AnthropicMessagesApiResponse = {
    content?: unknown;
    stop_reason?: unknown;
};

function getAnthropicApiKey(): string {
    const apiKey = settings.store.anthropicApiKey?.trim();
    if (!apiKey) {
        throw new AnthropicConfigurationError("Anthropic API key is not configured.");
    }

    return apiKey;
}

async function parseJsonSafe(data: string): Promise<unknown> {
    try {
        return JSON.parse(data);
    } catch {
        return null;
    }
}

function extractOutputText(responseBody: AnthropicMessagesApiResponse): string {
    if (!Array.isArray(responseBody.content)) {
        throw new AnthropicHttpError(502, null);
    }

    const textParts: string[] = [];

    for (const contentBlock of responseBody.content) {
        if (!contentBlock || typeof contentBlock !== "object") continue;

        const { type, text } = contentBlock as AnthropicTextContentBlock;
        if (type !== "text") continue;
        if (typeof text === "string" && text.trim()) {
            textParts.push(text.trim());
        }
    }

    if (textParts.length === 0) {
        throw new AnthropicHttpError(502, null);
    }

    return textParts.join("\n\n");
}

function mapStopReason(stopReason: unknown): ImproveTextResponse["finishReason"] {
    if (stopReason === "max_tokens") return "length";
    if (stopReason === "refusal") return "content_filter";

    return "stop";
}

function isAbortError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "name" in error
        && (error as { name?: unknown; }).name === "AbortError";
}

function isNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    if (error.name === "TypeError") return true;

    return /network|failed to fetch|load failed|fetch/i.test(error.message);
}

function isNativeAbortData(data: string): boolean {
    return /aborterror|aborted|cancelled|canceled/i.test(data);
}

async function fetchAnthropic(dataPromise: Promise<{ status: number; data: string; }>): Promise<string> {
    const response = await dataPromise;

    if (response.status >= 200 && response.status < 300) return response.data;
    if (response.status === -1) {
        if (isNativeAbortData(response.data)) {
            throw new DOMException("Aborted", "AbortError");
        }

        throw new TypeError(response.data);
    }

    const responseBody = await parseJsonSafe(response.data);
    throw new AnthropicHttpError(response.status, responseBody);
}

async function improveText(request: ImproveTextRequest): Promise<ImproveTextResponse> {
    const apiKey = getAnthropicApiKey();
    if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const requestId = createNativeRequestId("anthropic-improve");
    const unbindAbort = bindAbortToNativeRequest(request.signal, requestId);

    try {
        const response = await fetchAnthropic(Native.improveAnthropicText(requestId, apiKey, JSON.stringify({
                model: request.model,
                max_tokens: 1024,
                messages: [{
                    role: "user",
                    content: request.input,
                }],
            })));

        const body = await parseJsonSafe(response) as AnthropicMessagesApiResponse;
        const output = extractOutputText(body);

        return {
            providerId: "anthropic",
            model: request.model,
            output,
            finishReason: mapStopReason(body.stop_reason),
        };
    } finally {
        unbindAbort?.();
    }
}

function mapError(error: unknown): ImproveTextProviderError {
    if (error instanceof AnthropicConfigurationError) {
        return {
            providerId: "anthropic",
            code: "missing_api_key",
            message: "Anthropic API key is missing. Add it in plugin settings.",
            retryable: false,
            cause: error,
        };
    }

    if (isAbortError(error)) {
        return {
            providerId: "anthropic",
            code: "aborted",
            message: "Anthropic request was cancelled.",
            retryable: false,
            cause: error,
        };
    }

    if (error instanceof AnthropicHttpError) {
        if (error.status === 401 || error.status === 403) {
            return {
                providerId: "anthropic",
                code: "auth_error",
                message: "Anthropic authentication failed. Check your API key.",
                retryable: false,
                cause: error,
            };
        }

        if (error.status === 429) {
            return {
                providerId: "anthropic",
                code: "rate_limited",
                message: "Anthropic rate limit reached. Try again shortly.",
                retryable: true,
                cause: error,
            };
        }

        const isServerError = error.status >= 500;

        return {
            providerId: "anthropic",
            code: "request_failed",
            message: `Anthropic request failed with status ${error.status}.`,
            retryable: isServerError,
            cause: error,
        };
    }

    if (isNetworkError(error)) {
        return {
            providerId: "anthropic",
            code: "network_error",
            message: "Network error while contacting Anthropic.",
            retryable: true,
            cause: error,
        };
    }

    return {
        providerId: "anthropic",
        code: "unknown_error",
        message: "Unexpected Anthropic provider error.",
        retryable: false,
        cause: error,
    };
}

export const anthropicProviderAdapter: ProviderAdapter = {
    id: "anthropic",
    improveText,
    mapError,
};
