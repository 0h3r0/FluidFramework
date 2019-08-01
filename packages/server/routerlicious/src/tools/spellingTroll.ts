/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

// tslint:disable
import * as API from "@prague/client-api";
import { ISequencedDocumentMessage } from "@prague/container-definitions";
import * as MergeTree from "@prague/merge-tree";
import { RouterliciousDocumentServiceFactory } from "@prague/routerlicious-socket-storage";
import * as Sequence from "@prague/sequence";
import * as fs from "fs";
import * as path from "path";
import * as commander from "commander";
import { Marker, TextSegment } from "@prague/merge-tree";

function clock() {
    return process.hrtime();
}

function elapsedMilliseconds(start: [number, number]) {
    let end: number[] = process.hrtime(start);
    let duration = Math.round((end[0] * 1000) + (end[1] / 1000000));
    return duration;
}

function compareProxStrings(a: MergeTree.ProxString<number>, b: MergeTree.ProxString<number>) {
    let ascore = ((a.invDistance * 200) * a.val) + a.val;
    let bscore = ((b.invDistance * 200) * b.val) + b.val;
    return bscore - ascore;
}

class Speller {
    static altMax = 7;
    dict = new MergeTree.TST<number>();
    verbose = true;

    constructor(public sharedString: Sequence.SharedString) {
    }

    spellingError(word: string) {
        if (/\b\d+\b/.test(word)) {
            return false;
        }
        else {
            return !this.dict.contains(word);
        }
    }

    invokePaul() {
        let altSpellings = [];
        altSpellings.push({ text: "thats", invDistance: 0, val: 0});
        altSpellings.push({ text: "this", invDistance: 1, val: 1});
        setTimeout(() => {
            console.log(`Paul is back`);
            console.log(this.sharedString.client.mergeTree.collabWindow.minSeq);
            this.sharedString.annotateRangeFromPast(492, 496, { textError: { text: "that", alternates: altSpellings, color: "paul"} }, 0);
            console.log(this.sharedString.client.mergeTree.nodeToString(<MergeTree.IMergeBlock>this.sharedString.client.mergeTree.root.children[0], "", 0));
            this.sharedString.setLocalMinSeq(0);
        }, 10000);
    }

    spellOp(delta: MergeTree.IMergeTreeOp) {
        if (delta.type === MergeTree.MergeTreeDeltaType.INSERT) {
            this.currentWordSpellCheck(delta.pos1);
        } else if (delta.type === MergeTree.MergeTreeDeltaType.REMOVE) {
            this.currentWordSpellCheck(delta.pos1, true);
        }
        else if (delta.type === MergeTree.MergeTreeDeltaType.GROUP) {
            for (let groupOp of delta.ops) {
                this.spellOp(groupOp);
            }
        }
    }

    setEvents() {
        this.sharedString.on("op", (msg: ISequencedDocumentMessage) => {
            if (msg && msg.contents) {
                this.spellOp(<MergeTree.IMergeTreeOp>msg.contents);
            }
        });
    }

    loadDict() {
        let clockStart = clock();
        let dictFilename = path.join(__dirname, "../../public/literature/dictfreq.txt");
        let dictContent = fs.readFileSync(dictFilename, "utf8");
        let splitContent = dictContent.split("\n");
        for (let entry of splitContent) {
            let splitEntry = entry.split(";");
            this.dict.put(splitEntry[0], parseInt(splitEntry[1]));
        }
        console.log(`size: ${this.dict.size()}; load time ${elapsedMilliseconds(clockStart)}ms`);
    }

    initialSpellCheck() {
        this.loadDict();
        this.invokePaul();
        let spellParagraph = (startPG: number, endPG: number, text: string) => {
            let re = /\b\w+\b/g;
            let result: RegExpExecArray;
            do {
                result = re.exec(text);
                if (result) {
                    let candidate = result[0];
                    if (this.spellingError(candidate.toLocaleLowerCase())) {
                        let start = result.index;
                        let end = re.lastIndex;
                        let textErrorInfo = this.makeTextErrorInfo(candidate);
                        if (this.verbose) {
                            console.log(`spell (${startPG + start}, ${startPG + end}): ${textErrorInfo.text}`);
                        }
                        this.sharedString.annotateRange(startPG + start, startPG + end, { textError: textErrorInfo });
                    }
                }
            } while (result);
        }
        let prevPG: MergeTree.Marker;
        let startPGPos = 0;
        let pgText = "";
        let endMarkerFound = false;
        let mergeTree = this.sharedString.client.mergeTree;
        function gatherPG(segment: MergeTree.ISegment, segpos: number) {
            if (Marker.is(segment)) {
                if (mergeTree.localNetLength(segment)) {
                    if (segment.hasTileLabel("pg")) {
                        if (prevPG) {
                            // TODO: send paragraph to service
                            spellParagraph(startPGPos, segpos, pgText);
                            endMarkerFound = true;
                        }
                        startPGPos = segpos + mergeTree.localNetLength(segment);
                        prevPG = segment;
                        pgText = "";
                        if (endMarkerFound) {
                            return false;
                        }
                    }
                    else {
                        for (let i = 0; i < mergeTree.localNetLength(segment); i++) {
                            pgText += " ";
                        }
                    }
                }
            } else if (TextSegment.is(segment)) {
                if (mergeTree.localNetLength(segment)) {
                    pgText += segment.text;
                }
            }
            return true;
        }

        do {
            endMarkerFound = false;
            this.sharedString.client.mergeTree.mapRange({ leaf: gatherPG }, MergeTree.UniversalSequenceNumber,
                this.sharedString.client.getClientId(), undefined, startPGPos);
        } while (endMarkerFound);

        if (prevPG) {
            // TODO: send paragraph to service
            spellParagraph(startPGPos, startPGPos + pgText.length, pgText);
        }

        this.setEvents();
    }

