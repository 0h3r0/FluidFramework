/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { EventEmitter } from "events";
import { IValueFactory, IValueOpEmitter, IValueOperation, IValueType } from "./interfaces";

export class CounterFactory implements IValueFactory<Counter> {
    public load(emitter: IValueOpEmitter, raw: number): Counter {
        // tslint:disable-next-line:strict-boolean-expressions
        return new Counter(emitter, raw || 0);
    }

    public store(value: Counter): number {
        return value.value;
    }
}

export class Counter extends EventEmitter {
    public get value(): number {
        return this._value;
    }

    // tslint:disable-next-line:variable-name
    constructor(private readonly emitter: IValueOpEmitter, private _value: number) {
        super();
    }

    // tslint:disable-next-line:no-unnecessary-override
    public on(
        event: "incremented",
        listener: (incrementValue: number, currentValue: number) => void) {
        return super.on(event, listener);
    }

    public increment(value: number, submit = true) {
        const previousValue = this._value;
        this._value = this._value + value;
        if (submit) {
            this.emitter.emit("increment", previousValue, value);
        }

        this.emit("incremented", value, this._value);
        return this;
    }
}

export class CounterValueType implements IValueType<Counter> {
    public static Name = "counter";

    public get name(): string {
        return CounterValueType.Name;
    }

    public get factory(): IValueFactory<Counter> {
        return this._factory;
    }

    public get ops(): Map<string, IValueOperation<Counter>> {
        return this._ops;
    }

    // tslint:disable:variable-name
    private readonly _factory: IValueFactory<Counter>;
    private readonly _ops: Map<string, IValueOperation<Counter>>;
    // tslint:enable:variable-name

    constructor() {
        this._factory = new CounterFactory();
        this._ops = new Map<string, IValueOperation<Counter>>(
            [[
                "increment",
                {
                    prepare: (value, params: number, local, op) => {
                        return Promise.resolve();
                    },
                    process: (value, params: number, context, local, op) => {
                        // Local ops were applied when the message was created
                        if (local) {
                            return;
                        }

                        value.increment(params, false);
                    },
                },
            ]]);
    }
}
