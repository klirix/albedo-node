import { type QueryInput } from "./query";
export * from "./query";
type ByteBuffer = Uint8Array;
type BucketHandle = object;
type TransactionHandle = object;
type ListIteratorHandle = object;
type TransformIteratorHandle = object;
type SubscriptionHandle = object;
export interface ReplicationCursor {
    generation: bigint;
    next_frame_index: bigint;
}
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
    fromString(str: string): ObjectIdInstance;
}
export interface SubscriptionEvent<T = unknown> {
    seqno: bigint;
    op: "insert" | "update" | "delete";
    doc_id: ObjectIdInstance;
    ts: bigint;
    doc?: T;
}
interface SubscriptionBatch<T = unknown> {
    batch: Array<SubscriptionEvent<T>>;
}
export interface SubscribeOptions {
    pollingTimeout?: number;
    batchSize?: number;
}
/**
 * Controls when fsync is called to guarantee write durability.
 */
type WriteDurability = "all" | {
    periodic: number;
} | "manual";
/**
 * Controls how page reads interact with the WAL.
 */
type ReadDurability = "shared" | "process";
/**
 * Options for opening a bucket.
 */
interface OpenBucketOptions {
    buildIdIndex?: boolean;
    mode?: string;
    auto_vaccuum?: boolean;
    page_cache_capacity?: number;
    wal?: boolean;
    write_durability?: WriteDurability;
    read_durability?: ReadDurability;
}
interface AlbedoModule {
    ObjectId: ObjectIdConstructor;
    serialize(value: unknown): Uint8Array;
    deserialize<T = unknown>(data: ByteBuffer): T;
    open(path: string): BucketHandle;
    open_with_options(path: string, options: OpenBucketOptions): BucketHandle;
    close(bucket: BucketHandle): void;
    list(bucket: BucketHandle, query: object): ListIteratorHandle;
    listClose(cursor: ListIteratorHandle): void;
    listData(cursor: ListIteratorHandle): unknown | null;
    insert(bucket: BucketHandle, doc: ByteBuffer | object): void;
    checkpoint(bucket: BucketHandle): void;
    transactionBegin(bucket: BucketHandle): TransactionHandle;
    transactionInsert(tx: TransactionHandle, doc: ByteBuffer | object): void;
    ensureIndex(bucket: BucketHandle, name: string, options: IndexOptions): void;
    listIndexes(bucket: BucketHandle): Record<string, IndexInfo>;
    dropIndex(bucket: BucketHandle, name: string): void;
    delete(bucket: BucketHandle, query: object): void;
    transactionDelete(tx: TransactionHandle, query: object): void;
    transform(bucket: BucketHandle, query: object): TransformIteratorHandle;
    transactionTransform(tx: TransactionHandle, query: object): TransformIteratorHandle;
    transformClose(iter: TransformIteratorHandle): void;
    transformData(iter: TransformIteratorHandle): unknown | null;
    transformApply(iter: TransformIteratorHandle, replace: ByteBuffer | object | null): void;
    transactionCommit(tx: TransactionHandle): void;
    transactionRollback(tx: TransactionHandle): void;
    transactionClose(tx: TransactionHandle): void;
    subscribe(bucket: BucketHandle, query: object): SubscriptionHandle;
    subscribePoll<T = unknown>(sub: SubscriptionHandle, maxEvents: number): SubscriptionBatch<T> | null;
    subscribeClose(sub: SubscriptionHandle): void;
    replicationCursor(bucket: BucketHandle): ReplicationCursor;
    readReplicationBatch(bucket: BucketHandle, cursor: ReplicationCursor, maxBytes: number): ByteBuffer | null;
    applyReplicationBatch(bucket: BucketHandle, data: ByteBuffer): ReplicationCursor;
}
export declare const albedo: AlbedoModule;
export default albedo;
export declare const BSON: {
    serialize: (value: unknown) => Uint8Array;
    deserialize: <T = unknown>(data: ByteBuffer) => T;
};
/**
 * Native ObjectId class constructor.
 *
 * @example
 * ```ts
 * const id = new ObjectId();
 * const parsed = ObjectId.fromString(id.toString());
 * ```
 */
