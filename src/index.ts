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
type WriteDurability =
  | "all" // Every write is fsynced immediately (safest, slowest)
  | { periodic: number } // Fsync every N page writes (balanced)
  | "manual"; // Never fsync automatically; rely on OS page cache

/**
 * Controls how page reads interact with the WAL.
 */
type ReadDurability =
  | "shared" // Always consult WAL (safe for multi-process readers)
  | "process"; // Trust local cache, WAL only on miss (fast single-process)

/**
 * Options for opening a bucket.
 */
interface OpenBucketOptions {
  buildIdIndex?: boolean;
  mode?: string; // BucketFileMode
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
  transactionTransform(
    tx: TransactionHandle,
    query: object,
  ): TransformIteratorHandle;
  transformClose(iter: TransformIteratorHandle): void;
  transformData(iter: TransformIteratorHandle): unknown | null;
  transformApply(
    iter: TransformIteratorHandle,
    replace: ByteBuffer | object | null,
  ): void;
  transactionCommit(tx: TransactionHandle): void;
  transactionRollback(tx: TransactionHandle): void;
  transactionClose(tx: TransactionHandle): void;
  subscribe(bucket: BucketHandle, query: object): SubscriptionHandle;
  subscribePoll<T = unknown>(
    sub: SubscriptionHandle,
    maxEvents: number,
  ): SubscriptionBatch<T> | null;
  subscribeClose(sub: SubscriptionHandle): void;
  replicationCursor(bucket: BucketHandle): ReplicationCursor;
  readReplicationBatch(
    bucket: BucketHandle,
    cursor: ReplicationCursor,
    maxBytes: number,
  ): ByteBuffer | null;
  applyReplicationBatch(
    bucket: BucketHandle,
    data: ByteBuffer,
  ): ReplicationCursor;
}
import { familySync, MUSL } from "detect-libc";

function getNativeBinding() {
  const platformMap: Record<NodeJS.Platform, string> = {
    win32: "windows",
    darwin: "macos",
    linux: "linux",
    aix: "",
    android: "",
    freebsd: "",
    haiku: "",
    openbsd: "",
    sunos: "",
    cygwin: "",
    netbsd: "",
  };

  const archMap: Record<string, string> = {
    x64: "x86_64",
    arm64: "aarch64",
  };

  const platform =
    platformMap[process.platform as NodeJS.Platform] ?? process.platform;
  const arch = archMap[process.arch] ?? process.arch;

  let suffix = "";
  if (platform === "linux") {
    const libc = familySync(); // 'glibc' | 'musl' | null
    suffix = libc === MUSL ? "_musl" : "_gnu";
  }

  const filename = `albedo.${arch}_${platform}${suffix}.node`;
  return require(`../native/${filename}`); // or import() if you prefer ESM
}

export const albedo: AlbedoModule = getNativeBinding();

export default albedo;

