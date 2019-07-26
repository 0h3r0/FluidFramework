/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { EventEmitter } from "events";
import { IBlobManager } from "./blobs";
import { IComponent } from "./components";
import { IQuorum } from "./consensus";
import { IDeltaManager, IServiceConfiguration } from "./deltas";
import { ICodeLoader, ILoader, IRequest, IResponse } from "./loader";
import { ITelemetryLogger } from "./logger";
import { IDocumentMessage, ISequencedDocumentMessage, MessageType } from "./protocol";
import { IDocumentStorageService, ISnapshotTree, ITree } from "./storage";
import { ISummaryTree } from "./summary";

/**
 * Person definition in a npm script
 */
export interface IPerson {
    name: string;
    email: string;
    url: string;
}

/**
 * Typescript interface definition for fields within a NPM module's package.json.
 */
export interface IPackage {
    name: string;
    version: string;
    description?: string;
    keywords?: string[];
    homepage?: string;
    bugs?: { url: string; email: string };
    license?: string;
    author?: IPerson;
    contributors?: IPerson[];
    files?: string[];
    main?: string;
    // Same as main but for browser based clients (check if webpack supports this)
    browser?: string;
    bin?: { [key: string]: string };
    man?: string | string[];
    repository?: string | { type: string; url: string };
    scripts?: { [key: string]: string };
    config?: { [key: string]: string };
    dependencies?: { [key: string]: string };
    devDependencies?: { [key: string]: string };
    peerDependencies?: { [key: string]: string };
    bundledDependencies?: { [key: string]: string };
    optionalDependencies?: { [key: string]: string };
    engines?: { node: string; npm: string };
    os?: string[];
    cpu?: string[];
    private?: boolean;
}

export interface IPraguePackage extends IPackage {
    // https://stackoverflow.com/questions/10065564/add-custom-metadata-or-config-to-package-json-is-it-valid
    prague: {
        browser: {
            // List of bundled JS files - both local files and ones on a CDN
            bundle: string[];

            // Global for the entrypoint to the root package
            entrypoint: string;
        };
    };
}

export interface IFluidPackage extends IPackage {
    fluid: {
        browser: {
            [libraryTarget: string]: {
                // List of bundled JS files. Absolute URLs will be loaded directly. Relative paths will be specific
                // to the CDN location
                files: string[];

                // if libraryTarget is umd then library is the global name that the script entry points will be exposed
                // under. Other target formats may choose to reinterpret this value.
                library: string;
            };
        };
    };
}

export enum ConnectionState {
    /**
     * The document is no longer connected to the delta server
     */
    Disconnected,

    /**
     * The document has an inbound connection but is still pending for outbound deltas
     */
    Connecting,

    /**
     * The document is fully connected
     */
    Connected,
}

/**
 * Package manager configuration. Provides a key value mapping of config values
 */
export interface IPackageConfig {
    [key: string]: string;
}

/**
 * Data structure used to describe the code to load on the Fluid document
 */
export interface IFluidCodeDetails {
    /**
     * The code package to be used on the Fluid document. This is either the package name which will be loaded
     * from a package manager. Or the expanded fluid package.
     */
    package: string | IFluidPackage;

    /**
     * Configuration details. This includes links to the package manager and base CDNs.
     */
    config: IPackageConfig;
}

/**
 * The IRuntime represents an instantiation of a code package within a container.
 */
export interface IRuntime extends IComponent {
    /**
     * Executes a request against the runtime
     */
    request(request: IRequest): Promise<IResponse>;

    /**
     * Snapshots the runtime
     */
    snapshot(tagMessage: string, generateFullTreeNoOptimizations?: boolean): Promise<ITree | null>;

    /**
     * Returns a summary of the runtime at the current sequence number
     */
    summarize(generateFullTreeNoOptimizations?: boolean): Promise<ISummaryTree>;

    /**
     * Notifies the runtime of a change in the connection state
     */
    changeConnectionState(value: ConnectionState, clientId: string, version?: string);

    /**
     * Stops the runtime. Once stopped no more messages will be delivered and the context passed to the runtime
     * on creation will no longer be active
     */
    stop(): Promise<void>;

    /**
     * Prepares the given message for execution
     * @deprecated being removed and replaced with only process
     */
    prepare(message: ISequencedDocumentMessage, local: boolean): Promise<any>;

    /**
     * Processes the given message
     */
    process(message: ISequencedDocumentMessage, local: boolean, context: any);

    /**
     * Called immediately after a message has been processed but prior to the next message being executed
     * @deprecated being removed and replaced with only process
     */
    postProcess(message: ISequencedDocumentMessage, local: boolean, context: any): Promise<void>;

    /**
     * Processes the given signal
     */
    processSignal(message: any, local: boolean);
}

export interface IMessageScheduler extends IComponent {
    readonly deltaManager: IDeltaManager<ISequencedDocumentMessage, IDocumentMessage>;
}

export interface IContainerContext extends EventEmitter, IMessageScheduler, IComponent {
    readonly id: string;
    readonly existing: boolean | undefined;
    readonly options: any;
    readonly configuration: IComponentConfiguration;
    readonly clientId: string | undefined;
    readonly clientType: string;
    readonly parentBranch: string | undefined | null;
    readonly blobManager: IBlobManager | undefined;
    readonly storage: IDocumentStorageService | undefined | null;
    readonly connectionState: ConnectionState;
    readonly connected: boolean;
    readonly branch: string;
    readonly minimumSequenceNumber: number | undefined;
    readonly baseSnapshot: ISnapshotTree | null;
    readonly submitFn: (type: MessageType, contents: any) => number;
    readonly submitSignalFn: (contents: any) => void;
    readonly snapshotFn: (message: string) => Promise<void>;
    readonly closeFn: () => void;
    readonly quorum: IQuorum;
    readonly loader: ILoader;
    readonly codeLoader: ICodeLoader;
    readonly logger: ITelemetryLogger;
    readonly serviceConfiguration: IServiceConfiguration | undefined;
    error(err: any): void;
    requestSnapshot(tagMessage: string): Promise<void>;
}

export interface IComponentConfiguration {
    canReconnect: boolean;
}

export interface IFluidModule {
    fluidExport: IComponent;
}

/**
 * Exported module definition
 */
export interface IRuntimeFactory {
    /**
     * Instantiates a new chaincode container
     */
    instantiateRuntime(context: IContainerContext): Promise<IRuntime>;
}
