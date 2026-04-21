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

async function performRequest(url: string, init: RequestInit): Promise<NativeRequestResult> {
    try {
        const response = await fetch(url, init);
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

export async function listOpenAiModels(_: IpcMainInvokeEvent, apiKey: string): Promise<NativeRequestResult> {
    return await performRequest(`${OPENAI_API_BASE}/models`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });
}

export async function improveOpenAiText(_: IpcMainInvokeEvent, apiKey: string, payload: string): Promise<NativeRequestResult> {
    return await performRequest(`${OPENAI_API_BASE}/responses`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: payload,
    });
}

export async function listAnthropicModels(_: IpcMainInvokeEvent, apiKey: string): Promise<NativeRequestResult> {
    return await performRequest(`${ANTHROPIC_API_BASE}/models`, {
        method: "GET",
        headers: {
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_API_VERSION,
        },
    });
}

export async function improveAnthropicText(_: IpcMainInvokeEvent, apiKey: string, payload: string): Promise<NativeRequestResult> {
    return await performRequest(`${ANTHROPIC_API_BASE}/messages`, {
        method: "POST",
        headers: {
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_API_VERSION,
            "Content-Type": "application/json",
        },
        body: payload,
    });
}

export async function listGoogleModels(_: IpcMainInvokeEvent, apiKey: string, pageToken?: string): Promise<NativeRequestResult> {
    return await performRequest(withGoogleApiKey(`${GOOGLE_API_BASE}/models`, apiKey, pageToken), {
        method: "GET",
    });
}

export async function improveGoogleText(_: IpcMainInvokeEvent, apiKey: string, modelName: string, payload: string): Promise<NativeRequestResult> {
    return await performRequest(withGoogleApiKey(`${GOOGLE_API_BASE}/${modelName}:generateContent`, apiKey), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: payload,
    });
}
