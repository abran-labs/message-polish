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
        description: "Show the AI message polish button. Right-click the button to pick styles and toggle context.",
        default: true,
        restartNeeded: true,
    },
    provider: {
        type: OptionType.SELECT,
        description: "AI provider used for text improvement",
        options: [
            { label: "OpenAI", value: "openai", default: true },
            { label: "Codex OAuth (experimental)", value: "codex_oauth" },
            { label: "Anthropic", value: "anthropic" },
            { label: "Google", value: "google" }
        ] as const,
    },
    model: {
        type: OptionType.STRING,
        description: "Manual model ID to use for the selected provider.",
        default: "",
        placeholder: "e.g. gpt-5, gpt-4.1-mini, claude-3-5-sonnet-latest, gemini-2.5-flash",
        componentProps: {
            type: "text"
        },
    },
    stylePreset: {
        type: OptionType.SELECT,
        description: "Default writing style preset for improved text. Channels use this until you right-click the button to pick a channel-specific style.",
        options: [
            { label: "Professional", value: "professional", default: true },
            { label: "Business", value: "business" },
            { label: "Casual", value: "casual" },
            { label: "Concise", value: "concise" },
            { label: "Explain", value: "explain" },
            { label: "Prompt", value: "prompt" },
            { label: "Pirate", value: "pirate" },
            { label: "Flirt", value: "flirt" }
        ] as const,
    },
    channelStyleMemory: {
        type: OptionType.CUSTOM,
        default: {},
        hidden: true,
    },
    channelReadContextMemory: {
        type: OptionType.CUSTOM,
        default: {},
        hidden: true,
    },
    channelRephraseMemory: {
        type: OptionType.CUSTOM,
        default: {},
        hidden: true,
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
