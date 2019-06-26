/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    IContentMessage,
    IDocumentDeltaConnection,
    IDocumentDeltaStorageService,
    IDocumentMessage,
    ISequencedDocumentMessage,
    ISignalMessage,
} from "@prague/container-definitions";
import * as messages from "@prague/socket-storage-shared";
import { EventEmitter } from "events";
import { debug } from "./debug";

// Simulated delay interval for emitting the ops
const DelayInterval = 50;
const MaxBatchDeltas = 2000;
const ReplayResolution = 15;

// Since the replay service never actually sends messages the size below is arbitrary
const ReplayMaxMessageSize = 16 * 1024;

const replayProtocolVersion = "^0.1.0";

class Replayer {
    private replayCurrent = 0;
    private replayP = Promise.resolve();
    private firstTimeStamp: number | undefined;
    constructor(
        private readonly deltaConnection: ReplayDocumentDeltaConnection,
        private readonly documentStorageService: IDocumentDeltaStorageService,
        private readonly replayFrom: number,
        private readonly replayTo: number,
        private readonly unitIsTime: boolean | undefined) {
    }

    public async start() {
        const useFetchToBatch = !(this.unitIsTime !== true && this.replayTo >= 0);
        let fetchCurrent = 0;
        let done;
        do {
            const fetchToBatch = fetchCurrent + MaxBatchDeltas;
            const fetchTo = useFetchToBatch ? fetchToBatch : Math.min(fetchToBatch, this.replayTo);

            const fetchedOps = await this.documentStorageService.get(fetchCurrent, fetchTo);

            if (fetchedOps.length <= 0) {
                debug(`Fetch done ${fetchCurrent}`);
                break;
            }

            this.replayP = this.replayP.then(() => {
                const p = this.replay(fetchedOps);
                return p;
            });

            fetchCurrent += fetchedOps.length;
            done = this.isDoneFetch(fetchCurrent, fetchedOps);
        } while (!done);
    }

    private isDoneFetch(fetchCurrent: number, fetchedOps: ISequencedDocumentMessage[]) {
        if (this.replayTo >= 0) {
            if (this.unitIsTime === true) {
                const lastTimeStamp = fetchedOps[fetchedOps.length].timestamp;
                return (
                    lastTimeStamp !== undefined
                    && this.firstTimeStamp !== undefined
                    && lastTimeStamp - this.firstTimeStamp < this.replayTo);
            }
            return fetchCurrent < this.replayTo;
        }
        return false;
    }

    private emit(ops: ISequencedDocumentMessage[]) {
        ops.map((op) => this.deltaConnection.emit("op", op.clientId, op));
    }

    private skipToReplayFrom(fetchedOps: ISequencedDocumentMessage[]) {
        let skipToIndex = 0;
        if (this.replayFrom >= 0) {
            if (this.unitIsTime === true) {
                for (let i = 0; i < fetchedOps.length; i += 1) {
                    const timeStamp = fetchedOps[i].timestamp;
                    if (timeStamp !== undefined) {
                        if (this.firstTimeStamp === undefined) {
                            this.firstTimeStamp = timeStamp;
                        }
                        if (timeStamp - this.firstTimeStamp >= this.replayFrom) {
                            skipToIndex = i;
                            break;
                        }
                    }
                }
            } else if (this.replayFrom > this.replayCurrent) {
                skipToIndex = this.replayFrom - this.replayCurrent;
            }

            // emit all the ops from 0 to from immediately
            if (skipToIndex !== 0) {
                const playbackOps = fetchedOps.slice(0, skipToIndex);
                debug(`Skipped ${skipToIndex}`);
                this.emit(playbackOps);
            }
        }
        return skipToIndex;
    }

