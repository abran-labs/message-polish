/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import definePlugin, { IconComponent } from "@utils/types";
import { DraftStore, DraftType, showToast, Toasts, useStateFromStores } from "@webpack/common";

import { providerAdapters } from "./providers";
import { settings } from "./settings";
import { buildImproveTextPrompt, resolveChannelStylePreset } from "./state";
import type { ImproveTextProviderId } from "./types";

const armedChannels = new Set<string>();
const inFlightChannels = new Set<string>();
type ToastType = (typeof Toasts.Type)[keyof typeof Toasts.Type];

const ImproveTextIcon: IconComponent = ({ height = 20, width = 20, className }) => {
    return (
        <svg
            fill="currentColor"
            width={width}
            height={height}
            className={className}
            viewBox="0 0 24 24"
            style={{ scale: "1.1" }}
        >
            <path d="M4 3h10a1 1 0 1 1 0 2H9.41l4.3 4.3a1 1 0 0 1-1.42 1.4L8 6.42V11a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1Zm7 10h9a1 1 0 1 1 0 2h-3.59l1.3 1.3a1 1 0 0 1-1.42 1.4L15 16.41V20a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Zm-7 3a1 1 0 0 1 1 1v2h2a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
        </svg>
    );
};

const getDraft = (channelId: string) => DraftStore.getDraft(channelId, DraftType.ChannelMessage);

function notify(message: string, type: ToastType = Toasts.Type.SUCCESS): void {
    showToast(message, type);
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

function toggleArmedChannel(channelId: string): void {
    const configuration = validateConfiguration();
    if (configuration == null) return;

    if (armedChannels.has(channelId)) {
        armedChannels.delete(channelId);
        notify("AI improve cancelled for the next send.");
        return;
    }

    armedChannels.add(channelId);
    notify("AI improve armed for your next send.");
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

    if (!shouldShowImproveTextButton({ isAnyChat, showChatBarButton, draft })) return null;

    const armed = armedChannels.has(channelId);

    return (
        <ChatBarButton
            tooltip={armed ? "AI improve armed for next send" : "Improve next send with AI"}
            onClick={() => toggleArmedChannel(channelId)}
        >
            <span style={{ color: armed ? "var(--brand-500)" : undefined, display: "inline-flex" }}>
                <ImproveTextIcon />
            </span>
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "AiImproveText",
    description: "Improve your next sent message with AI.",
    authors: [{ name: "Sisyphus", id: 0n }],
    dependencies: ["ChatInputButtonAPI"],
    settings,

    async onBeforeMessageSend(channelId, messageObj) {
        if (!armedChannels.has(channelId)) return;
        armedChannels.delete(channelId);

        if (inFlightChannels.has(channelId)) {
            return { cancel: true };
        }

        const configuration = validateConfiguration();
        if (configuration == null) {
            return { cancel: true };
        }

        const { providerId, model } = configuration;
        const providerAdapter = providerAdapters[providerId];
        const input = messageObj.content?.trim();
        if (!input) return;

        inFlightChannels.add(channelId);
        notify("Improving message before send...");

        const timeoutSignal = AbortSignal.timeout(20_000);

        try {
            const stylePreset = resolveChannelStylePreset(channelId, settings.store.stylePreset);
            const prompt = buildImproveTextPrompt(input, stylePreset);
            const response = await providerAdapter.improveText({
                providerId,
                model,
                input: prompt,
                stylePreset,
                signal: timeoutSignal,
            });

            if (!response.output.trim()) {
                notify("AI returned empty text. Message was not sent.", Toasts.Type.FAILURE);
                return { cancel: true };
            }

            messageObj.content = response.output;
            notify("Message improved with AI.");
        } catch (error) {
            const providerError = providerAdapter.mapError(error);
            notify(providerError.message, Toasts.Type.FAILURE);
            return { cancel: true };
        } finally {
            inFlightChannels.delete(channelId);
        }
    },

    stop() {
        armedChannels.clear();
        inFlightChannels.clear();
    },

    chatBarButton: {
        icon: ImproveTextIcon,
        render: ImproveTextButton,
    }
});
