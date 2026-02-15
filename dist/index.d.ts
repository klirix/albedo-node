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
    list(bucket: BucketHandle, query: ByteBuffer): ListIteratorHandle;
    listClose(cursor: ListIteratorHandle): void;
    listData(cursor: ListIteratorHandle): Uint8Array | null;
    insert(bucket: BucketHandle, doc: ByteBuffer): void;
    ensureIndex(bucket: BucketHandle, name: string, options: IndexOptions): void;
    listIndexes(bucket: BucketHandle): Record<string, IndexInfo>;
    dropIndex(bucket: BucketHandle, name: string): void;
    delete(bucket: BucketHandle, query: ByteBuffer): void;
    transform(bucket: BucketHandle, query: ByteBuffer): TransformIteratorHandle;
    transformClose(iter: TransformIteratorHandle): void;
    transformData(iter: TransformIteratorHandle): Uint8Array | null;
    transformApply(iter: TransformIteratorHandle, replace: ByteBuffer | null): void;
    setReplicationCallback(bucket: BucketHandle, callback: (data: Uint8Array) => void): void;
    applyReplicationBatch(bucket: BucketHandle, data: ByteBuffer): void;
}
declare const albedo: AlbedoModule;
export default albedo;
export declare class Bucket {
    private handle;
    constructor(handle: object);
    static open(path: string): Bucket;
    close(): void;
    insert(doc: unknown): void;
    get indexes(): Record<string, IndexInfo>;
    ensureIndex(name: string, options: IndexOptions): void;
    dropIndex(name: string): void;
    list<T>(query: unknown): Generator<T>;
    transformIterator<T>(query: unknown): Generator<T, undefined, null | object>;
    setReplicationCallback(callback: (data: Uint8Array) => void): void;
    applyReplicationBatch(data: Uint8Array): void;
}
