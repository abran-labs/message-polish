/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ImproveTextStylePreset } from "./types";

const stylePresetByChannel = new Map<string, ImproveTextStylePreset>();

export const DEFAULT_STYLE_PRESET: ImproveTextStylePreset = "professional";
export const STYLE_PROMPT_INSTRUCTIONS: Record<ImproveTextStylePreset, string> = {
    professional: "Make it polished, clear, and professional.",
    business: "Make it businesslike, concise, and suitable for a workplace context.",
    casual: "Make it natural, friendly, and conversational without being sloppy.",
    concise: "Rewrite it to say the same thing as directly and briefly as possible. Rethink the wording, structure, and framing instead of merely shortening sentences. Remove unnecessary explanation, combine ideas, and prefer fewer paragraphs or sentences when the meaning still remains clear.",
    explain: "Make it clearer, more explicit, and easier to understand.",
    prompt: "Turn it into a stronger, clearer prompt for an AI model. Preserve the user's goal, constraints, and intent, but make the prompt easier for an AI to follow.",
    pirate: "Rewrite it in playful pirate speak while preserving the original intent and meaning.",
    flirt: "Make it warmer, more charming, and lightly flirty while preserving the original intent and respecting consent and boundaries.",
};

export const STYLE_MARKDOWN_GUIDANCE: Record<ImproveTextStylePreset, string> = {
    professional: "When it genuinely improves readability, use Discord markdown sparingly for emphasis, short labels, or brief structure. Bold key terms or labels if useful, but avoid over-formatting.",
    business: "Use Discord markdown only when it helps clarity, such as bolding key actions, deadlines, or headings. Keep formatting restrained and professional.",
    casual: "Keep formatting light. Use Discord markdown only if it feels natural, such as a little emphasis or a short bold label, and avoid making it look overly formal.",
    concise: "Avoid headings, lists, and extra formatting unless they make the final message shorter or much easier to scan. Prioritize a compact plain-text answer.",
    explain: "Use Discord markdown when it helps organize the explanation, such as short bold labels or occasional emphasis, but do not turn the message into a heavy structured document.",
    prompt: "Use clear prompt structure only when it helps, such as concise sections for task, context, constraints, and output. Do not add fake requirements or details the draft did not imply.",
    pirate: "Keep Discord markdown minimal. The pirate voice should come from wording, not heavy formatting.",
    flirt: "Keep formatting light and natural. Do not make the message explicit, manipulative, or more intense than the draft implies.",
};

export function normalizeStylePreset(value: string | null | undefined): ImproveTextStylePreset {
    switch (value) {
        case "professional":
        case "business":
        case "casual":
        case "concise":
        case "explain":
        case "prompt":
        case "pirate":
        case "flirt":
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
    const existing = getChannelStylePreset(channelId);
    if (existing) {
        return existing;
    }

    return setChannelStylePreset(channelId, defaultValue);
}

export function buildImproveTextPrompt(input: string, stylePreset: ImproveTextStylePreset, recentContext?: string): string {
    const contextBlock = recentContext
        ? [
            "Recent chat context, oldest to newest:",
            recentContext,
            "Use this context only to make the draft fit the conversation. Do not quote, summarize, or answer the context unless the draft asks for it.",
            "",
        ]
        : [];

    return [
        "Improve the following message draft.",
        STYLE_PROMPT_INSTRUCTIONS[stylePreset],
        STYLE_MARKDOWN_GUIDANCE[stylePreset],
        "Preserve the original intent and meaning.",
        "Keep the same language as the original draft unless the draft itself asks to change language.",
        "Use only Discord-compatible markdown.",
        "Do not use em dashes or semicolons unless the draft clearly requires them. Prefer commas, periods, or simpler sentence structure instead.",
        "Do not add excessive headings, lists, or formatting if the original message does not call for them.",
        "Return only the rewritten text with no explanation, framing, or quotes.",
        "",
        ...contextBlock,
        "Draft:",
        input,
    ].join("\n");
}
