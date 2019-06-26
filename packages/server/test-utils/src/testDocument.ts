/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { ISnapshotDocument } from "@prague/agent";
import {
    IConnectionDetails,
    IDeltaHandlerStrategy,
    IDeltaManager,
    IDeltaQueue,
    IDocumentMessage,
    ISequencedDocumentMessage,
    ISignalMessage,
    MessageType,
} from "@prague/container-definitions";
import * as utils from "@prague/utils";
import * as assert from "assert";
import { EventEmitter } from "events";

export class TestDeltaQueue<T> extends EventEmitter implements IDeltaQueue<T> {
    public paused: boolean;
    public length: number;
    public idle: boolean;
    private resumeDeferred: utils.Deferred<void>;

    public pause(): Promise<void> {
        if (!this.paused) {
            this.paused = true;
            this.resumeDeferred = new utils.Deferred<void>();
        }

        return Promise.resolve();
    }

    public resume(): Promise<void> {
        this.paused = false;
        this.resumeDeferred.resolve();

        return Promise.resolve();
    }

    public systemPause(): Promise<void> {
        return this.pause();
    }

    public systemResume(): Promise<void> {
        return this.resume();
    }

    public waitForResume(): Promise<void> {
        assert(this.paused);
        return this.resumeDeferred.promise;
    }

    public take(count: number) {
        throw new Error("Method not implemented.");
    }

    public peek(): T {
        throw new Error("Method not implemented.");
    }
}

export class TestDeltaManager
    extends EventEmitter implements IDeltaManager<ISequencedDocumentMessage, IDocumentMessage> {
    public referenceSequenceNumber: number;

    public maxMessageSize: number;

    public minimumSequenceNumber: number;

    public inbound = new TestDeltaQueue<ISequencedDocumentMessage>();

    public outbound = new TestDeltaQueue<IDocumentMessage>();

    public inboundSignal = new TestDeltaQueue<ISignalMessage>();

    public clientType = "Browser";

    public version = "^0.1.0";

    public enableReadonlyMode() {
        return;
    }

    public disableReadonlyMode(): void {
        return;
    }

    public close(): void {
        return;
    }

    public connect(reason: string): Promise<IConnectionDetails> {
        throw new Error("Method not implemented.");
    }

    public getDeltas(eventName: string, from: number, to?: number): Promise<ISequencedDocumentMessage[]> {
        throw new Error("Method not implemented.");
    }

    public attachOpHandler(sequenceNumber: number, handler: IDeltaHandlerStrategy, resume: boolean) {
        throw new Error("Method not implemented.");
    }

    public submit(type: MessageType, contents: string): number {
        throw new Error("Method not implemented.");
    }

    public submitSignal(contents: any): void {
        throw new Error("Method not implemented.");
    }
}

export class TestDocument implements ISnapshotDocument {
    public deltaManager = new TestDeltaManager();
    public snapshotRequests = 0;

    constructor(public id: string, public clientId: string) {
    }

    public snapshot(message: string): Promise<void> {
        this.snapshotRequests++;
        return this.snapshotCore(message);
    }

    // Allow derived classes to override the snapshot processing
    public snapshotCore = (message: string) => Promise.resolve();
}
