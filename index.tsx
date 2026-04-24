/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { showNotification } from "@api/Notifications";
import { migratePluginSettings } from "@api/Settings";
import definePlugin, { IconComponent } from "@utils/types";
import { ContextMenuApi, DraftStore, DraftType, Menu, React, Toasts, useStateFromStores } from "@webpack/common";

import { providerAdapters } from "./providers";
import { settings } from "./settings";
import { buildImproveTextPrompt, normalizeStylePreset } from "./state";
import type { ImproveTextProviderId, ImproveTextStylePreset } from "./types";

const inFlightChannels = new Set<string>();
type ToastType = (typeof Toasts.Type)[keyof typeof Toasts.Type];
type ButtonVisualState = "idle" | "loading" | "success";
const STYLE_ORDER: ImproveTextStylePreset[] = ["professional", "business", "casual", "concise", "explain"];

const ImproveTextIcon: IconComponent & { visualState?: ButtonVisualState; } = ({
    height = 20,
    width = 20,
    className,
    visualState = "idle",
}) => {
    if (visualState === "loading") {
        return (
            <svg
                fill="none"
                width={width}
                height={height}
                className={className}
                viewBox="0 0 24 24"
            >
                <circle cx="12" cy="12" r="8" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
                <path d="M 12 4 A 8 8 0 0 1 20 12" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5">
                    <animateTransform
                        attributeName="transform"
                        attributeType="XML"
                        dur="0.8s"
                        from="0 12 12"
                        repeatCount="indefinite"
                        to="360 12 12"
                        type="rotate"
                    />
                </path>
            </svg>
        );
    }

    if (visualState === "success") {
        return (
            <svg
                fill="none"
                width={width}
                height={height}
                className={className}
                viewBox="0 0 24 24"
            >
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
                <path
                    d="M 7 12.5 L 10.25 15.75 L 17 9"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                />
            </svg>
        );
    }

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
    void showNotification({
        title: type === Toasts.Type.FAILURE ? "MessagePolish Error" : "MessagePolish",
        body: message,
    });
}

async function copyToClipboardSilently(text: string): Promise<boolean> {
    if (typeof navigator === "undefined" || navigator.clipboard == null) return false;

    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

function replaceDraftText(channelId: string, nextText: string): boolean {
    void channelId;
    void nextText;
    return false;
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

function ImproveTextContextMenu({
    channelId,
    stylePreset,
}: {
    channelId: string;
    stylePreset: ImproveTextStylePreset;
}) {
    return (
        <Menu.Menu
            navId="vc-message-polish-menu"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Message polish options"
        >
            <Menu.MenuGroup label="Writing style">
                {STYLE_ORDER.map(preset => (
                    <Menu.MenuRadioItem
                        key={preset}
                        id={`vc-message-polish-style-${preset}`}
                        group="vc-message-polish-style"
                        label={preset}
                        checked={preset === stylePreset}
                        action={() => {
                            setEffectiveStylePreset(channelId, preset);
                        }}
                    />
                ))}
            </Menu.MenuGroup>

            <Menu.MenuSeparator />

            <Menu.MenuItem
                id="vc-message-polish-cycle-style"
                label="Cycle style"
                action={() => {
                    cycleStylePreset(channelId);
                }}
            />
        </Menu.Menu>
    );
}

async function improveAndCopyDraft(channelId: string, options?: {
    onStart?(): void;
    onSuccess?(): void;
    onError?(): void;
}): Promise<void> {
    if (inFlightChannels.has(channelId)) return;

    const configuration = validateConfiguration();
    if (configuration == null) return;

    const input = getDraft(channelId)?.trim();
    if (!input) return;

    const { providerId, model } = configuration;
    const providerAdapter = providerAdapters[providerId];

    inFlightChannels.add(channelId);
    options?.onStart?.();

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

        const improvedText = response.output.trim();
        if (!improvedText) {
            notify("AI returned empty text. Nothing changed.", Toasts.Type.FAILURE);
            options?.onError?.();
            return;
        }

        const replacedDraft = replaceDraftText(channelId, improvedText);
        const copiedToClipboard = await copyToClipboardSilently(improvedText);

        if (!replacedDraft) {
            notify(
                copiedToClipboard
                    ? "Could not replace the draft, so the improved text was copied to your clipboard instead."
                    : "Could not replace the draft.",
                Toasts.Type.FAILURE,
            );
            options?.onError?.();
            return;
        }

        options?.onSuccess?.();
    } catch (error) {
        const providerError = providerAdapter.mapError(error);
        notify(providerError.message, Toasts.Type.FAILURE);
        options?.onError?.();
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
    const [visualState, setVisualState] = React.useState<ButtonVisualState>("idle");
    const resetVisualStateTimeoutRef = React.useRef<number | null>(null);

    React.useEffect(() => {
        return () => {
            if (resetVisualStateTimeoutRef.current != null) {
                window.clearTimeout(resetVisualStateTimeoutRef.current);
            }
        };
    }, []);

    if (!shouldShowImproveTextButton({ isAnyChat, showChatBarButton, draft })) return null;

    const resetVisualStateSoon = () => {
        if (resetVisualStateTimeoutRef.current != null) {
            window.clearTimeout(resetVisualStateTimeoutRef.current);
        }

        resetVisualStateTimeoutRef.current = window.setTimeout(() => {
            setVisualState("idle");
            resetVisualStateTimeoutRef.current = null;
        }, 1200);
    };

    const tooltip = visualState === "loading"
        ? "Improving with AI..."
        : visualState === "success"
            ? "Improved with AI"
            : `Improve with AI (${stylePreset})`;

    return (
        <ChatBarButton
            tooltip={tooltip}
            onClick={() => {
                void improveAndCopyDraft(channelId, {
                    onStart: () => {
                        if (resetVisualStateTimeoutRef.current != null) {
                            window.clearTimeout(resetVisualStateTimeoutRef.current);
                            resetVisualStateTimeoutRef.current = null;
                        }

                        setVisualState("loading");
                    },
                    onSuccess: () => {
                        setVisualState("success");
                        resetVisualStateSoon();
                    },
                    onError: () => {
                        setVisualState("idle");
                    },
                });
            }}
            onContextMenu={event => {
                event.preventDefault();
                ContextMenuApi.openContextMenu(event, () => (
                    <ImproveTextContextMenu channelId={channelId} stylePreset={stylePreset} />
                ));
            }}
        >
            <ImproveTextIcon visualState={visualState} />
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
