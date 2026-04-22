/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type ImproveTextProviderId = "openai" | "anthropic" | "google";
export type ImproveTextStylePreset = "professional" | "business" | "casual" | "concise" | "explain";

export type ImproveTextProviderSelection = ImproveTextProviderId | "noop";

export interface ImproveTextRequest {
    providerId: ImproveTextProviderId;
    model: string;
    input: string;
    stylePreset?: ImproveTextStylePreset;
    signal?: AbortSignal;
}

export interface ImproveTextResponse {
    providerId: ImproveTextProviderId;
    model: string;
    output: string;
    finishReason?: "stop" | "length" | "content_filter" | "error" | "not_implemented";
}

export interface ImproveTextProviderError {
    providerId: ImproveTextProviderId;
    code: string;
    message: string;
    retryable: boolean;
    cause?: unknown;
}

export interface ProviderAdapter {
    id: ImproveTextProviderId;
    improveText(request: ImproveTextRequest): Promise<ImproveTextResponse>;
    mapError(error: unknown): ImproveTextProviderError;
}

export interface ImproveTextState {
    providerId: ImproveTextProviderSelection;
    isWorking: boolean;
    lastError: string | null;
}
