/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ImproveTextState, ImproveTextStylePreset } from "./types";

export interface DraftController {
    getDraft(channelId: string): string;
    replaceDraft(channelId: string, value: string): void;
}

interface ChannelAbortState {
    controller: AbortController;
    token: number;
}

export interface ChannelAbortToken {
    channelId: string;
    token: number;
    signal: AbortSignal;
}

const defaultDraftController: DraftController = {
    getDraft(_channelId) {
        throw new Error("Draft controller not configured.");
    },
    replaceDraft(_channelId, _value) {
        throw new Error("Draft controller not configured.");
    }
};

const DEFAULT_STATE: ImproveTextState = {
    providerId: "noop",
    isWorking: false,
    lastError: null,
};

let state: ImproveTextState = { ...DEFAULT_STATE };
let draftController: DraftController = defaultDraftController;

const originalDraftByChannel = new Map<string, string>();
const inFlightChannels = new Set<string>();
const abortStateByChannel = new Map<string, ChannelAbortState>();
const tokenCounterByChannel = new Map<string, number>();
const loadingPlaceholderIntervalByChannel = new Map<string, ReturnType<typeof setInterval>>();
const managedDraftValueByChannel = new Map<string, string>();
const stylePresetByChannel = new Map<string, ImproveTextStylePreset>();

export const LOADING_PLACEHOLDER_BASE_TEXT = "AI is improving text";
export const DEFAULT_STYLE_PRESET: ImproveTextStylePreset = "professional";
export const STYLE_PROMPT_INSTRUCTIONS: Record<ImproveTextStylePreset, string> = {
    professional: "Make it polished, clear, and professional.",
    business: "Make it businesslike, concise, and suitable for a workplace context.",
    casual: "Make it natural, friendly, and conversational without being sloppy.",
    concise: "Make it shorter and tighter while preserving the meaning.",
    explain: "Make it clearer, more explicit, and easier to understand.",
};
const LOADING_PLACEHOLDER_SUFFIXES = [".", "..", "..."] as const;
const LOADING_PLACEHOLDER_INTERVAL_MS = 600;

export function normalizeStylePreset(value: string | null | undefined): ImproveTextStylePreset {
    switch (value) {
        case "professional":
        case "business":
        case "casual":
        case "concise":
        case "explain":
            return value;
        default:
            return DEFAULT_STYLE_PRESET;
    }
}

export function getChannelStylePreset(channelId: string): ImproveTextStylePreset | null {
    return stylePresetByChannel.get(channelId) ?? null;
}

export function setChannelStylePreset(channelId: string, value: string | null | undefined): ImproveTextStylePreset {
    const normalized = normalizeStylePreset(value);
    stylePresetByChannel.set(channelId, normalized);
    return normalized;
}

export function resolveChannelStylePreset(channelId: string, defaultValue: string | null | undefined): ImproveTextStylePreset {
    const existing = stylePresetByChannel.get(channelId);
    if (existing) {
        return existing;
    }

    return setChannelStylePreset(channelId, defaultValue);
}

export function buildImproveTextPrompt(input: string, stylePreset: ImproveTextStylePreset): string {
    return [
        "Improve the following message draft.",
        STYLE_PROMPT_INSTRUCTIONS[stylePreset],
        "Preserve the original intent and meaning.",
        "Keep the same language as the original draft unless the draft itself asks to change language.",
        "Return only the rewritten text with no explanation, framing, or quotes.",
        "",
        "Draft:",
        input,
    ].join("\n");
}

export function getState(): ImproveTextState {
    return state;
}

export function setState(nextState: ImproveTextState): void {
    state = nextState;
}

export function patchState(patch: Partial<ImproveTextState>): void {
    state = {
        ...state,
        ...patch,
    };
}

export function resetState(): void {
    state = { ...DEFAULT_STATE };
    abortAllInFlight("reset");
    inFlightChannels.clear();
    originalDraftByChannel.clear();
    managedDraftValueByChannel.clear();
    stopAllLoadingPlaceholderLoops();
    stylePresetByChannel.clear();
}

export function setDraftController(controller: DraftController | null): void {
    draftController = controller ?? defaultDraftController;
}

export function getOriginalDraftSnapshot(channelId: string): string | null {
    return originalDraftByChannel.get(channelId) ?? null;
}

export function snapshotOriginalDraft(channelId: string): string {
    const existing = originalDraftByChannel.get(channelId);
    if (existing != null) return existing;

    const currentDraft = draftController.getDraft(channelId);
    originalDraftByChannel.set(channelId, currentDraft);
    return currentDraft;
}

export function clearOriginalDraftSnapshot(channelId: string): void {
    originalDraftByChannel.delete(channelId);
}

export function replaceCurrentDraft(channelId: string, value: string): void {
    draftController.replaceDraft(channelId, value);
    managedDraftValueByChannel.set(channelId, value);
}

export function clearManagedDraftTracking(channelId: string): void {
    managedDraftValueByChannel.delete(channelId);
}

export function hasManagedDraftConflict(channelId: string): boolean {
    const expected = managedDraftValueByChannel.get(channelId);
    if (expected == null) return false;

    return draftController.getDraft(channelId) !== expected;
}

