/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { CaretEventType, Direction, getDeltaX, getDeltaY, ICaretBounds, ICaretEvent, KeyCode, Scheduler } from "@prague/flow-util";
import { SequenceDeltaEvent } from "@prague/sequence";
import { debug } from "../../debug";
import { IViewState, View } from "../../layout";
import { IPaginationProvider, PagePosition } from "../../pagination";
import { DocumentView, IDocumentProps } from "../document";
import { shouldIgnoreEvent } from "../inclusion";
import { Cursor } from "./cursor";
import * as style from "./index.css";

export interface IEditorProps extends IDocumentProps {
    scheduler: Scheduler;
    eventSink?: HTMLElement;
}

interface IListenerRegistration {
    target: EventTarget;
    type: string;
    listener: EventListener;
}

interface IEditorViewState extends IViewState {
    cursor: Cursor;
    docView: DocumentView;
    eventSink: HTMLElement;
    props: IEditorProps;
    listeners: IListenerRegistration[];
}

export class Editor extends View<IEditorProps, IEditorViewState> implements IPaginationProvider {
    private get cursor()         { return this.state.cursor; }
    public  get doc()            { return this.state.props.doc; }
    private get props()          { return this.state.props; }
    public  get cursorPosition() { return this.state.cursor.position; }
    public  get selection()      { return this.state.cursor.selection; }
    public invalidate?: () => void;

    private readonly onCaretLeave = ((e: ICaretEvent) => {
        this.state.eventSink.focus();
        const direction = e.detail.direction;
        const extendSelection = false;

        if (getDeltaX(direction) !== 0) {
            this.cursor.moveTo(this.state.docView.nodeOffsetToPosition(e.target as Node), extendSelection);
            this.horizontalArrow(e, direction, extendSelection);
        } else {
            this.cursor.moveTo(this.state.docView.nodeOffsetToPosition(e.target as Node), extendSelection);
            this.verticalArrow(e, direction, e.detail.caretBounds, extendSelection);
        }
    }) as EventHandlerNonNull;

    public paginate(start: PagePosition, budget: number) {
        Object.assign(this.props, { start, paginationBudget: budget });
        this.update(this.props);
        return this.state.docView.paginationStop;
    }

    protected mounting(props: Readonly<IEditorProps>): IEditorViewState {
        const scheduler = props.scheduler;
        const invalidate = scheduler.coalesce(scheduler.onLayout, this.render);
        this.invalidate = () => {
            debug(`Invalidated`);
            invalidate();
        };

        const docView = new DocumentView();
        const root = docView.mount(props);

        const cursor = new Cursor(docView, scheduler);
        cursor.moveTo(0, false);

        const listeners: IListenerRegistration[] = [];
        const eventSink = (props.eventSink || root) as HTMLElement;

        eventSink.contentEditable = "true";
        this.on(listeners, eventSink, "keydown",   this.onKeyDown);
        this.on(listeners, eventSink, "keypress",  this.onKeyPress);
        this.on(listeners, eventSink, "mousedown", this.onMouseDown);
        this.on(listeners, window,    "resize",    this.invalidate);

        root.addEventListener(CaretEventType.leave, this.onCaretLeave);

        props.doc.on("sequenceDelta", (e: SequenceDeltaEvent) => {
            // TODO: Filter invalidations to rendered range.  The challenge with this is that the document's
            //       length has already changed (e.g., deleting the last position in a document results in an
            //       op that effects a range no longer inside the document.)
            //
            // Some potential fixes:
            //
            //   1. DocumentView caches the positions it previous rendered, rather than return the positions
            //      of LocalReferences, and then manually updates these on each op.
            //
            //   2. Use the data in the op to adjust 'docView.range' to account for it's state prior to the edit.
            //
            // const { start, end } = this.state.docView.range;
            // if (start < e.end && e.start < end) {
                this.invalidate();
            // }
        });

        return this.updating(props, {
            root,
            listeners,
            docView,
            eventSink,
            props,
            cursor,
        });
    }

    protected updating(props: Readonly<IEditorProps>, state: IEditorViewState): IEditorViewState {
        // If the document has changed, remount the document view.
        if (props.doc !== state.props.doc) {
            this.unmounting(state);
            state = this.mounting(props);
        }

        state.docView.update(props);

        return state;
    }

    protected unmounting(state: IEditorViewState): void {
        for (const listener of state.listeners) {
            listener.target.removeEventListener(listener.type, listener.listener);
        }

        this.root.removeEventListener(CaretEventType.leave, this.onCaretLeave);
        this.doc.off("sequenceDelta", this.invalidate);
    }

    private on<K extends keyof HTMLElementEventMap>(listeners: IListenerRegistration[], target: EventTarget, type: K | string, listener: (ev: HTMLElementEventMap[K]) => any) {
        const wrappedListener = (e: Event) => {
            // Ignore events that bubble up from inclusions
            if (shouldIgnoreEvent(e)) {
                return;
            }

            listener(e as any);
        };

        target.addEventListener(type, wrappedListener);
        listeners.push({ target, type, listener: wrappedListener });
    }