export declare const ObjectId: ObjectIdConstructor;
type TransformReplacement<T extends object> = T | ByteBuffer | null;
/**
 * Wrapper around a native transaction handle providing
 * write operations that are committed or rolled back together.
 */
export declare class Transaction {
    private handle;
    constructor(handle: object);
    private get nativeHandle();
    /**
     * Insert a document or raw byte buffer into the transaction.
     */
    insert(doc: object | ByteBuffer): void;
    /**
     * Delete documents matching the query from the transaction.
     */
    delete(query?: QueryInput): void;
    /**
     * Generator that allows reading and modifying matching documents
     * within the transaction.
     */
    transformIterator<T extends object>(query?: QueryInput): Generator<T, undefined, TransformReplacement<T>>;
    /**
     * Apply a transformation function to matching documents in the transaction.
     */
    transform<T extends object>(query: QueryInput | undefined, fn: (doc: T) => TransformReplacement<T>): void;
    /**
     * Alias for `transform` that reads more naturally for document updates.
     */
    update<T extends object>(query: QueryInput | undefined, fn: (doc: T) => TransformReplacement<T>): void;
    /**
     * Commit the transaction.
     */
    commit(): void;
    /**
     * Roll back the transaction.
     */
    rollback(): void;
    /**
     * Close the transaction and release native resources.
     */
    close(): void;
}
/**
 * Wrapper around a native Albedo bucket handle providing
 * methods for CRUD operations, indexing, iteration, and
 * replication support.
 *
 * @example
 * ```ts
 * import albedo, { Bucket, BSON } from 'albedo-node';
 *
 * const bucket = Bucket.open('data.db');
 * bucket.insert({ name: 'Alice' });
 *
 * for (const doc of bucket.list({ query: { name: { $eq: 'Alice' } } })) {
 *   console.log(doc);
 * }
 *
 * bucket.close();
 * ```
 */
