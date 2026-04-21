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

async function parseJsonSafe(data: string): Promise<unknown> {
    try {
        return JSON.parse(data);
    } catch {
        return null;
    }
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

function isNativeAbortData(data: string): boolean {
    return /aborterror|aborted|cancelled|canceled/i.test(data);
}

async function fetchGoogle(dataPromise: Promise<{ status: number; data: string; }>): Promise<string> {
    const response = await dataPromise;

    if (response.status >= 200 && response.status < 300) return response.data;
    if (response.status === -1) {
        if (isNativeAbortData(response.data)) {
            throw new DOMException("Aborted", "AbortError");
        }

        throw new TypeError(response.data);
    }

    const responseBody = await parseJsonSafe(response.data);
    throw new GoogleHttpError(response.status, responseBody);
}

async function improveText(request: ImproveTextRequest): Promise<ImproveTextResponse> {
    const apiKey = getGoogleApiKey();
    if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const modelName = normalizeModelName(request.model);

    const requestId = createNativeRequestId("google-improve");
    const unbindAbort = bindAbortToNativeRequest(request.signal, requestId);

    try {
        const response = await fetchGoogle(Native.improveGoogleText(requestId, apiKey, modelName, JSON.stringify({
                contents: [{
                    role: "user",
                    parts: [{ text: request.input }],
                }],
            })));

        const body = await parseJsonSafe(response) as GoogleGenerateContentResponse;
        const output = extractOutputText(body);
        const firstCandidate = Array.isArray(body.candidates) ? body.candidates[0] as GoogleGenerateContentCandidate | undefined : undefined;

        return {
            providerId: "google",
            model: modelName,
            output,
            finishReason: mapFinishReason(firstCandidate?.finishReason),
        };
    } finally {
        unbindAbort?.();
    }
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
    improveText,
    mapError,
};
