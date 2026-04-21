/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
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
                d="M1107.3 299.1c-197.999 0-373.9 127.3-435.2 315.3L650 743.5v427.9c0 21.4 11 40.4 29.4 51.4l344.5 198.515V833.3h.1v-27.9L1372.7 604c33.715-19.52 70.44-32.857 108.47-39.828L1447.6 450.3C1361 353.5 1237.1 298.5 1107.3 299.1zm0 117.5-.6.6c79.699 0 156.3 27.5 217.6 78.4-2.5 1.2-7.4 4.3-11 6.1L952.8 709.3c-18.4 10.4-29.4 30-29.4 51.4V1248l-155.1-89.4V755.8c-.1-187.099 151.601-338.9 339-339.2z"
            />
            <use href="#vc-ai-polish-icon" transform="rotate(60 1203 1203)" />
            <use href="#vc-ai-polish-icon" transform="rotate(120 1203 1203)" />
            <use href="#vc-ai-polish-icon" transform="rotate(180 1203 1203)" />
            <use href="#vc-ai-polish-icon" transform="rotate(240 1203 1203)" />
            <use href="#vc-ai-polish-icon" transform="rotate(300 1203 1203)" />
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
    const { showChatBarButton } = settings.use(["showChatBarButton"]);
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

    chatBarButton: {
        icon: ImproveTextIcon,
        render: ImproveTextButton,
    }
});
