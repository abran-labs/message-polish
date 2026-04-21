/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";
import { Forms, SearchableSelect, TextInput, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { providerAdapters } from "./providers";
import { ImproveTextModel, ImproveTextProviderId } from "./types";

type ModelSelectorStatus = "idle" | "loading" | "success" | "error";

interface ModelSelectorState {
    status: ModelSelectorStatus;
    models: ImproveTextModel[];
    error: string | null;
}

const defaultModelSelectorState: ModelSelectorState = {
    status: "idle",
    models: [],
    error: null,
};

function getModelSelectorStateByProvider() {
    return {
        openai: { ...defaultModelSelectorState },
        anthropic: { ...defaultModelSelectorState },
        google: { ...defaultModelSelectorState },
    } satisfies Record<ImproveTextProviderId, ModelSelectorState>;
}

function ModelSelectorSetting(props: { setValue(newValue: string): void; }) {
    const { provider, model } = settings.use(["provider", "model"]);
    const selectedProvider: ImproveTextProviderId = provider ?? "openai";
    const selectedModel = model ?? "";
    const fetchedProvidersRef = useRef(new Set<ImproveTextProviderId>());
    const [stateByProvider, setStateByProvider] = useState(getModelSelectorStateByProvider);

    const activeState = stateByProvider[selectedProvider];
    const modelOptions = useMemo(() => activeState.models.map(model => ({
        label: model.label,
        value: model.id,
    })), [activeState.models]);

    useEffect(() => {
        if (fetchedProvidersRef.current.has(selectedProvider)) return;

        setStateByProvider(prev => ({
            ...prev,
            [selectedProvider]: {
                status: "loading",
                models: [],
                error: null,
            }
        }));

        const controller = new AbortController();

        void providerAdapters[selectedProvider].listModels({ signal: controller.signal })
            .then(({ models }) => {
                if (controller.signal.aborted) return;

                fetchedProvidersRef.current.add(selectedProvider);

                setStateByProvider(prev => ({
                    ...prev,
                    [selectedProvider]: {
                        status: "success",
                        models,
                        error: null,
                    }
                }));
            })
            .catch(error => {
                if (controller.signal.aborted) {
                    setStateByProvider(prev => ({
                        ...prev,
                        [selectedProvider]: {
                            status: "idle",
                            models: [],
                            error: null,
                        }
                    }));
                    return;
                }

                const message = error instanceof Error
                    ? error.message
                    : "Failed to load model list.";

                setStateByProvider(prev => ({
                    ...prev,
                    [selectedProvider]: {
                        status: "error",
                        models: [],
                        error: message,
                    }
                }));
                fetchedProvidersRef.current.delete(selectedProvider);
            });

        return () => {
            controller.abort();
        };
    }, [selectedProvider]);

    const shouldShowManualInput = activeState.status === "error" || (activeState.status === "success" && activeState.models.length === 0);

    return (
        <section>
            <Forms.FormTitle tag="h3">Model</Forms.FormTitle>
            <Forms.FormText>
                Select a model for the current provider.
            </Forms.FormText>

            {activeState.status === "loading" && (
                <Forms.FormText>
                    Loading available models for {selectedProvider}...
                </Forms.FormText>
            )}

            {activeState.status === "success" && activeState.models.length > 0 && (
                <SearchableSelect
                    placeholder="Select a model"
                    options={modelOptions}
                    value={modelOptions.find(option => option.value === model)?.value}
                    onChange={value => props.setValue(String(value ?? ""))}
                    maxVisibleItems={5}
                    closeOnSelect
                />
            )}

            {activeState.status === "error" && (
                <Forms.FormText style={{ color: "var(--text-feedback-critical)" }}>
                    Failed to load models for {selectedProvider}: {activeState.error}
                </Forms.FormText>
            )}

            {activeState.status === "success" && activeState.models.length === 0 && (
                <Forms.FormText>
                    No provider models were returned for {selectedProvider}. Enter a model id manually.
                </Forms.FormText>
            )}

            {shouldShowManualInput && (
                <TextInput
                    type="text"
                    placeholder="Enter model id manually"
                    value={selectedModel}
                    onChange={value => props.setValue(value)}
                />
            )}
        </section>
    );
}

export const settings = definePluginSettings({
    showChatBarButton: {
        type: OptionType.BOOLEAN,
        description: "Show the AI message polish button. Right-click the button to cycle styles quickly.",
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
    model: {
        type: OptionType.COMPONENT,
        default: "",
        onChange(newValue: string) {
            settings.store.model = newValue.trim();
        },
        component: props => <ModelSelectorSetting setValue={props.setValue} />,
    },
    stylePreset: {
        type: OptionType.SELECT,
        description: "Default writing style preset for improved text. Channels use this until you right-click the button to pick a channel-specific style.",
        options: [
            { label: "Professional", value: "professional", default: true },
            { label: "Business", value: "business" },
            { label: "Casual", value: "casual" },
            { label: "Concise", value: "concise" },
            { label: "Explain", value: "explain" }
        ] as const,
    },
    channelStyleMemory: {
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
