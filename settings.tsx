/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    showChatBarButton: {
        type: OptionType.BOOLEAN,
        description: "Show the Improve Text chat bar button",
        default: true,
        restartNeeded: true,
    },
    provider: {
        type: OptionType.SELECT,
        description: "AI provider used for text improvement",
        options: [
            { label: "OpenAI", value: "openai", default: true },
            { label: "Anthropic", value: "anthropic" },
            { label: "Google", value: "google" }
        ] as const,
    },
    stylePreset: {
        type: OptionType.SELECT,
        description: "Writing style preset for improved text",
        options: [
            { label: "Professional", value: "professional", default: true },
            { label: "Business", value: "business" },
            { label: "Casual", value: "casual" },
            { label: "Concise", value: "concise" },
            { label: "Explain", value: "explain" }
        ] as const,
    },
    openAiApiKey: {
        type: OptionType.STRING,
        description: "OpenAI API key",
        default: "",
        placeholder: "sk-...",
        componentProps: {
            type: "password"
        },
    },
    anthropicApiKey: {
        type: OptionType.STRING,
        description: "Anthropic API key",
        default: "",
        placeholder: "sk-ant-...",
        componentProps: {
            type: "password"
        },
    },
    googleApiKey: {
        type: OptionType.STRING,
        description: "Google API key",
        default: "",
        placeholder: "AIza...",
        componentProps: {
            type: "password"
        },
    }
}).withPrivateSettings<{
    openAiApiKey?: string;
    anthropicApiKey?: string;
    googleApiKey?: string;
}>();