    private readonly render = () => {
        this.props.trackedPositions = this.cursor.getTracked();
        this.state.docView.update(this.props);
    }

    private delete(e: Event, direction: Direction) {
        this.cursor.setDirection(direction);
        const { start, end } = this.cursor.selection;

        if (start === end) {
            // If no range is currently selected, delete the preceding character (if any).
            const dx = getDeltaX(direction);
            if (dx < 0) {
                this.doc.remove(start - 1, end);
            } else {
                this.doc.remove(start, end + 1);
            }
        } else {
            // Otherwise, delete the selected range.
            this.doc.remove(Math.min(start, end), Math.max(start, end));
        }

        e.preventDefault();
        e.stopPropagation();
    }

    private insertText(text: string) {
        const { start, end } = this.cursor.selection;
        if (start === end) {
            this.doc.insertText(end, text);
        } else {
            this.doc.replaceWithText(Math.min(start, end), Math.max(start, end), text);
        }
    }

    private horizontalArrow(e: Event, direction: Direction, extendSelection: boolean) {
        e.preventDefault();
        e.stopPropagation();

        this.cursor.setDirection(direction);
        this.cursor.moveBy(getDeltaX(direction), extendSelection);
    }

    private verticalArrow(e: Event, direction: Direction, caretBounds: ICaretBounds, extendSelection: boolean) {
        e.preventDefault();
        e.stopPropagation();

        this.cursor.setDirection(direction);

        const initial = this.cursorPosition;
        const range = this.doc.findParagraph(initial + getDeltaY(direction));
        const length = this.doc.length;

        let start: number;
        let end: number;
        if (direction === Direction.down) {
            start = Math.min(initial + 1, length);
            end = Math.min(this.doc.findParagraph(range.end).end, length);
        } else {
            start = Math.max(this.doc.findParagraph(range.start - 1).start, 0);
            end = Math.max(initial, 0);
        }

        const searchFn = direction === Direction.down
            ? this.state.docView.findBelow
            : this.state.docView.findAbove;

        const segmentAndOffset = searchFn(start, end, caretBounds.left, caretBounds.top, caretBounds.bottom);
        if (segmentAndOffset) {
            const { segment, offset } = segmentAndOffset;
            const position = this.doc.getPosition(segment) + offset;
            this.cursor.moveTo(position, extendSelection);
        }
    }

    private readonly onKeyDown = (ev: KeyboardEvent) => {
        const keyCode = ev.code;
        switch (keyCode) {
            // Note: Chrome 69 delivers backspace on 'keydown' only (i.e., 'keypress' is not fired.)
            case KeyCode.backspace: {
                this.delete(ev, Direction.left);
                break;
            }
            case KeyCode.delete: {
                this.delete(ev, Direction.right);
                break;
            }
            case KeyCode.arrowLeft: {
                this.horizontalArrow(ev, Direction.left, ev.shiftKey);
                break;
            }
            case KeyCode.arrowRight: {
                this.horizontalArrow(ev, Direction.right, ev.shiftKey);
                break;
            }
            case KeyCode.arrowDown: {
                this.verticalArrow(ev, Direction.down, this.cursor.bounds, ev.shiftKey);
                break;
            }
            case KeyCode.arrowUp: {
                this.verticalArrow(ev, Direction.up, this.cursor.bounds, ev.shiftKey);
                break;
            }
            default: {
                debug(`Key: ${ev.key} (${ev.keyCode})`);
            }
        }
    }

    private toggleCssClass(className: string) {
        const { start, end } = this.cursor.selection;
        this.doc.toggleCssClass(start, end, className);
    }

    private readonly onKeyPress = (ev: KeyboardEvent) => {
        if (ev.ctrlKey) {
            switch (ev.key) {
                case "b":
                    this.toggleCssClass(style.bold);
                    break;
                case "i":
                    this.toggleCssClass(style.italic);
                    break;
                case "u":
                    this.toggleCssClass(style.underline);
                    break;
                default:
            }
        } else {
            switch (ev.code) {
                case KeyCode.backspace: {
                    // Note: Backspace handled on 'keydown' event to support Chrome 69 (see comment in 'onKeyDown').
                    break;
                }
                case KeyCode.enter: {
                    if (ev.shiftKey) {
                        this.doc.insertLineBreak(this.cursor.position);
                    } else {
                        this.doc.insertParagraph(this.cursor.position);
                    }
                    break;
                }
                default: {
                    this.insertText(ev.key);
                }
            }
        }
        ev.stopPropagation();
        ev.preventDefault();
    }

    private readonly onMouseDown = (ev: MouseEvent) => {
        const maybeSegmentAndOffset = this.state.docView.hitTest(ev.x, ev.y);
        if (maybeSegmentAndOffset) {
            const { segment, offset } = maybeSegmentAndOffset;
            const position = Math.min(
                this.doc.getPosition(segment) + offset,
                this.doc.length - 1);
            this.cursor.moveTo(position, false);
            ev.stopPropagation();
        }
    }
}
