/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type ImproveTextProviderId = "openai" | "anthropic" | "google";

// Temporary compatibility type for scaffold/runtime defaults that still use noop.
export type ImproveTextProviderSelection = ImproveTextProviderId | "noop";

export interface ImproveTextModel {
    id: string;
    label: string;
    description?: string;
}

export interface ListModelsRequest {
    signal?: AbortSignal;
}

export interface ListModelsResult {
    providerId: ImproveTextProviderId;
    models: ImproveTextModel[];
}

export interface ImproveTextRequest {
    providerId: ImproveTextProviderId;
    model: string;
    input: string;
    stylePreset?: string;
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
    listModels(request?: ListModelsRequest): Promise<ListModelsResult>;
    improveText(request: ImproveTextRequest): Promise<ImproveTextResponse>;
    mapError(error: unknown): ImproveTextProviderError;
}

export interface ImproveTextState {
    providerId: ImproveTextProviderSelection;
    isWorking: boolean;
    lastError: string | null;
}
