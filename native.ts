/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

const OPENAI_API_BASE = "https://api.openai.com/v1";
const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
const GOOGLE_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const ANTHROPIC_API_VERSION = "2023-06-01";

interface NativeRequestResult {
    status: number;
    data: string;
}

const controllerByRequestId = new Map<string, AbortController>();
const cancelledRequestIds = new Set<string>();

async function performRequest(requestId: string, url: string, init: RequestInit): Promise<NativeRequestResult> {
    if (cancelledRequestIds.has(requestId)) {
        cancelledRequestIds.delete(requestId);
        return {
            status: -1,
            data: "AbortError: request cancelled",
        };
    }

    const controller = new AbortController();
    controllerByRequestId.set(requestId, controller);

    if (cancelledRequestIds.has(requestId)) {
        cancelledRequestIds.delete(requestId);
        controller.abort("cancelled");
    }

    try {
        const response = await fetch(url, {
            ...init,
            signal: controller.signal,
        });
        const data = await response.text();
        return {
            status: response.status,
            data,
        };
    } catch (error) {
        return {
            status: -1,
            data: String(error),
        };
    } finally {
        controllerByRequestId.delete(requestId);
    }
}

function withGoogleApiKey(url: string, apiKey: string, pageToken?: string): string {
    const requestUrl = new URL(url);
    requestUrl.searchParams.set("key", apiKey);
    if (pageToken) {
        requestUrl.searchParams.set("pageToken", pageToken);
    }

    return requestUrl.toString();
}

export function cancelNativeRequest(_: IpcMainInvokeEvent, requestId: string): boolean {
    const controller = controllerByRequestId.get(requestId);
    if (!controller) {
        cancelledRequestIds.add(requestId);
        return false;
    }

    controller.abort("cancelled");
    controllerByRequestId.delete(requestId);
    cancelledRequestIds.delete(requestId);
    return true;
}

export async function listOpenAiModels(_: IpcMainInvokeEvent, requestId: string, apiKey: string): Promise<NativeRequestResult> {
    return await performRequest(requestId, `${OPENAI_API_BASE}/models`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });
}

export async function improveOpenAiText(_: IpcMainInvokeEvent, requestId: string, apiKey: string, payload: string): Promise<NativeRequestResult> {
    return await performRequest(requestId, `${OPENAI_API_BASE}/responses`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: payload,
    });
}

export async function listAnthropicModels(_: IpcMainInvokeEvent, requestId: string, apiKey: string): Promise<NativeRequestResult> {
    return await performRequest(requestId, `${ANTHROPIC_API_BASE}/models`, {
        method: "GET",
        headers: {
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_API_VERSION,
        },
    });
}

export async function improveAnthropicText(_: IpcMainInvokeEvent, requestId: string, apiKey: string, payload: string): Promise<NativeRequestResult> {
    return await performRequest(requestId, `${ANTHROPIC_API_BASE}/messages`, {
        method: "POST",
        headers: {
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_API_VERSION,
            "Content-Type": "application/json",
        },
        body: payload,
    });
}

export async function listGoogleModels(_: IpcMainInvokeEvent, requestId: string, apiKey: string, pageToken?: string): Promise<NativeRequestResult> {
    return await performRequest(requestId, withGoogleApiKey(`${GOOGLE_API_BASE}/models`, apiKey, pageToken), {
        method: "GET",
    });
}

export async function improveGoogleText(_: IpcMainInvokeEvent, requestId: string, apiKey: string, modelName: string, payload: string): Promise<NativeRequestResult> {
    return await performRequest(requestId, withGoogleApiKey(`${GOOGLE_API_BASE}/${modelName}:generateContent`, apiKey), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: payload,
    });
}
