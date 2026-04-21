/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { migratePluginSettings } from "@api/Settings";
import { copyWithToast } from "@utils/discord";
import definePlugin, { IconComponent } from "@utils/types";
import { DraftStore, DraftType, Toasts, useStateFromStores } from "@webpack/common";

import { providerAdapters } from "./providers";
import { settings } from "./settings";
import { buildImproveTextPrompt, normalizeStylePreset } from "./state";
import type { ImproveTextProviderId, ImproveTextStylePreset } from "./types";

const inFlightChannels = new Set<string>();
type ToastType = (typeof Toasts.Type)[keyof typeof Toasts.Type];
const STYLE_ORDER: ImproveTextStylePreset[] = ["professional", "business", "casual", "concise", "explain"];

const ImproveTextIcon: IconComponent = ({ height = 20, width = 20, className }) => {
    return (
        <svg
            fill="currentColor"
            width={width}
            height={height}
            className={className}
            viewBox="0 0 2406 2406"
        >
            <path
                id="vc-ai-polish-icon"
                fill="currentColor"
                d="m 1069.4812,15.006372 c -259.69187,0 -490.40032,166.964428 -570.80032,413.541438 l -28.98595,169.32525 v 561.22614 c 0,28.0671 14.42745,52.9877 38.56045,67.4151 l 451.83967,260.3676 V 715.65307 h 0.13129 V 679.06001 L 1417.5743,414.90747 c 44.2199,-25.60195 92.39,-43.09458 142.2672,-52.23762 L 1515.8118,213.31757 C 1402.23,86.356431 1239.7235,14.219434 1069.4812,15.006372 Z m 0,154.110838 -0.7873,0.78695 c 104.5333,0 205.0011,36.06846 285.4011,102.82794 -3.2798,1.57391 -9.7064,5.63984 -14.4278,8.00074 L 866.84174,553.017 c -24.13313,13.64054 -38.56052,39.34739 -38.56052,67.41525 V 1259.5662 L 624.85492,1142.3101 V 614.00549 C 624.72384,368.60997 823.69208,169.51057 1069.4812,169.11721 Z"
            />
            <use href="#vc-ai-polish-icon" transform="rotate(60 1195 1200.5455)" />
            <use href="#vc-ai-polish-icon" transform="rotate(120 1194.9999 1200.5456)" />
            <use href="#vc-ai-polish-icon" transform="rotate(180 1194.9999 1200.5455)" />
            <use href="#vc-ai-polish-icon" transform="rotate(-120 1194.9999 1200.5456)" />
            <use href="#vc-ai-polish-icon" transform="rotate(-60 1195 1200.5454)" />
        </svg>
    );
};

const getDraft = (channelId: string) => DraftStore.getDraft(channelId, DraftType.ChannelMessage);

function notify(message: string, type: ToastType = Toasts.Type.SUCCESS): void {
    Toasts.show({
        message,
        id: Toasts.genId(),
        type,
    });
}

function getConfiguredProviderId(): ImproveTextProviderId | null {
    const selectedProvider = settings.store.provider;
    if (selectedProvider === "openai" || selectedProvider === "anthropic" || selectedProvider === "google") {
        return selectedProvider;
    }

    return null;
}

function getProviderApiKey(providerId: ImproveTextProviderId): string {
    switch (providerId) {
        case "openai":
            return settings.store.openAiApiKey?.trim() ?? "";
        case "anthropic":
            return settings.store.anthropicApiKey?.trim() ?? "";
        case "google":
            return settings.store.googleApiKey?.trim() ?? "";
    }
}

function validateConfiguration(): { providerId: ImproveTextProviderId; model: string; } | null {
    const providerId = getConfiguredProviderId();
    if (providerId == null) {
        notify("Select a valid AI provider in plugin settings.", Toasts.Type.FAILURE);
        return null;
    }

    const providerAdapter = providerAdapters[providerId];
    if (providerAdapter == null) {
        notify("Selected provider is unavailable.", Toasts.Type.FAILURE);
        return null;
    }

    const model = settings.store.model?.trim() ?? "";
    if (!model) {
        notify("Select a model in plugin settings.", Toasts.Type.FAILURE);
        return null;
    }

    if (!getProviderApiKey(providerId)) {
        notify(`${providerAdapter.id} API key is missing. Add it in plugin settings.`, Toasts.Type.FAILURE);
        return null;
    }

    return { providerId, model };
}

