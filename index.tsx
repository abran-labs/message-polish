/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import definePlugin, { IconComponent } from "@utils/types";

import { settings } from "./settings";

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

const ImproveTextButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const { showChatBarButton } = settings.use(["showChatBarButton"]);

    if (!isMainChat || !showChatBarButton) return null;

    return (
        <ChatBarButton
            tooltip="Improve text (scaffold)"
            onClick={() => void 0}
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

    chatBarButton: {
        icon: ImproveTextIcon,
        render: ImproveTextButton,
    }
});