    makeTextErrorInfo(candidate: string) {
        let alternates = this.dict.neighbors(candidate, 2).sort(compareProxStrings);
        if (alternates.length > Speller.altMax) {
            alternates.length = Speller.altMax;
        }
        return {
            text: candidate,
            alternates: alternates
        };
    }

    currentWordSpellCheck(pos: number, rev = false) {
        let words = "";
        let fwdWords = "";
        let sentence = "";
        let fwdSentence = "";
        let wordsFound = false;
        let mergeTree = this.sharedString.client.mergeTree;

        let gatherReverse = (segment: MergeTree.ISegment) => {
            if (Marker.is(segment)) {
                if (!wordsFound) {
                    words = " " + words;
                }
                sentence = " " + sentence;
                if (segment.hasTileLabel("pg")) {
                    return false;
                }
            } else if (TextSegment.is(segment)) {
                if (mergeTree.localNetLength(segment)) {
                    if (!wordsFound) {
                        words = segment.text + words;
                    }
                    sentence = segment.text + sentence;
                }
            }
            // TODO: component
            // console.log(`rev: -${text}-`);
            if (/\s+\w+/.test(words)) {
                wordsFound = true;
            }
            if (/[\?\.\!]\s*\w+/.test(sentence)) {
                return false;
            }
            return true;
        };

        let gatherForward = (segment: MergeTree.ISegment) => {
            if (Marker.is(segment)) {
                if (!wordsFound) {
                    fwdWords = fwdWords + " ";
                }
                fwdSentence = fwdSentence + " ";
                if (segment.hasTileLabel("pg")) {
                    return false;
                }
            } else if (TextSegment.is(segment)) {
                if (mergeTree.localNetLength(segment)) {
                    if (!wordsFound) {
                        fwdWords = fwdWords + segment.text;
                    }
                    fwdSentence = fwdSentence + segment.text;
                }
            }
            // TODO: component
            if (/\w+\s+/.test(fwdWords)) {
                wordsFound = true;
            }
            if (/\w+\s*[\.\?\!]/.test(fwdSentence)) {
                return false;
            }
            return true;
        };

        let segoff = this.sharedString.client.mergeTree.getContainingSegment(pos,
            MergeTree.UniversalSequenceNumber, this.sharedString.client.getClientId());
        if (segoff.offset !== 0) {
            console.log("expected pos only at segment boundary");
        }
        // assumes op has made pos a segment boundary
        this.sharedString.client.mergeTree.leftExcursion(segoff.segment, gatherReverse);
        let startPos = pos - words.length;
        let sentenceStartPos = pos - sentence.length;

        if (segoff.segment) {
            wordsFound = false;
            if (gatherForward(segoff.segment)) {
                this.sharedString.client.mergeTree.rightExcursion(segoff.segment, gatherForward);
            }
            words = words + fwdWords;
            sentence = sentence + fwdSentence;
            if (this.verbose) {
                console.log(`found sentence ${sentence} (start ${sentenceStartPos}, end ${sentenceStartPos + sentence.length}) around change`);
            }
            // TODO: send this sentence to service for analysis
            let re = /\b\w+\b/g;
            let result: RegExpExecArray;
            do {
                result = re.exec(words);
                if (result) {
                    let start = result.index + startPos;
                    let end = re.lastIndex + startPos;
                    let candidate = result[0];
                    if (this.spellingError(candidate.toLocaleLowerCase())) {
                        let textErrorInfo = this.makeTextErrorInfo(candidate);
                        if (this.verbose) {
                            console.log(`respell (${start}, ${end}): ${textErrorInfo.text}`);
                            let buf = "alternates: ";
                            for (let alt of textErrorInfo.alternates) {
                                buf += ` ${alt.text}:${alt.invDistance}:${alt.val}`;
                            }
                            console.log(buf);
                        }
                        this.sharedString.annotateRange(start, end, { textError: textErrorInfo });
                    }
                    else {
                        if (this.verbose) {
                            console.log(`spell ok (${start}, ${end}): ${words.substring(result.index, re.lastIndex)}`);
                        }
                        this.sharedString.annotateRange(start, end, { textError: null });
                    }
                }
            }
            while (result);
        }
    }
}

let theSpeller: Speller;
async function initSpell(id: string) {

    const document = await API.load(
        id,
        null,
        { blockUpdateMarkers: true, localMinSeq: 0, encrypted: undefined });
    const root = document.getRoot();
    if (!root.has("text")) {
        root.set("text", document.createString());
    }
    const sharedString = root.get("text") as Sequence.SharedString;
    console.log("partial load fired");
    sharedString.loaded.then(() => {
        theSpeller = new Speller(sharedString);
        theSpeller.initialSpellCheck();
    });
}

// Process command line input
let sharedStringId;

commander.version("0.0.1")
    .option("-s, --server [server]", "server url", "http://localhost:3000")
    .option("-t, --storage [server]", "storage server url", "http://localhost:3001")
    .option("-i, --tenant [id]", "tenant ID", "git")
    .arguments("<id>")
    .action((id: string) => {
        sharedStringId = id;
    })
    .parse(process.argv);


if (!sharedStringId) {
    commander.help();
}
else {
    // Mark socket storage as our default provider
    const serviceFactory = new RouterliciousDocumentServiceFactory();
    API.registerDocumentServiceFactory(serviceFactory );
    initSpell(sharedStringId);
}
