/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ImproveTextState } from "./types";

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
}

export function restoreOriginalDraft(channelId: string): boolean {
    const original = originalDraftByChannel.get(channelId);
    if (original == null) return false;

    draftController.replaceDraft(channelId, original);
    originalDraftByChannel.delete(channelId);
    return true;
}

export function beginDraftReplacement(channelId: string, placeholder: string): string {
    const original = snapshotOriginalDraft(channelId);
    draftController.replaceDraft(channelId, placeholder);
    return original;
}

export function commitDraftReplacement(channelId: string, improvedText: string): void {
    draftController.replaceDraft(channelId, improvedText);
    originalDraftByChannel.delete(channelId);
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

export function clearChannelAbortToken(channelId: string, token?: number): boolean {
    const existing = abortStateByChannel.get(channelId);
    if (existing == null) return false;

    if (token != null && existing.token !== token) return false;
    abortStateByChannel.delete(channelId);
    return true;
}