export declare class Bucket {
    private handle;
    /**
     * Create a Bucket instance from an existing native handle.
     * @param handle - opaque bucket handle returned by `albedo.open`
     * @example
     * ```ts
     * const raw = albedo.open('foo.db');
     * const bucket = new Bucket(raw);
     * ```
     */
    constructor(handle: object);
    /**
     * Open a bucket located at the given filesystem path.
     * @param path - path to the bucket file
     * @returns a new `Bucket` instance
     * @example
     * ```ts
     * const bucket = Bucket.open('data.db');
     * ```
     */
    static open(path: string, options?: OpenBucketOptions): Bucket;
    /**
     * Close the bucket and release native resources.
     * @example
     * ```ts
     * bucket.close();
     * ```
     */
    close(): void;
    /**
     * Insert a document or raw byte buffer into the bucket.
     * @param doc - object to serialize or pre-serialized buffer
     * @example
     * ```ts
     * bucket.insert({ name: 'Bob' });
     * ```
     */
    insert(doc: object | ByteBuffer): void;
    /**
     * Flush buffered bucket state through the native checkpoint mechanism.
     */
    checkpoint(): void;
    /**
     * Begin a manual transaction on this bucket.
     */
    beginTransaction(): Transaction;
    /**
     * Run a callback inside a transaction and commit it on success.
     *
     * If the callback throws, the transaction is rolled back before the
     * original error is re-thrown.
     */
    tx<T>(fn: (tx: Transaction) => T): T;
    /**
     * Delete documents matching the query. If no query is provided,
     * all documents will be removed.
     * @param query - filter object or `Query` instance
     * @example
     * ```ts
     * bucket.delete({ name: { $eq: 'Bob' } });
     * // or using Query builder
     * bucket.delete(new Query().where('name', { $eq: 'Bob' }));
     * ```
     */
    delete(query?: QueryInput): void;
    /**
     * Retrieve information about all indexes defined on the bucket.
     * @example
     * ```ts
     * console.log(bucket.indexes);
     * ```
     */
    get indexes(): Record<string, IndexInfo>;
    /**
     * Create or update an index on a field.
     * @param name - index name (field path)
     * @param options - index configuration
     * @example
     * ```ts
     * bucket.ensureIndex('name', { unique: false, sparse: false, reverse: false });
     * ```
     */
    ensureIndex(name: string, options: IndexOptions): void;
    /**
     * Remove an index by name.
     * @example
     * ```ts
     * bucket.dropIndex('name');
     * ```
     */
    dropIndex(name: string): void;
    /**
     * Iterate over documents matching the optional query.
     * @param query - filter or `Query` object
     * @yields each document deserialized from the bucket
     * @example
     * ```ts
     * for (const doc of bucket.list({ query: { age: { $gt: 30 } } })) {
     *   console.log(doc);
     * }
     * ```
     */
    list<T>(query?: QueryInput): Generator<T>;
    /**
     * Async iterator that continuously polls a change subscription.
     *
     * The generator yields individual oplog events rather than rescanned
     * documents, and automatically closes the native subscription when the
     * consumer stops iterating.
     *
     * @param query - filter or `Query` object
     * @param options - polling configuration
     * @param options.pollingTimeout - ms to wait before retrying when the
     *   subscription is idle (default `50`)
     * @param options.batchSize - maximum number of change events to pull per
     *   native poll (default `64`)
     * @example
     * ```ts
     * for await (const event of bucket.subscribe<User>(where('active', { $eq: true }))) {
     *   console.log(event.op, event.doc);
     * }
     * ```
     */
    subscribe<T>(query?: QueryInput, options?: SubscribeOptions): AsyncGenerator<SubscriptionEvent<T>>;
    /**
     * Collect all documents matching the optional query into an array.
     * @param query - filter or `Query` object
     * @returns array of all matching documents
     * @example
     * ```ts
     * const docs = bucket.all<{ name: string }>(where('name', { $exists: true }));
     * ```
     */
    all<T>(query?: QueryInput): Array<T>;
    /**
     * Return the first document matching the optional query, or `null`
     * when no document matches.
     * @param query - filter or `Query` object
     * @returns first matching document or `null`
     * @example
     * ```ts
     * const doc = bucket.one<{ _id: number }>(where('_id', { $eq: 1 }));
     * ```
     */
    one<T>(query?: QueryInput): T | null;
    /**
     * Normalize a query argument to a plain object, unpacking
     * `Query` instances.
     * @example
     * ```ts
     * Bucket.convertToQuery(new Query().where('x', { $eq: 1 }));
     * Bucket.convertToQuery({ foo: { $exists: true } });
     * ```
     */
    static convertToQuery(query?: QueryInput): object;
    /**
     * Generator that allows reading and optionally modifying each
     * document matching the query.
     * @param query - filter or `Query` instance
     * @yields the current document; the caller may send back an updated
     * document or `null` to delete it.
     * @example
     * ```ts
     * for (const doc of bucket.transformIterator({ query: { count: { $lt: 5 } } })) {
     *   if (doc.count < 2) {
     *     // update in-place
     *     yield { ...doc, count: doc.count + 1 };
     *   }
     * }
     * ```
     */
    transformIterator<T extends object>(query?: QueryInput): Generator<T, undefined, TransformReplacement<T>>;
    /**
     * Apply a transformation function to each document matching the
     * provided query. The predicate receives the current document and
     * should return the modified document, or `null` to remove it.
     *
     * This is a helper built on top of `transformIterator` and mirrors its
     * behavior but uses a simple callback API instead of a generator.
     *
     * @param query - filter or `Query` object
     * @param fn - transformation function
     * @example
     * ```ts
     * bucket.transform(where('active', { $eq: true }), doc => {
     *   if (doc.count > 10) return null; // delete
     *   return { ...doc, count: doc.count + 1 };
     * });
     * ```
     */
    transform<T extends object>(query: QueryInput | undefined, fn: (doc: T) => TransformReplacement<T>): void;
    /**
     * Alias for `transform` that reads more naturally for document updates.
     */
    update<T extends object>(query: QueryInput | undefined, fn: (doc: T) => TransformReplacement<T>): void;
    replicationCursor(): ReplicationCursor;
    readReplicationBatch(cursor: ReplicationCursor, maxBytes?: number): Uint8Array | null;
    /**
     * Apply a batch of replication operations to this bucket.
     * @param data - bytes produced by another bucket's replication
     * @example
     * ```ts
     * bucket.applyReplicationBatch(remoteBytes);
     * ```
     */
    applyReplicationBatch(data: Uint8Array): ReplicationCursor;
}
