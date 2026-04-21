/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type ImproveTextProviderId = "noop";

export interface ImproveTextProvider {
    id: ImproveTextProviderId;
    label: string;
    isAvailable(): boolean;
    improve(input: string): Promise<string>;
}

export interface ImproveTextState {
    providerId: ImproveTextProviderId;
    isWorking: boolean;
    lastError: string | null;
}
