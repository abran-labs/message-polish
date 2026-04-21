/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PluginNative } from "@utils/types";

import { settings } from "../settings";
import type {
    ImproveTextModel,
    ImproveTextProviderError,
    ImproveTextRequest,
    ImproveTextResponse,
    ListModelsResult,
    ProviderAdapter,
} from "../types";

const Native = VencordNative.pluginHelpers.AiImproveText as PluginNative<typeof import("../native")>;

class OpenAiHttpError extends Error {
    constructor(
        public readonly status: number,
        public readonly responseBody?: unknown,
    ) {
        super(`OpenAI request failed with status ${status}`);
        this.name = "OpenAiHttpError";
    }
}

class OpenAiConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OpenAiConfigurationError";
    }
}

type OpenAiModel = {
    id?: unknown;
};

type OpenAiModelsApiResponse = {
    data?: unknown;
};

type OpenAiResponsesApiResponse = {
    output_text?: unknown;
    output?: unknown;
};

function getOpenAiApiKey(): string {
    const apiKey = settings.store.openAiApiKey?.trim();
    if (!apiKey) {
        throw new OpenAiConfigurationError("OpenAI API key is not configured.");
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

function normalizeModel(item: OpenAiModel): ImproveTextModel | null {
    if (typeof item.id !== "string" || !item.id.trim()) return null;

    return {
        id: item.id,
        label: item.id,
    };
}

function extractOutputText(responseBody: OpenAiResponsesApiResponse): string {
    if (typeof responseBody.output_text === "string") {
        return responseBody.output_text.trim();
    }

    if (Array.isArray(responseBody.output)) {
        const textParts: string[] = [];

        for (const outputItem of responseBody.output) {
            if (!outputItem || typeof outputItem !== "object") continue;

            const { content } = outputItem as { content?: unknown; };
            if (!Array.isArray(content)) continue;

            for (const contentItem of content) {
                if (!contentItem || typeof contentItem !== "object") continue;

                const { type } = contentItem as { type?: unknown; };
                if (type !== "output_text") continue;

                const { text } = contentItem as { text?: unknown; };
                if (typeof text === "string" && text.trim()) {
                    textParts.push(text.trim());
                }
            }
        }

        if (textParts.length > 0) {
            return textParts.join("\n\n");
        }
    }

    throw new OpenAiHttpError(502, null);
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

async function fetchOpenAi(dataPromise: Promise<{ status: number; data: string; }>): Promise<string> {
    const response = await dataPromise;

    if (response.status >= 200 && response.status < 300) return response.data;

    const responseBody = await parseJsonSafe(response.data);
    throw new OpenAiHttpError(response.status, responseBody);
}

async function listModels(request?: { signal?: AbortSignal; }): Promise<ListModelsResult> {
    const apiKey = getOpenAiApiKey();
    if (request?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const response = await fetchOpenAi(Native.listOpenAiModels(apiKey));

    const body = await parseJsonSafe(response) as OpenAiModelsApiResponse;
    const rawModels = Array.isArray(body.data) ? body.data : [];

    const models = rawModels
        .map(model => normalizeModel(model as OpenAiModel))
        .filter((model): model is ImproveTextModel => model !== null);

    return {
        providerId: "openai",
        models,
    };
}

async function improveText(request: ImproveTextRequest): Promise<ImproveTextResponse> {
    const apiKey = getOpenAiApiKey();
    if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const response = await fetchOpenAi(Native.improveOpenAiText(apiKey, JSON.stringify({
            model: request.model,
            input: request.input,
        })));

    const body = await parseJsonSafe(response) as OpenAiResponsesApiResponse;
    const output = extractOutputText(body);

    return {
        providerId: "openai",
        model: request.model,
        output,
        finishReason: "stop",
    };
}

function mapError(error: unknown): ImproveTextProviderError {
    if (error instanceof OpenAiConfigurationError) {
        return {
            providerId: "openai",
            code: "missing_api_key",
            message: "OpenAI API key is missing. Add it in plugin settings.",
            retryable: false,
            cause: error,
        };
    }

    if (isAbortError(error)) {
        return {
            providerId: "openai",
            code: "aborted",
            message: "OpenAI request was cancelled.",
            retryable: false,
            cause: error,
        };
    }

    if (error instanceof OpenAiHttpError) {
        if (error.status === 401) {
            return {
                providerId: "openai",
                code: "auth_error",
                message: "OpenAI authentication failed. Check your API key.",
                retryable: false,
                cause: error,
            };
        }

        if (error.status === 429) {
            return {
                providerId: "openai",
                code: "rate_limited",
                message: "OpenAI rate limit reached. Try again shortly.",
                retryable: true,
                cause: error,
            };
        }

        const isServerError = error.status >= 500;

        return {
            providerId: "openai",
            code: "request_failed",
            message: `OpenAI request failed with status ${error.status}.`,
            retryable: isServerError,
            cause: error,
        };
    }

    if (isNetworkError(error)) {
        return {
            providerId: "openai",
            code: "network_error",
            message: "Network error while contacting OpenAI.",
            retryable: true,
            cause: error,
        };
    }

    return {
        providerId: "openai",
        code: "unknown_error",
        message: "Unexpected OpenAI provider error.",
        retryable: false,
        cause: error,
    };
}

export const openAiProviderAdapter: ProviderAdapter = {
    id: "openai",
    listModels,
    improveText,
    mapError,
};
