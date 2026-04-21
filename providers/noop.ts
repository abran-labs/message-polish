/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ImproveTextProvider } from "../types";

export const noopProvider: ImproveTextProvider = {
    id: "noop",
    label: "No Provider (Scaffold)",
    isAvailable: () => true,
    improve: async input => input,
};
