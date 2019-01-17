import {
    ConnectionState,
    IBlobManager,
    IDeltaManager,
    IDocumentStorageService,
    IObjectMessage,
    IPlatform,
    IQuorum,
    ISnapshotTree,
    ITree,
    IUser,
    MessageType,
} from "@prague/runtime-definitions";

export interface IChaincodeComponent {
    // I'm not sure how many of the below we'll even need

    /**
     * Retrieves the module by type name
     */
    getModule(type: string);

    /**
     * Stops the instantiated chaincode from running
     */
    close(): Promise<void>;

    /**
     * Invoked once the chaincode has been fully instantiated on the document. Run returns a platform
     * interface that can be used to access the running component.
     */
    run(runtime: IComponentRuntime, platform: IPlatform): Promise<IPlatform>;
}

export interface IProcess {
    readonly id: string;
}

export interface IComponentRuntime {
    // TODOTODO do I also need the component ID? Does the tenant ID even show up?
    readonly tenantId: string;
    readonly documentId: string;
    readonly id: string;
    readonly existing: boolean;
    readonly options: any;
    readonly clientId: string;
    readonly user: IUser;
    readonly parentBranch: string;
    readonly connected: boolean;
    readonly deltaManager: IDeltaManager;
    readonly platform: IPlatform;
    readonly blobManager: IBlobManager;
    readonly storage: IDocumentStorageService;
    readonly connectionState: ConnectionState;
    readonly branch: string;
    readonly minimumSequenceNumber: number;
    readonly chaincode: IChaincodeComponent;
    readonly baseSnapshot: ISnapshotTree;
    readonly submitFn: (type: MessageType, contents: any) => void;
    readonly snapshotFn: (message: string) => Promise<void>;
    readonly closeFn: () => void;

    // I believe these next two things won't be necessary

    getQuorum(): IQuorum;

    error(err: any): void;
}

export interface IHostRuntime {
    // TODOTODO do I also need the component ID? Does the tenant ID even show up?
    readonly tenantId: string;
    readonly id: string;
    readonly existing: boolean;
    readonly options: any;
    readonly clientId: string;
    readonly user: IUser;
    readonly parentBranch: string;
    readonly connected: boolean;
    readonly deltaManager: IDeltaManager;
    readonly platform: IPlatform;
    readonly blobManager: IBlobManager;
    readonly storage: IDocumentStorageService;
    readonly connectionState: ConnectionState;
    readonly branch: string;
    readonly minimumSequenceNumber: number;
    readonly chaincode: IChaincodeHost;
    readonly submitFn: (type: MessageType, contents: any) => void;
    readonly snapshotFn: (message: string) => Promise<void>;
    readonly closeFn: () => void;

    // I believe these next two things won't be necessary

    getProcess(id: string): Promise<IProcess>;

    createAndAttachProcess(id: string, pkg: string): Promise<IProcess>;

    // TODO at some point we may ant to split create from attach for processes. But the distributed data
    // structures aren't yet prepared for this. For simplicity we just offer a createAndAttach
    // attachProcess(process: IProcess);

    getQuorum(): IQuorum;

    error(err: any): void;
}

export interface IChaincodeHost {
    /**
     * Retrieves the module by type name.
     */
    getModule(type: string): Promise<any>;

    /**
     * Stops the instantiated chaincode from running
     */
    close(): Promise<void>;

    /**
     * Invoked once the chaincode has been fully instantiated on the document. Run returns a platform
     * interface that can be used to access the running component.
     */
    // When loading multiple of these the platform is interesting. Is this something that gets attached as opposed
    // to returned? Is there then a detach call?
    run(runtime: IHostRuntime, platform: IPlatform): Promise<IPlatform>;
}

/**
 * Exported module definition
 */
export interface IChaincodeFactory {
    // We're really loading an instruction set into our CPU. Does that give better names?
    // The base thing preps the instruction set loader. Then each component delay loads aspects of it.

    /**
     * Instantiates a new chaincode component
     */
    // Very possible this isn't required
    instantiateComponent(): Promise<IChaincodeComponent>;

    /**
     * Instantiates a new chaincode host
     */
    instantiateHost(): Promise<IChaincodeHost>;
}

export interface IChannel {
    /**
     * A readonly identifier for the collaborative object
     */
    readonly id: string;

    readonly type: string;

    dirty: boolean;

    ready(): Promise<void>;

    snapshot(): ITree;

    transform(message: IObjectMessage, sequenceNumber: number): IObjectMessage;

    isLocal(): boolean;
}
