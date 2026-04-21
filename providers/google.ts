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

const GOOGLE_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GOOGLE_MODELS_ENDPOINT = `${GOOGLE_API_BASE}/models`;

class GoogleHttpError extends Error {
    constructor(
        public readonly status: number,
        public readonly responseBody?: unknown,
    ) {
        super(`Google request failed with status ${status}`);
        this.name = "GoogleHttpError";
    }
}

class GoogleConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "GoogleConfigurationError";
    }
}

type GoogleModel = {
    name?: unknown;
    displayName?: unknown;
    description?: unknown;
    supportedGenerationMethods?: unknown;
};

type GoogleListModelsResponse = {
    models?: unknown;
    nextPageToken?: unknown;
};

type GoogleGenerateContentPart = {
    text?: unknown;
};

type GoogleGenerateContentContent = {
    parts?: unknown;
};

type GoogleGenerateContentCandidate = {
    content?: unknown;
    finishReason?: unknown;
};

type GoogleGenerateContentResponse = {
    candidates?: unknown;
};

function getGoogleApiKey(): string {
    const apiKey = settings.store.googleApiKey?.trim();
    if (!apiKey) {
        throw new GoogleConfigurationError("Google API key is not configured.");
    }

    return apiKey;
}

function withApiKey(url: string, apiKey: string): string {
    const requestUrl = new URL(url);
    requestUrl.searchParams.set("key", apiKey);
    return requestUrl.toString();
}

async function parseJsonSafe(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

function supportsGenerateContent(item: GoogleModel): boolean {
    if (!Array.isArray(item.supportedGenerationMethods)) return true;

    return item.supportedGenerationMethods.some(method => method === "generateContent");
}

function normalizeModel(item: GoogleModel): ImproveTextModel | null {
    if (typeof item.name !== "string" || !item.name.trim()) return null;
    if (!supportsGenerateContent(item)) return null;

    const label = typeof item.displayName === "string" && item.displayName.trim()
        ? item.displayName
        : item.name;
    const description = typeof item.description === "string" && item.description.trim()
        ? item.description
        : undefined;

    return {
        id: item.name,
        label,
        description,
    };
}

function normalizeModelName(model: string): string {
    const trimmedModel = model.trim();
    if (trimmedModel.startsWith("models/")) {
        return trimmedModel;
    }

    return `models/${trimmedModel}`;
}

function extractOutputText(responseBody: GoogleGenerateContentResponse): string {
    if (!Array.isArray(responseBody.candidates)) {
        throw new GoogleHttpError(502, null);
    }

    for (const rawCandidate of responseBody.candidates) {
        if (!rawCandidate || typeof rawCandidate !== "object") continue;

        const { content } = rawCandidate as GoogleGenerateContentCandidate;
        if (!content || typeof content !== "object") continue;

        const { parts } = content as GoogleGenerateContentContent;
        if (!Array.isArray(parts)) continue;

        const textParts: string[] = [];

        for (const rawPart of parts) {
            if (!rawPart || typeof rawPart !== "object") continue;

            const { text } = rawPart as GoogleGenerateContentPart;
            if (typeof text === "string" && text.trim()) {
                textParts.push(text.trim());
            }
        }

        if (textParts.length > 0) {
            return textParts.join("\n\n");
        }
    }

    throw new GoogleHttpError(502, null);
}

function mapFinishReason(finishReason: unknown): ImproveTextResponse["finishReason"] {
    if (finishReason === "MAX_TOKENS") return "length";
    if (finishReason === "SAFETY" || finishReason === "RECITATION" || finishReason === "BLOCKLIST" || finishReason === "PROHIBITED_CONTENT" || finishReason === "SPII") {
        return "content_filter";
    }

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

async function fetchGoogle(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const response = await fetch(input, init);

    if (response.ok) return response;

    const responseBody = await parseJsonSafe(response);
    throw new GoogleHttpError(response.status, responseBody);
}

async function listModels(request?: { signal?: AbortSignal; }): Promise<ListModelsResult> {
    const apiKey = getGoogleApiKey();
    const seenModelIds = new Set<string>();
    const models: ImproveTextModel[] = [];
    let nextPageToken: string | null = null;

    do {
        const endpointUrl = new URL(withApiKey(GOOGLE_MODELS_ENDPOINT, apiKey));
        if (nextPageToken) {
            endpointUrl.searchParams.set("pageToken", nextPageToken);
        }

        const response = await fetchGoogle(endpointUrl, {
            method: "GET",
            signal: request?.signal,
        });

        const body = await parseJsonSafe(response) as GoogleListModelsResponse;
        const rawModels = Array.isArray(body.models) ? body.models : [];

        for (const rawModel of rawModels) {
            const model = normalizeModel(rawModel as GoogleModel);
            if (!model || seenModelIds.has(model.id)) continue;

            seenModelIds.add(model.id);
            models.push(model);
        }

        nextPageToken = typeof body.nextPageToken === "string" && body.nextPageToken.trim()
            ? body.nextPageToken
            : null;
    } while (nextPageToken);

    return {
        providerId: "google",
        models,
    };
}

async function improveText(request: ImproveTextRequest): Promise<ImproveTextResponse> {
    const apiKey = getGoogleApiKey();
    const modelName = normalizeModelName(request.model);
    const input = request.stylePreset?.trim()
        ? `Rewrite the following text in a ${request.stylePreset.trim()} style:\n\n${request.input}`
        : request.input;

    const endpoint = withApiKey(`${GOOGLE_API_BASE}/${modelName}:generateContent`, apiKey);
    const response = await fetchGoogle(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            contents: [{
                role: "user",
                parts: [{ text: input }],
            }],
        }),
        signal: request.signal,
    });

    const body = await parseJsonSafe(response) as GoogleGenerateContentResponse;
    const output = extractOutputText(body);
    const firstCandidate = Array.isArray(body.candidates) ? body.candidates[0] as GoogleGenerateContentCandidate | undefined : undefined;

    return {
        providerId: "google",
        model: modelName,
        output,
        finishReason: mapFinishReason(firstCandidate?.finishReason),
    };
}

