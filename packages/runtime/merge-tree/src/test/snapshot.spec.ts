/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { MockStorage } from "@prague/runtime-test-utils";
import { DebugLogger } from "@prague/utils";
import * as assert from "assert";
import { specToSegment, TestClient } from ".";
import { UniversalSequenceNumber } from "..";
import { Snapshot } from "../snapshot";

describe("snapshot", () => {
    it("header only", async () => {

        const client1 = new TestClient();
        client1.startCollaboration("me");
        for (let i = 0; i < Snapshot.sizeOfFirstChunk; i++) {
            const op = client1.insertTextLocal(client1.getLength(), `${i % 10}`, { segment: i });
            const msg = client1.makeOpMessage(op, i + 1);
            msg.minimumSequenceNumber = i + 1;
            client1.applyMsg(msg);
        }

        const snapshot = new Snapshot(client1.mergeTree, DebugLogger.create("prague:snapshot"));
        snapshot.extractSync();
        const snapshotTree = snapshot.emit();
        const services = new MockStorage(snapshotTree);

        const client2 = new TestClient(undefined, specToSegment);

        const headerChunk = await Snapshot.loadChunk(services, "header");
        client2.mergeTree.reloadFromSegments(headerChunk.segmentTexts.map(specToSegment));

        assert.equal(client2.getLength(), client1.getLength());
        assert.equal(client2.getText(), client1.getText());
    })
    // tslint:disable-next-line: mocha-no-side-effect-code
    .timeout(5000);

    it("header and body", async () => {

        const client1 = new TestClient();
        client1.startCollaboration("me");
        for (let i = 0; i < Snapshot.sizeOfFirstChunk + 10; i++) {
            const op = client1.insertTextLocal(client1.getLength(), `${i % 10}`, { segment: i });
            const msg = client1.makeOpMessage(op, i + 1);
            msg.minimumSequenceNumber = i + 1;
            client1.applyMsg(msg);
        }

        const snapshot = new Snapshot(client1.mergeTree, DebugLogger.create("prague:snapshot"));
        snapshot.extractSync();
        const snapshotTree = snapshot.emit();
        const services = new MockStorage(snapshotTree);

        const client2 = new TestClient(undefined, specToSegment);

        const headerChunk = await Snapshot.loadChunk(services, "header");
        client2.mergeTree.reloadFromSegments(headerChunk.segmentTexts.map(specToSegment));
        assert.equal(client2.getText(), client1.getText(0, Snapshot.sizeOfFirstChunk));

        const bodyChunk = await Snapshot.loadChunk(services, "body");
        client2.mergeTree.insertSegments(
            client2.getLength(),
            bodyChunk.segmentTexts.map(specToSegment),
            UniversalSequenceNumber,
            client2.mergeTree.collabWindow.clientId,
            UniversalSequenceNumber,
            undefined);

        assert.equal(client2.getLength(), client1.getLength());
        assert.equal(client2.getText(Snapshot.sizeOfFirstChunk - 1), client1.getText(Snapshot.sizeOfFirstChunk - 1));
    })
    // tslint:disable-next-line: mocha-no-side-effect-code
    .timeout(5000);
});
