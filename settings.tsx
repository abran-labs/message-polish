/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    showChatBarButton: {
        type: OptionType.BOOLEAN,
        description: "Show the Improve Text chat bar button",
        default: true,
        restartNeeded: true,
    },
    provider: {
        type: OptionType.STRING,
        description: "Provider id used for text improvement",
        default: "noop",
    }
});
