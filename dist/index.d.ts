type ByteBuffer = Uint8Array;
type BucketHandle = object;
type ListIteratorHandle = object;
type TransformIteratorHandle = object;
interface IndexOptions {
    unique: boolean;
    sparse: boolean;
    reverse: boolean;
}
interface IndexInfo {
    name: string;
    unique: boolean;
    sparse: boolean;
    reverse: boolean;
}
interface ObjectIdInstance {
    buffer: ByteBuffer;
    toString(): string;
}
interface ObjectIdConstructor {
    new (buffer?: ByteBuffer): ObjectIdInstance;
    fromString(hex: string): ObjectIdInstance;
}
interface AlbedoModule {
    ObjectId: ObjectIdConstructor;
    serialize(value: unknown): Uint8Array;
    deserialize<T = unknown>(data: ByteBuffer): T;
    open(path: string): BucketHandle;
    close(bucket: BucketHandle): void;
    list(bucket: BucketHandle, query: object): ListIteratorHandle;
    listClose(cursor: ListIteratorHandle): void;
    listData(cursor: ListIteratorHandle): unknown | null;
    insert(bucket: BucketHandle, doc: ByteBuffer | object): void;
    ensureIndex(bucket: BucketHandle, name: string, options: IndexOptions): void;
    listIndexes(bucket: BucketHandle): Record<string, IndexInfo>;
    dropIndex(bucket: BucketHandle, name: string): void;
    delete(bucket: BucketHandle, query: object): void;
    transform(bucket: BucketHandle, query: object): TransformIteratorHandle;
    transformClose(iter: TransformIteratorHandle): void;
    transformData(iter: TransformIteratorHandle): unknown | null;
    transformApply(iter: TransformIteratorHandle, replace: ByteBuffer | object | null): void;
    setReplicationCallback(bucket: BucketHandle, callback: (data: Uint8Array) => void): void;
    applyReplicationBatch(bucket: BucketHandle, data: ByteBuffer): void;
}
declare const albedo: AlbedoModule;
export default albedo;
export declare const BSON: {
    serialize: (value: unknown) => Uint8Array;
    deserialize: <T = unknown>(data: ByteBuffer) => T;
};
export declare class Bucket {
    private handle;
    constructor(handle: object);
    static open(path: string): Bucket;
    close(): void;
    insert(doc: object | ByteBuffer): void;
    delete(query: object): void;
    get indexes(): Record<string, IndexInfo>;
    ensureIndex(name: string, options: IndexOptions): void;
    dropIndex(name: string): void;
    list<T>(query: object): Generator<T>;
    transformIterator<T>(query: object): Generator<T, undefined, null | object>;
    setReplicationCallback(callback: (data: Uint8Array) => void): void;
    applyReplicationBatch(data: Uint8Array): void;
}