function getChannelStyleMemory(): Record<string, ImproveTextStylePreset> {
    return (settings.store.channelStyleMemory as Record<string, ImproveTextStylePreset> | undefined) ?? {};
}

function getEffectiveStylePreset(channelId: string): ImproveTextStylePreset {
    const channelStyle = getChannelStyleMemory()[channelId];
    return normalizeStylePreset(channelStyle ?? settings.store.stylePreset);
}

function setEffectiveStylePreset(channelId: string, stylePreset: ImproveTextStylePreset): void {
    settings.store.channelStyleMemory = {
        ...getChannelStyleMemory(),
        [channelId]: stylePreset,
    };
}

function cycleStylePreset(channelId: string): void {
    const currentStyle = getEffectiveStylePreset(channelId);
    const currentIndex = STYLE_ORDER.indexOf(currentStyle);
    const nextStyle = STYLE_ORDER[(currentIndex + 1) % STYLE_ORDER.length];
    setEffectiveStylePreset(channelId, nextStyle);
}

async function improveAndCopyDraft(channelId: string): Promise<void> {
    if (inFlightChannels.has(channelId)) return;

    const configuration = validateConfiguration();
    if (configuration == null) return;

    const input = getDraft(channelId)?.trim();
    if (!input) return;

    const { providerId, model } = configuration;
    const providerAdapter = providerAdapters[providerId];

    inFlightChannels.add(channelId);
    notify("Improving text and copying to clipboard...");

    const timeoutSignal = AbortSignal.timeout(20_000);

    try {
        const stylePreset = getEffectiveStylePreset(channelId);
        const prompt = buildImproveTextPrompt(input, stylePreset);
        const response = await providerAdapter.improveText({
            providerId,
            model,
            input: prompt,
            stylePreset,
            signal: timeoutSignal,
        });

        if (!response.output.trim()) {
            notify("AI returned empty text. Nothing was copied.", Toasts.Type.FAILURE);
            return;
        }

        await copyWithToast(response.output, "Improved message copied to clipboard.");
    } catch (error) {
        const providerError = providerAdapter.mapError(error);
        notify(providerError.message, Toasts.Type.FAILURE);
    } finally {
        inFlightChannels.delete(channelId);
    }
}

export function shouldShowImproveTextButton(options: {
    isAnyChat: boolean;
    showChatBarButton: boolean;
    draft: string | null | undefined;
}): boolean {
    return options.isAnyChat
        && options.showChatBarButton
        && typeof options.draft === "string"
        && options.draft.trim().length > 0;
}

const ImproveTextButton: ChatBarButtonFactory = ({ isAnyChat, channel: { id: channelId } }) => {
    const { showChatBarButton } = settings.use(["showChatBarButton", "stylePreset", "channelStyleMemory"]);
    const draft = useStateFromStores([DraftStore], () => getDraft(channelId));
    const stylePreset = getEffectiveStylePreset(channelId);

    if (!shouldShowImproveTextButton({ isAnyChat, showChatBarButton, draft })) return null;

    return (
        <ChatBarButton
            tooltip={`Improve with AI (${stylePreset})`}
            onClick={() => {
                void improveAndCopyDraft(channelId);
            }}
            onContextMenu={event => {
                event.preventDefault();
                cycleStylePreset(channelId);
            }}
        >
            <ImproveTextIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "MessagePolish",
    description: "Improve your current messages with AI.",
    authors: [{ name: "Sisyphus", id: 0n }],
    dependencies: ["ChatInputButtonAPI"],
    settings,

    stop() {
        inFlightChannels.clear();
    },

    start() {
        migratePluginSettings("MessagePolish", "AiImproveText");
    },

    chatBarButton: {
        icon: ImproveTextIcon,
        render: ImproveTextButton,
    }
});
