/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { IUser } from "./users";

export const Browser = "browser";

// TODO: Remove mode and use scopes to decide permission.
export interface IClient {
    mode?: "readonly" | undefined;
    type: string;
    permission: string[];
    user: IUser;
    scopes: string[];
}

export interface ISequencedClient {

    client: IClient;

    sequenceNumber: number;
}

/**
 * Contents sent with a ClientJoin message
 */
export interface IClientJoin {
    // The ID of the joining client
    clientId: string;

    // Details about the joining client (i.e. browser based, server, CPU, memory, etc...)
    detail: IClient;
}
