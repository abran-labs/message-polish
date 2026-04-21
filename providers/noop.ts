/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type {
    ImproveTextProviderError,
    ImproveTextProviderId,
    ImproveTextRequest,
    ImproveTextResponse,
    ProviderAdapter,
} from "../types";

function createNotImplementedError(providerId: ImproveTextProviderId, error: unknown): ImproveTextProviderError {
    const message = error instanceof Error ? error.message : "Provider adapter is not implemented yet.";

    return {
        providerId,
        code: "not_implemented",
        message,
        retryable: false,
        cause: error,
    };
}

function createStubImproveResponse(request: ImproveTextRequest): ImproveTextResponse {
    return {
        providerId: request.providerId,
        model: request.model,
        output: request.input,
        finishReason: "not_implemented",
    };
}

export function createStubProviderAdapter(providerId: ImproveTextProviderId): ProviderAdapter {
    return {
        id: providerId,
        improveText: async request => createStubImproveResponse(request),
        mapError: error => createNotImplementedError(providerId, error),
    };
}
