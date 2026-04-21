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
    abortAllInFlight,
    allocateChannelAbortToken,
    buildImproveTextPrompt,
    clearChannelAbortToken,
    commitDraftReplacement,
    isCurrentChannelAbortToken,
    patchState,
    resetState,
    resolveChannelStylePreset,
    rollbackDraftReplacement,
    runWithChannelInFlight,
    runWithLoadingPlaceholderLoop,
    setDraftController,
} from "./state";
import type { ImproveTextProviderId } from "./types";

const DraftManager = findByPropsLazy("clearDraft", "saveDraft") as {
    saveDraft(channelId: string, draftType: number, value: string): void;
};
const Transforms = findByPropsLazy("insertNodes", "textToText") as {
    delete(editor: object, options: object): void;
    insertText(editor: object, text: string): void;
};
const Editor = findByPropsLazy("start", "end", "toSlateRange") as {
    start(editor: object, path: never[]): object;
    end(editor: object, path: never[]): object;
};
const activeEditorRefByChannel = new Map<string, any>();
const latestComposerPropsByChannel = new Map<string, any>();

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

function getLiveComposerText(channelId: string): string | null {
    const composerProps = latestComposerPropsByChannel.get(channelId);
    return typeof composerProps?.textValue === "string"
        ? composerProps.textValue
        : null;
}

function logDraftDebug(event: string, data: Record<string, unknown>): void {
    console.warn(`[ai-improve-text] ${event}`, data);
}

function buildRichValueFromText(richValue: unknown, text: string): unknown[] {
    const fallback = [{ children: [{ text }] }];
    if (!Array.isArray(richValue) || richValue.length === 0) {
        return fallback;
    }

    const firstNode = richValue[0];
    if (!firstNode || typeof firstNode !== "object") {
        return fallback;
    }

    return [{
        ...(firstNode as Record<string, unknown>),
        children: [{ text }],
    }];
}

function replaceVisibleComposerText(channelId: string, value: string): boolean {
    const composerProps = latestComposerPropsByChannel.get(channelId);
    logDraftDebug("replaceVisibleComposerText:entry", {
        channelId,
        hasComposerProps: Boolean(composerProps),
        hasOnChange: typeof composerProps?.onChange === "function",
        hasEditorRef: Boolean(activeEditorRefByChannel.get(channelId)),
        value,
    });

    if (typeof composerProps?.onChange === "function") {
        const nextRichValue = buildRichValueFromText(composerProps.richValue, value);

        logDraftDebug("replaceVisibleComposerText:onChange", {
            channelId,
            value,
            onChangeLength: composerProps.onChange.length,
            textValueType: typeof composerProps.textValue,
            richValueIsArray: Array.isArray(composerProps.richValue),
            richValuePreview: Array.isArray(composerProps.richValue)
                ? composerProps.richValue.slice(0, 2)
                : composerProps.richValue,
            nextRichValue,
        });

        try {
            composerProps.onChange(nextRichValue, value, composerProps.channel);

            const liveDraft = getDraft(channelId);
            if (liveDraft === value) {
                logDraftDebug("replaceVisibleComposerText:onChange-success", {
                    channelId,
                    candidate: "rebuilt-richValue-textValue-channel",
                });
                return true;
            }

            logDraftDebug("replaceVisibleComposerText:onChange-mismatch", {
                channelId,
                candidate: "rebuilt-richValue-textValue-channel",
                liveDraft,
            });
        } catch (error) {
            logDraftDebug("replaceVisibleComposerText:onChange-error", {
                channelId,
                candidate: "rebuilt-richValue-textValue-channel",
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : null,
            });
        }
    }

    const editorRef = activeEditorRefByChannel.get(channelId);
    const slateEditor = editorRef?.ref?.current?.getSlateEditor?.();
    if (!slateEditor) {
        logDraftDebug("replaceVisibleComposerText:no-editor", {
            channelId,
            value,
            hasEditorRef: Boolean(editorRef),
        });
        return false;
    }

    logDraftDebug("replaceVisibleComposerText:apply", {
        channelId,
        value,
    });

    Transforms.delete(slateEditor, {
        at: {
            anchor: Editor.start(slateEditor, []),
            focus: Editor.end(slateEditor, []),
        }
    });
    if (value.length > 0) {
        Transforms.insertText(slateEditor, value);
    }

    return true;
}

function captureAndForwardEditorRef(originalSetEditorRef: ((ref: any) => void) | undefined, channelId: string) {
    return (ref: any) => {
        logDraftDebug("captureAndForwardEditorRef", {
            channelId,
            hasRef: Boolean(ref),
        });
        if (ref) {
            activeEditorRefByChannel.set(channelId, ref);
        } else {
            activeEditorRefByChannel.delete(channelId);
        }

        originalSetEditorRef?.(ref);
    };
}

function inspectComposerProps(props: any): null {
    const channelId = props?.channel?.id ?? props?.channelId ?? null;
    if (channelId) {
        latestComposerPropsByChannel.set(channelId, props);
    }

    if (props?.setEditorRef && props?.channel?.id) {
        props.setEditorRef = captureAndForwardEditorRef(props.setEditorRef, props.channel.id);
    }

    console.warn("[ai-improve-text] composer-props", {
        topLevelKeys: props ? Object.keys(props).slice(0, 50) : null,
        hasSetEditorRef: Boolean(props?.setEditorRef),
        hasEditorRef: Boolean(props?.editorRef),
        hasOnChange: typeof props?.onChange === "function",
        onChangeLength: typeof props?.onChange === "function" ? props.onChange.length : null,
        textValueType: typeof props?.textValue,
        richValueIsArray: Array.isArray(props?.richValue),
        channelId,
        type: props?.type ?? null,
    });

    return null;
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

    const stylePreset = resolveChannelStylePreset(channelId, settings.store.stylePreset);
    const prompt = buildImproveTextPrompt(input, stylePreset);

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
                    input: prompt,
                    stylePreset,
                    signal: abortToken.signal,
                }));

                if (!isCurrentChannelAbortToken(channelId, abortToken.token)) return;
                if (!commitDraftReplacement(channelId, response.output)) {
                    notifyImproveError("Draft changed while AI was working, so your latest edits were kept.");
                }
            } catch (error) {
                if (isCurrentChannelAbortToken(channelId, abortToken.token)) {
                    const restored = rollbackDraftReplacement(channelId);
                    if (!restored) {
                        notifyImproveError("Draft changed while AI was working, so your latest edits were kept.");
                        return;
                    }
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
    patches: [{
        find: ".CREATE_FORUM_POST||",
        replacement: {
            match: /(?<=textValue:(\i),editorHeight:\i,channelId:\i\.id\}\)),\i/,
            replace: ",$self.inspectComposerProps(arguments[0])"
        }
    }],

    inspectComposerProps,
    captureAndForwardEditorRef,

    start() {
        setDraftController({
            getDraft(channelId) {
                return getLiveComposerText(channelId)
                    ?? getDraft(channelId)
                    ?? "";
            },
            replaceDraft(channelId, value) {
                if (replaceVisibleComposerText(channelId, value)) {
                    return;
                }

                logDraftDebug("replaceDraft:fallback-saveDraft", {
                    channelId,
                    draftType: DraftType.ChannelMessage,
                    value,
                });
                DraftManager.saveDraft(channelId, DraftType.ChannelMessage, value);
            }
        });
    },

    stop() {
        abortAllInFlight("plugin_stopped");
        resetState();
        activeEditorRefByChannel.clear();
        setDraftController(null);
    },

    chatBarButton: {
        icon: ImproveTextIcon,
        render: ImproveTextButton,
    }
});