export const BSON = {
  serialize: albedo.serialize,
  deserialize: albedo.deserialize,
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
export const ObjectId: ObjectIdConstructor = albedo.ObjectId;

type QueryInput = object | Query;
type TransformReplacement<T extends object> = T | ByteBuffer | null;

function convertToQuery(query?: QueryInput): object {
  if (query instanceof Query) {
    return query.query;
  }
  return query || {};
}

function *iterateTransform<T extends object>(
  iter: TransformIteratorHandle,
): Generator<T, undefined, TransformReplacement<T>> {
  try {
    let data: unknown | null;
    while ((data = albedo.transformData(iter)) !== undefined) {
      const newDoc = yield data as T;
      albedo.transformApply(iter, newDoc);
    }
  } finally {
    albedo.transformClose(iter);
  }
}

function applyTransform<T extends object>(
  iter: TransformIteratorHandle,
  fn: (doc: T) => TransformReplacement<T>,
): void {
  try {
    let data: unknown | null;
    while ((data = albedo.transformData(iter)) !== undefined) {
      albedo.transformApply(iter, fn(data as T));
    }
  } finally {
    albedo.transformClose(iter);
  }
}

function aggregateErrors(message: string, errors: unknown[]): Error {
  return new AggregateError(errors, message);
}

/**
 * Wrapper around a native transaction handle providing
 * write operations that are committed or rolled back together.
 */
export class Transaction {
  private handle: TransactionHandle | null;

  constructor(handle: object) {
    this.handle = handle as TransactionHandle;
  }

  private get nativeHandle(): TransactionHandle {
    if (this.handle === null) {
      throw new Error("Transaction is closed");
    }
    return this.handle;
  }

  /**
   * Insert a document or raw byte buffer into the transaction.
   */
  insert(doc: object | ByteBuffer): void {
    albedo.transactionInsert(this.nativeHandle, doc);
  }

  /**
   * Delete documents matching the query from the transaction.
   */
  delete(query?: QueryInput): void {
    albedo.transactionDelete(this.nativeHandle, convertToQuery(query));
  }

  /**
   * Generator that allows reading and modifying matching documents
   * within the transaction.
   */
  transformIterator<T extends object>(
    query?: QueryInput,
  ): Generator<T, undefined, TransformReplacement<T>> {
    return iterateTransform<T>(
      albedo.transactionTransform(this.nativeHandle, convertToQuery(query)),
    );
  }

  /**
   * Apply a transformation function to matching documents in the transaction.
   */
  transform<T extends object>(
    query: QueryInput | undefined,
    fn: (doc: T) => TransformReplacement<T>,
  ): void {
    applyTransform<T>(
      albedo.transactionTransform(this.nativeHandle, convertToQuery(query)),
      fn,
    );
  }

  /**
   * Alias for `transform` that reads more naturally for document updates.
   */
  update<T extends object>(
    query: QueryInput | undefined,
    fn: (doc: T) => TransformReplacement<T>,
  ): void {
    this.transform(query, fn);
  }

  /**
   * Commit the transaction.
   */
  commit(): void {
    albedo.transactionCommit(this.nativeHandle);
  }

  /**
   * Roll back the transaction.
   */
  rollback(): void {
    albedo.transactionRollback(this.nativeHandle);
  }

  /**
   * Close the transaction and release native resources.
   */
  close(): void {
    const handle = this.nativeHandle;
    albedo.transactionClose(handle);
    this.handle = null;
  }
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
export class Bucket {
  private handle: BucketHandle;

  /**
   * Create a Bucket instance from an existing native handle.
   * @param handle - opaque bucket handle returned by `albedo.open`
   * @example
   * ```ts
   * const raw = albedo.open('foo.db');
   * const bucket = new Bucket(raw);
   * ```
   */
  constructor(handle: object) {
    this.handle = handle as BucketHandle;
  }

  /**
   * Open a bucket located at the given filesystem path.
   * @param path - path to the bucket file
   * @returns a new `Bucket` instance
   * @example
   * ```ts
   * const bucket = Bucket.open('data.db');
   * ```
   */
  static open(path: string, options?: OpenBucketOptions): Bucket {
    const handle = options ? albedo.open_with_options(path, options) : albedo.open(path);
    return new Bucket(handle);
  }

  /**
   * Close the bucket and release native resources.
   * @example
   * ```ts
   * bucket.close();
   * ```
   */
  close(): void {
    albedo.close(this.handle);
  }

  /**
   * Insert a document or raw byte buffer into the bucket.
   * @param doc - object to serialize or pre-serialized buffer
   * @example
   * ```ts
   * bucket.insert({ name: 'Bob' });
   * ```
   */
  insert(doc: object | ByteBuffer): void {
    albedo.insert(this.handle, doc);
  }

  /**
   * Flush buffered bucket state through the native checkpoint mechanism.
   */
  checkpoint(): void {
    albedo.checkpoint(this.handle);
  }

  /**
   * Begin a manual transaction on this bucket.
   */
  beginTransaction(): Transaction {
    return new Transaction(albedo.transactionBegin(this.handle));
  }

  /**
   * Run a callback inside a transaction and commit it on success.
   *
   * If the callback throws, the transaction is rolled back before the
   * original error is re-thrown.
   */
  tx<T>(fn: (tx: Transaction) => T): T {
    const tx = this.beginTransaction();
    let result: T;

    try {
      result = fn(tx);
    } catch (error) {
      try {
        tx.rollback();
      } catch (rollbackError) {
        try {
          tx.close();
        } catch (closeError) {
          throw aggregateErrors(
            "Transaction failed, rollback failed, and close failed",
            [error, rollbackError, closeError],
          );
        }
        throw aggregateErrors("Transaction failed and rollback failed", [
          error,
          rollbackError,
        ]);
      }

      try {
        tx.close();
      } catch (closeError) {
        throw aggregateErrors("Transaction failed and close failed", [
          error,
          closeError,
        ]);
      }

      throw error;
    }

    try {
      tx.commit();
    } catch (commitError) {
      try {
        tx.close();
      } catch (closeError) {
        throw aggregateErrors("Transaction commit and close both failed", [
          commitError,
          closeError,
        ]);
      }
      throw commitError;
    }

    tx.close();
    return result;
  }

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
  delete(query?: object | Query): void {
    albedo.delete(this.handle, convertToQuery(query));
  }

  /**
   * Retrieve information about all indexes defined on the bucket.
   * @example
   * ```ts
   * console.log(bucket.indexes);
   * ```
   */
  get indexes() {
    return albedo.listIndexes(this.handle);
  }

  /**
   * Create or update an index on a field.
   * @param name - index name (field path)
   * @param options - index configuration
   * @example
   * ```ts
   * bucket.ensureIndex('name', { unique: false, sparse: false, reverse: false });
   * ```
   */
  ensureIndex(name: string, options: IndexOptions): void {
    albedo.ensureIndex(this.handle, name, options);
  }

  /**
   * Remove an index by name.
   * @example
   * ```ts
   * bucket.dropIndex('name');
   * ```
   */
  dropIndex(name: string): void {
    albedo.dropIndex(this.handle, name);
  }

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
  *list<T>(query?: object | Query): Generator<T> {
    const cursor = albedo.list(this.handle, convertToQuery(query));
    try {
      let data: unknown | null;
      while ((data = albedo.listData(cursor)) !== null) {
        yield data as T;
      }
    } finally {
      albedo.listClose(cursor);
    }
  }

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
  async *subscribe<T>(
    query?: object | Query,
    options?: SubscribeOptions,
  ): AsyncGenerator<SubscriptionEvent<T>> {
    const pollingTimeout = options?.pollingTimeout ?? 50;
    const batchSize = options?.batchSize ?? 64;
    const subscription = albedo.subscribe(
      this.handle,
      convertToQuery(query),
    );
    try {
      while (true) {
        const batch = albedo.subscribePoll<T>(subscription, batchSize);
        if (batch !== null) {
          for (const event of batch.batch) {
            yield event;
          }
        } else {
          await new Promise((r) => setTimeout(r, pollingTimeout));
        }
      }
    } finally {
      albedo.subscribeClose(subscription);
    }
  }

  /**
   * Collect all documents matching the optional query into an array.
   * @param query - filter or `Query` object
   * @returns array of all matching documents
   * @example
   * ```ts
   * const docs = bucket.all<{ name: string }>(where('name', { $exists: true }));
   * ```
   */
  all<T>(query?: object | Query): Array<T> {
    return Array.from(this.list<T>(query));
  }

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
  one<T>(query?: object | Query): T | null {
    for (const doc of this.list<T>(query)) {
      return doc;
    }
    return null;
  }



  /**
   * Normalize a query argument to a plain object, unpacking
   * `Query` instances.
   * @example
   * ```ts
   * Bucket.convertToQuery(new Query().where('x', { $eq: 1 }));
   * Bucket.convertToQuery({ foo: { $exists: true } });
   * ```
   */
  static convertToQuery(query?: object | Query): object {
    return convertToQuery(query);
  }

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
  *transformIterator<T extends object>(
    query?: object | Query,
  ): Generator<T, undefined, TransformReplacement<T>> {
    yield* iterateTransform<T>(albedo.transform(this.handle, convertToQuery(query)));
  }

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
  transform<T extends object>(
    query: object | Query | undefined,
    fn: (doc: T) => TransformReplacement<T>,
  ): void {
    applyTransform<T>(albedo.transform(this.handle, convertToQuery(query)), fn);
  }

  /**
   * Alias for `transform` that reads more naturally for document updates.
   */
  update<T extends object>(
    query: object | Query | undefined,
    fn: (doc: T) => TransformReplacement<T>,
  ): void {
    this.transform(query, fn);
  }

  replicationCursor(): ReplicationCursor {
    return albedo.replicationCursor(this.handle);
  }

  readReplicationBatch(
    cursor: ReplicationCursor,
    maxBytes = 0,
  ): Uint8Array | null {
    return albedo.readReplicationBatch(this.handle, cursor, maxBytes);
  }

  /**
   * Apply a batch of replication operations to this bucket.
   * @param data - bytes produced by another bucket's replication
   * @example
   * ```ts
   * bucket.applyReplicationBatch(remoteBytes);
   * ```
   */
  applyReplicationBatch(data: Uint8Array): ReplicationCursor {
    return albedo.applyReplicationBatch(this.handle, data);
  }
}

type BSONValue = any;

type FilterOperators =
  | { $eq: BSONValue }
  | BSONValue // shorthand for equality
  | { $ne: BSONValue }
  | { $lt: BSONValue }
  | { $lte: BSONValue }
  | { $gt: BSONValue }
  | { $gte: BSONValue }
  | { $in: BSONValue[] }
  | { $between: [BSONValue, BSONValue] }
  | { $startsWith: string }
  | { $endsWith: string }
  | { $exists: boolean }
  | { $notExists: boolean };

type QueryObject = {
  /** field path → filter */
  query?: Record<string, FilterOperators>;
  sort?: { asc: string } | { desc: string };
  sector?: { offset?: number; limit?: number };
  projection?: { omit: string[] } | { pick: string[] };
};

/**
 * Builder for query objects that can be used with bucket
 * operations like `list`, `delete`, and `transform`.
 *
 * The class supports chaining to construct filters, sorting,
 * and pagination (offset/limit).
 */
export class Query {
  private _query: QueryObject = {};

  /**
   * Return the raw query object to pass to the native layer.
   */
  get query(): object {
    return this._query;
  }

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
  where(field: string, filter: FilterOperators): this {
    if (!this._query.query) {
      this._query.query = {};
    }
    this._query.query[field] = filter;
    return this;
  }

  /**
   * Specify sorting for the result set.
   * @param field - field to sort by
   * @param direction - `asc` or `desc` (defaults to `asc`)
   * @example
   * ```ts
   * const q = new Query().sortBy('name', 'desc');
   * ```
   */
  sortBy(field: string, direction: "asc" | "desc" = "asc"): this {
    this._query.sort = direction === "asc" ? { asc: field } : { desc: field };
    return this;
  }

  /**
   * Set an offset and limit for pagination.
   * @param offset - number of documents to skip
   * @param limit - maximum number of documents to return
   * @example
   * ```ts
   * const q = new Query().sector(10, 5);
   * ```
   */
  sector(offset?: number, limit?: number): this {
    this._query.sector = { offset, limit };
    return this;
  }
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
export function where(field: string, filter: FilterOperators): Query {
  return new Query().where(field, filter);
}