    private replay(fetchedOps: ISequencedDocumentMessage[]): Promise<void> {
        let current = this.skipToReplayFrom(fetchedOps);

        // tslint:disable-next-line:promise-must-complete
        return new Promise((resolve, reject) => {
            const replayNextOps = () => {
                // Emit the ops from replay to the end every "deltainterval" milliseconds
                // to simulate the socket stream
                const currentOp = fetchedOps[current];
                const playbackOps = [currentOp];
                let nextInterval = DelayInterval;
                current += 1;

                debug(`Replay next ${this.replayCurrent + current}`);
                if (this.unitIsTime === true) {
                    const currentTimeStamp = currentOp.timestamp;
                    if (currentTimeStamp !== undefined) {
                        // Emit more ops that is in the ReplayResolution window

                        while (current < fetchedOps.length) {
                            const op = fetchedOps[current];
                            if (op.timestamp === undefined) {
                                // Missing timestamp, just delay the standard amount of time
                                break;
                            }
                            const timeDiff = op.timestamp - currentTimeStamp;
                            if (timeDiff >= ReplayResolution) {
                                // Time exceeded the resolution window, break out the loop
                                // and delay for the time difference.
                                nextInterval = timeDiff;
                                break;
                            }
                            if (timeDiff < 0) {
                                // Time have regressed, just delay the standard amount of time
                                break;
                            }

                            // The op is within the ReplayResolution emit it now
                            playbackOps.push(op);
                            current += 1;
                        }

                        if (this.firstTimeStamp !== undefined
                            && this.replayTo >= 0
                            && currentTimeStamp + nextInterval - this.firstTimeStamp > this.replayTo) {
                            nextInterval = -1;
                        }
                    }
                }
                scheduleNext(nextInterval);
                this.emit(playbackOps);
            };
            const scheduleNext = (nextInterval: number) => {
                if (nextInterval >= 0 && current < fetchedOps.length) {
                    setTimeout(replayNextOps, nextInterval);
                    debug(`Replay scheduled ${this.replayCurrent + current} ${nextInterval}`);
                } else {
                    debug(`Replay done ${this.replayCurrent + current}`);
                    this.replayCurrent += current;
                    resolve();
                }
            };
            scheduleNext(DelayInterval);
        });
    }
}

export class ReplayDocumentDeltaConnection extends EventEmitter implements IDocumentDeltaConnection {
    public static async create(
        documentStorageService: IDocumentDeltaStorageService,
        replayFrom: number,
        replayTo: number,
        unitIsTime: boolean | undefined): Promise<IDocumentDeltaConnection> {

        const connection: messages.IConnected = {
            clientId: "",
            existing: true,
            initialContents: [],
            initialMessages: [],
            initialSignals: [],
            maxMessageSize: ReplayMaxMessageSize,
            parentBranch: null,
            supportedVersions: [replayProtocolVersion],
            version: replayProtocolVersion,
        };
        const deltaConnection = new ReplayDocumentDeltaConnection(connection);
        // tslint:disable-next-line:no-floating-promises
        this.fetchAndEmitOps(
            deltaConnection, documentStorageService, replayFrom, replayTo, unitIsTime);

        return deltaConnection;
    }

    private static fetchAndEmitOps(
        deltaConnection: ReplayDocumentDeltaConnection,
        documentStorageService: IDocumentDeltaStorageService,
        replayFrom: number,
        replayTo: number,
        unitIsTime: boolean | undefined): Promise<void> {

        const replayer =  new Replayer(
            deltaConnection,
            documentStorageService,
            replayFrom,
            replayTo,
            unitIsTime);
        return replayer.start();
    }

    public get clientId(): string {
        return this.details.clientId;
    }

    public get existing(): boolean {
        return this.details.existing;
    }

    public get parentBranch(): string | null {
        return this.details.parentBranch;
    }

    public get version(): string {
        return this.details.version;
    }

    public get initialContents(): IContentMessage[] | undefined {
        return this.details.initialContents;
    }

    public get initialMessages(): ISequencedDocumentMessage[] | undefined {
        return this.details.initialMessages;
    }

    public get initialSignals(): ISignalMessage[] | undefined {
        return this.details.initialSignals;
    }

    public readonly maxMessageSize = ReplayMaxMessageSize;

    constructor(
        public details: messages.IConnected,
    ) {
        super();
    }

    public submit(message: IDocumentMessage): void {
        debug("dropping the outbound message");
    }

    public async submitAsync(message: IDocumentMessage): Promise<void> {
        debug("dropping the outbound message and wait for response");
    }

    public async submitSignal(message: any) {
        debug("dropping the outbound signal and wait for response");
    }

    public disconnect() {
        debug("no implementation for disconnect...");
    }
}
