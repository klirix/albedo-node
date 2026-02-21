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
    fromString(str: string): ObjectIdInstance;
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
    static open(path: string): Bucket;
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
    delete(query?: object | Query): void;
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
    list<T>(query?: object | Query): Generator<T>;
    /**
     * Normalize a query argument to a plain object, unpacking
     * `Query` instances.
     * @example
     * ```ts
     * Bucket.convertToQuery(new Query().where('x', { $eq: 1 }));
     * Bucket.convertToQuery({ foo: { $exists: true } });
     * ```
     */
    static convertToQuery(query?: object | Query): object;
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
    transformIterator<T>(query?: object | Query): Generator<T, undefined, null | object>;
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
    transform<T extends object>(query: object | Query | undefined, fn: (doc: T) => T | null): void;
    /**
     * Register a callback to receive replication data produced by the
     * bucket.
     * @param callback - invoked with raw replication bytes
     * @example
     * ```ts
     * bucket.setReplicationCallback(bytes => {
     *   console.log('got replication', bytes.length);
     * });
     * ```
     */
    setReplicationCallback(callback: (data: Uint8Array) => void): void;
    /**
     * Apply a batch of replication operations to this bucket.
     * @param data - bytes produced by another bucket's replication
     * @example
     * ```ts
     * bucket.applyReplicationBatch(remoteBytes);
     * ```
     */
    applyReplicationBatch(data: Uint8Array): void;
}
type BSONValue = any;
type FilterOperators = {
    $eq: BSONValue;
} | {
    $ne: BSONValue;
} | {
    $lt: BSONValue;
} | {
    $lte: BSONValue;
} | {
    $gt: BSONValue;
} | {
    $gte: BSONValue;
} | {
    $in: BSONValue[];
} | {
    $between: [BSONValue, BSONValue];
} | {
    $startsWith: string;
} | {
    $endsWith: string;
} | {
    $exists: boolean;
} | {
    $notExists: boolean;
};
/**
 * Builder for query objects that can be used with bucket
 * operations like `list`, `delete`, and `transform`.
 *
 * The class supports chaining to construct filters, sorting,
 * and pagination (offset/limit).
 */
export declare class Query {
    private _query;
    /**
     * Return the raw query object to pass to the native layer.
     */
    get query(): object;
    /**
     * Add a filter condition for the specified field.
     * @param field - dot-separated path to the document field
     * @param filter - comparison operator object
     * @returns the same `Query` for chaining
     * @example
     * ```ts
     * const q = new Query().where('age', { $gt: 18 });
     * ```
     */
    where(field: string, filter: FilterOperators): this;
    /**
     * Specify sorting for the result set.
     * @param field - field to sort by
     * @param direction - `asc` or `desc` (defaults to `asc`)
     * @example
     * ```ts
     * const q = new Query().sortBy('name', 'desc');
     * ```
     */
    sortBy(field: string, direction?: "asc" | "desc"): this;
    /**
     * Set an offset and limit for pagination.
     * @param offset - number of documents to skip
     * @param limit - maximum number of documents to return
     * @example
     * ```ts
     * const q = new Query().sector(10, 5);
     * ```
     */
    sector(offset?: number, limit?: number): this;
}
/**
 * Shortcut helper that creates a new `Query` with a single
 * `where` clause applied.
 *
 * @param field - field name to filter on
 * @param filter - filter operator object
 * @returns a `Query` instance ready to use
 * @example
 * ```ts
 * bucket.list(where('age', { $lt: 30 }));
 * ```
 */
export declare function where(field: string, filter: FilterOperators): Query;
