/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ImproveTextProviderId, ProviderAdapter } from "../types";
import { anthropicProviderAdapter } from "./anthropic";
import { googleProviderAdapter } from "./google";
import { openAiProviderAdapter } from "./openai";

export const providerAdapters: Record<ImproveTextProviderId, ProviderAdapter> = {
    openai: openAiProviderAdapter,
    anthropic: anthropicProviderAdapter,
    google: googleProviderAdapter,
};

export {
    anthropicProviderAdapter,
    googleProviderAdapter,
    openAiProviderAdapter,
};
