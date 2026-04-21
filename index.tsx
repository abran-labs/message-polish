/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import definePlugin, { IconComponent } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { DraftStore, DraftType, showToast, Toasts, useStateFromStores } from "@webpack/common";

import { providerAdapters } from "./providers";
import { settings } from "./settings";
import {
    allocateChannelAbortToken,
    clearChannelAbortToken,
    commitDraftReplacement,
    isCurrentChannelAbortToken,
    patchState,
    resetState,
    rollbackDraftReplacement,
    runWithChannelInFlight,
    runWithLoadingPlaceholderLoop,
    setDraftController,
} from "./state";
import type { ImproveTextProviderId } from "./types";

const DraftManager = findByPropsLazy("clearDraft", "saveDraft") as {
    saveDraft(channelId: string, draftType: number, value: string): void;
};

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

function notifyImproveError(message: string): void {
    showToast(message, Toasts.Type.FAILURE);
}

export async function improveDraft(channelId: string): Promise<void> {
    const providerId = getConfiguredProviderId();
    if (providerId == null) {
        notifyImproveError("Select a valid AI provider in plugin settings.");
        return;
    }

    const providerAdapter = providerAdapters[providerId];
    if (providerAdapter == null) {
        notifyImproveError("Selected provider is unavailable.");
        return;
    }

    const model = settings.store.model?.trim() ?? "";
    if (!model) {
        notifyImproveError("Select a model in plugin settings.");
        return;
    }

    if (!getProviderApiKey(providerId)) {
        notifyImproveError(`${providerAdapter.id} API key is missing. Add it in plugin settings.`);
        return;
    }

    const input = getDraft(channelId)?.trim();
    if (!input) {
        return;
    }

    try {
        await runWithChannelInFlight(channelId, async () => {
            patchState({
                providerId,
                isWorking: true,
                lastError: null,
            });

            const abortToken = allocateChannelAbortToken(channelId);

            try {
                const response = await runWithLoadingPlaceholderLoop(channelId, () => providerAdapter.improveText({
                    providerId,
                    model,
                    input,
                    stylePreset: settings.store.stylePreset,
                    signal: abortToken.signal,
                }));

                if (!isCurrentChannelAbortToken(channelId, abortToken.token)) return;
                commitDraftReplacement(channelId, response.output);
            } catch (error) {
                if (isCurrentChannelAbortToken(channelId, abortToken.token)) {
                    rollbackDraftReplacement(channelId);
                }

                const providerError = providerAdapter.mapError(error);
                patchState({ lastError: providerError.message });
                notifyImproveError(providerError.message);
            } finally {
                clearChannelAbortToken(channelId, abortToken.token);
                patchState({
                    providerId,
                    isWorking: false,
                });
            }
        });
    } catch (error) {
        if (error instanceof Error && error.message.includes("already in-flight")) {
            return;
        }

        rollbackDraftReplacement(channelId);
        notifyImproveError("Failed to improve text.");
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

    if (!shouldShowImproveTextButton({ isAnyChat, showChatBarButton, draft })) return null;

    return (
        <ChatBarButton
            tooltip="Improve text"
            onClick={() => {
                void improveDraft(channelId);
            }}
        >
            <ImproveTextIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "AiImproveText",
    description: "Scaffold for improving drafted text via pluggable providers.",
    authors: [{ name: "Sisyphus", id: 0n }],
    dependencies: ["ChatInputButtonAPI"],
    settings,

    start() {
        setDraftController({
            getDraft(channelId) {
                return getDraft(channelId) ?? "";
            },
            replaceDraft(channelId, value) {
                DraftManager.saveDraft(channelId, DraftType.ChannelMessage, value);
            }
        });
    },

    stop() {
        setDraftController(null);
        resetState();
    },

    chatBarButton: {
        icon: ImproveTextIcon,
        render: ImproveTextButton,
    }
});
