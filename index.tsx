/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { Button } from "@components/Button";
import { copyWithToast, sendMessage } from "@utils/discord";
import { closeModal, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { IconComponent } from "@utils/types";
import { DraftStore, DraftType, Forms, TextArea, Toasts, useState, useStateFromStores } from "@webpack/common";

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

function toggleArmedChannel(channelId: string): void {
    const configuration = validateConfiguration();
    if (configuration == null) return;

    if (armedChannels.has(channelId)) {
        armedChannels.delete(channelId);
        notify("AI review cancelled for the next send.");
        return;
    }

    armedChannels.add(channelId);
    notify("AI review armed for your next send.");
}

function openImproveReviewModal(options: {
    channelId: string;
    improvedText: string;
    onSendImproved(editedText: string): void;
}): string {
    const key = openModal(modalProps => {
        const [editedText, setEditedText] = useState(options.improvedText);

        return (
            <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
                <ModalHeader>
                    <Forms.FormTitle tag="h2" style={{ flexGrow: 1 }}>Review AI improved message</Forms.FormTitle>
                    <ModalCloseButton onClick={() => closeModal(key)} />
                </ModalHeader>

                <ModalContent>
                    <Forms.FormText style={{ marginBottom: 12 }}>
                        Review and edit the improved message before sending it.
                    </Forms.FormText>
                    <TextArea value={editedText} onChange={setEditedText} />
                </ModalContent>

                <ModalFooter>
                    <div style={{ display: "flex", gap: 8, width: "100%", justifyContent: "flex-end" }}>
                        <Button
                            variant="secondary"
                            onClick={async () => {
                                await copyWithToast(editedText, "Improved message copied to clipboard.");
                            }}
                        >
                            Copy improved
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => closeModal(key)}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={() => {
                                options.onSendImproved(editedText);
                                closeModal(key);
                            }}
                            disabled={!editedText.trim()}
                        >
                            Send improved
                        </Button>
                    </div>
                </ModalFooter>
            </ModalRoot>
        );
    });

    return key;
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
            tooltip={armed ? "AI review armed for next send" : "Review next send with AI"}
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
    description: "Review an AI-improved version of your next message before sending.",
    authors: [{ name: "Sisyphus", id: 0n }],
    dependencies: ["ChatInputButtonAPI"],
    settings,

    async onBeforeMessageSend(channelId, messageObj, options) {
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
        notify("Improving message for review...");

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

            openImproveReviewModal({
                channelId,
                improvedText: response.output,
                onSendImproved: editedText => {
                    void sendMessage(channelId, {
                        content: editedText,
                        tts: messageObj.tts,
                        validNonShortcutEmojis: messageObj.validNonShortcutEmojis,
                        invalidEmojis: messageObj.invalidEmojis,
                    }, true, {
                        stickerIds: options.stickers,
                        attachmentsToUpload: options.uploads,
                        allowedMentions: options.replyOptions.allowedMentions && {
                            parse: options.replyOptions.allowedMentions.parse,
                            replied_user: options.replyOptions.allowedMentions.repliedUser,
                        },
                        messageReference: options.replyOptions.messageReference,
                    });
                    notify("Improved message sent.");
                }
            });

            return { cancel: true };
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
