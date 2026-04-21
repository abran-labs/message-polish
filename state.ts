/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ImproveTextState } from "./types";

const DEFAULT_STATE: ImproveTextState = {
    providerId: "noop",
    isWorking: false,
    lastError: null,
};

let state: ImproveTextState = { ...DEFAULT_STATE };

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