function mapError(error: unknown): ImproveTextProviderError {
    if (error instanceof GoogleConfigurationError) {
        return {
            providerId: "google",
            code: "missing_api_key",
            message: "Google API key is missing. Add it in plugin settings.",
            retryable: false,
            cause: error,
        };
    }

    if (isAbortError(error)) {
        return {
            providerId: "google",
            code: "aborted",
            message: "Google request was cancelled.",
            retryable: false,
            cause: error,
        };
    }

    if (error instanceof GoogleHttpError) {
        if (error.status === 400) {
            return {
                providerId: "google",
                code: "request_failed",
                message: "Google rejected the request. Check model selection and input.",
                retryable: false,
                cause: error,
            };
        }

        if (error.status === 401 || error.status === 403) {
            return {
                providerId: "google",
                code: "auth_error",
                message: "Google authentication failed. Check your API key.",
                retryable: false,
                cause: error,
            };
        }

        if (error.status === 429) {
            return {
                providerId: "google",
                code: "rate_limited",
                message: "Google rate limit reached. Try again shortly.",
                retryable: true,
                cause: error,
            };
        }

        const isServerError = error.status >= 500;

        return {
            providerId: "google",
            code: "request_failed",
            message: `Google request failed with status ${error.status}.`,
            retryable: isServerError,
            cause: error,
        };
    }

    if (isNetworkError(error)) {
        return {
            providerId: "google",
            code: "network_error",
            message: "Network error while contacting Google.",
            retryable: true,
            cause: error,
        };
    }

    return {
        providerId: "google",
        code: "unknown_error",
        message: "Unexpected Google provider error.",
        retryable: false,
        cause: error,
    };
}

export const googleProviderAdapter: ProviderAdapter = {
    id: "google",
    listModels,
    improveText,
    mapError,
};
