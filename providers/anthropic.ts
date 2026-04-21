/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "../settings";
import type {
    ImproveTextModel,
    ImproveTextProviderError,
    ImproveTextRequest,
    ImproveTextResponse,
    ListModelsResult,
    ProviderAdapter,
} from "../types";

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_MODELS_ENDPOINT = `${ANTHROPIC_API_BASE}/models`;
const ANTHROPIC_MESSAGES_ENDPOINT = `${ANTHROPIC_API_BASE}/messages`;
const ANTHROPIC_API_VERSION = "2023-06-01";

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

type AnthropicModel = {
    id?: unknown;
    display_name?: unknown;
};

type AnthropicModelsApiResponse = {
    data?: unknown;
};

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

function createAnthropicHeaders(apiKey: string): HeadersInit {
    return {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
    };
}

async function parseJsonSafe(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

function normalizeModel(item: AnthropicModel): ImproveTextModel | null {
    if (typeof item.id !== "string" || !item.id.trim()) return null;

    const displayName = typeof item.display_name === "string" && item.display_name.trim()
        ? item.display_name
        : item.id;

    return {
        id: item.id,
        label: displayName,
    };
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

async function fetchAnthropic(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const response = await fetch(input, init);

    if (response.ok) return response;

    const responseBody = await parseJsonSafe(response);
    throw new AnthropicHttpError(response.status, responseBody);
}

async function listModels(request?: { signal?: AbortSignal; }): Promise<ListModelsResult> {
    const apiKey = getAnthropicApiKey();
    const response = await fetchAnthropic(ANTHROPIC_MODELS_ENDPOINT, {
        method: "GET",
        headers: createAnthropicHeaders(apiKey),
        signal: request?.signal,
    });

    const body = await parseJsonSafe(response) as AnthropicModelsApiResponse;
    const rawModels = Array.isArray(body.data) ? body.data : [];

    const models = rawModels
        .map(model => normalizeModel(model as AnthropicModel))
        .filter((model): model is ImproveTextModel => model !== null);

    return {
        providerId: "anthropic",
        models,
    };
}

async function improveText(request: ImproveTextRequest): Promise<ImproveTextResponse> {
    const apiKey = getAnthropicApiKey();
    const input = request.stylePreset?.trim()
        ? `Rewrite the following text in a ${request.stylePreset.trim()} style:\n\n${request.input}`
        : request.input;

    const response = await fetchAnthropic(ANTHROPIC_MESSAGES_ENDPOINT, {
        method: "POST",
        headers: {
            ...createAnthropicHeaders(apiKey),
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: request.model,
            max_tokens: 1024,
            messages: [{
                role: "user",
                content: input,
            }],
        }),
        signal: request.signal,
    });

    const body = await parseJsonSafe(response) as AnthropicMessagesApiResponse;
    const output = extractOutputText(body);

    return {
        providerId: "anthropic",
        model: request.model,
        output,
        finishReason: mapStopReason(body.stop_reason),
    };
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
    listModels,
    improveText,
    mapError,
};