export function restoreOriginalDraft(channelId: string): boolean {
    const original = originalDraftByChannel.get(channelId);
    if (original == null) return false;

    if (hasManagedDraftConflict(channelId)) {
        originalDraftByChannel.delete(channelId);
        clearManagedDraftTracking(channelId);
        return false;
    }

    draftController.replaceDraft(channelId, original);
    originalDraftByChannel.delete(channelId);
    clearManagedDraftTracking(channelId);
    return true;
}

export function beginDraftReplacement(channelId: string, placeholder: string): string {
    const original = snapshotOriginalDraft(channelId);
    replaceCurrentDraft(channelId, placeholder);
    return original;
}

export function commitDraftReplacement(channelId: string, improvedText: string): boolean {
    if (hasManagedDraftConflict(channelId)) {
        originalDraftByChannel.delete(channelId);
        clearManagedDraftTracking(channelId);
        return false;
    }

    replaceCurrentDraft(channelId, improvedText);
    originalDraftByChannel.delete(channelId);
    return true;
}

export function rollbackDraftReplacement(channelId: string): boolean {
    return restoreOriginalDraft(channelId);
}

export function isChannelInFlight(channelId: string): boolean {
    return inFlightChannels.has(channelId);
}

export function tryAcquireChannelInFlight(channelId: string): boolean {
    if (inFlightChannels.has(channelId)) return false;
    inFlightChannels.add(channelId);
    return true;
}

export function releaseChannelInFlight(channelId: string): void {
    inFlightChannels.delete(channelId);
}

export async function runWithChannelInFlight<T>(channelId: string, run: () => Promise<T> | T): Promise<T> {
    if (!tryAcquireChannelInFlight(channelId)) {
        throw new Error(`ImproveText request already in-flight for channel ${channelId}.`);
    }

    try {
        return await run();
    } finally {
        releaseChannelInFlight(channelId);
    }
}

export function allocateChannelAbortToken(channelId: string): ChannelAbortToken {
    const existing = abortStateByChannel.get(channelId);
    if (existing != null) {
        existing.controller.abort("superseded");
    }

    const nextToken = (tokenCounterByChannel.get(channelId) ?? 0) + 1;
    tokenCounterByChannel.set(channelId, nextToken);

    const controller = new AbortController();
    abortStateByChannel.set(channelId, {
        controller,
        token: nextToken,
    });

    return {
        channelId,
        token: nextToken,
        signal: controller.signal,
    };
}

export function isCurrentChannelAbortToken(channelId: string, token: number): boolean {
    return abortStateByChannel.get(channelId)?.token === token;
}

export function abortChannelInFlight(channelId: string, reason = "aborted"): boolean {
    const existing = abortStateByChannel.get(channelId);
    if (existing == null) return false;

    existing.controller.abort(reason);
    abortStateByChannel.delete(channelId);
    return true;
}

export function abortAllInFlight(reason = "aborted"): void {
    for (const [channelId, existing] of abortStateByChannel) {
        existing.controller.abort(reason);
        abortStateByChannel.delete(channelId);
    }
}

export function clearChannelAbortToken(channelId: string, token?: number): boolean {
    const existing = abortStateByChannel.get(channelId);
    if (existing == null) return false;

    if (token != null && existing.token !== token) return false;
    abortStateByChannel.delete(channelId);
    return true;
}

export function getLoadingPlaceholderText(step: number): string {
    const suffix = LOADING_PLACEHOLDER_SUFFIXES[step % LOADING_PLACEHOLDER_SUFFIXES.length];
    return `${LOADING_PLACEHOLDER_BASE_TEXT}${suffix}`;
}

export function isLoadingPlaceholderActive(channelId: string): boolean {
    return loadingPlaceholderIntervalByChannel.has(channelId);
}

export function startLoadingPlaceholderLoop(channelId: string): void {
    stopLoadingPlaceholderLoop(channelId);

    let step = 0;
    beginDraftReplacement(channelId, getLoadingPlaceholderText(step));

    const interval = setInterval(() => {
        if (hasManagedDraftConflict(channelId)) {
            stopLoadingPlaceholderLoop(channelId);
            return;
        }

        step += 1;
        replaceCurrentDraft(channelId, getLoadingPlaceholderText(step));
    }, LOADING_PLACEHOLDER_INTERVAL_MS);

    loadingPlaceholderIntervalByChannel.set(channelId, interval);
}

export function stopLoadingPlaceholderLoop(channelId: string): boolean {
    const interval = loadingPlaceholderIntervalByChannel.get(channelId);
    if (interval == null) return false;

    clearInterval(interval);
    loadingPlaceholderIntervalByChannel.delete(channelId);
    return true;
}

export function stopAllLoadingPlaceholderLoops(): void {
    for (const interval of loadingPlaceholderIntervalByChannel.values()) {
        clearInterval(interval);
    }

    loadingPlaceholderIntervalByChannel.clear();
}

export async function runWithLoadingPlaceholderLoop<T>(
    channelId: string,
    run: () => Promise<T> | T,
): Promise<T> {
    startLoadingPlaceholderLoop(channelId);

    try {
        return await run();
    } finally {
        stopLoadingPlaceholderLoop(channelId);
    }
}
