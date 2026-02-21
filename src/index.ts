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
  transformApply(
    iter: TransformIteratorHandle,
    replace: ByteBuffer | object | null,
  ): void;
  setReplicationCallback(
    bucket: BucketHandle,
    callback: (data: Uint8Array) => void,
  ): void;
  applyReplicationBatch(bucket: BucketHandle, data: ByteBuffer): void;
}

const platformSuffix = process.platform == "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform;
const archSuffix = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch;
const isMusl = process.versions.libc && process.versions.libc.includes("musl");
const libcSuffix = isMusl ? "_musl" : "";

const albedo = require(
  `../native/albedo.${archSuffix}_${platformSuffix}${libcSuffix}.node`,
) as AlbedoModule;

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
  static open(path: string): Bucket {
    const handle = albedo.open(path);
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
    albedo.delete(this.handle, Bucket.convertToQuery(query));
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
    const cursor = albedo.list(this.handle, Bucket.convertToQuery(query));
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
   * Normalize a query argument to a plain object, unpacking
   * `Query` instances.
   * @example
   * ```ts
   * Bucket.convertToQuery(new Query().where('x', { $eq: 1 }));
   * Bucket.convertToQuery({ foo: { $exists: true } });
   * ```
   */
  static convertToQuery(query?: object | Query): object {
    if (query instanceof Query) {
      return query.query;
    }
    return query || {};
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
  *transformIterator<T>(
    query?: object | Query,
  ): Generator<T, undefined, null | object> {
    const queryObj = Bucket.convertToQuery(query);
    const iter = albedo.transform(this.handle, queryObj);
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
    fn: (doc: T) => T | null,
  ): void {
    const queryObj = Bucket.convertToQuery(query);
    const iter = albedo.transform(this.handle, queryObj);
    try {
      let data: unknown | null;
      while ((data = albedo.transformData(iter)) !== undefined) {
        albedo.transformApply(iter, fn(data as T));
      }
    } finally {
      albedo.transformClose(iter);
    }
  }

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
  setReplicationCallback(callback: (data: Uint8Array) => void): void {
    albedo.setReplicationCallback(this.handle, callback);
  }

  /**
   * Apply a batch of replication operations to this bucket.
   * @param data - bytes produced by another bucket's replication
   * @example
   * ```ts
   * bucket.applyReplicationBatch(remoteBytes);
   * ```
   */
  applyReplicationBatch(data: Uint8Array): void {
    albedo.applyReplicationBatch(this.handle, data);
  }
}

type BSONValue = any;

type FilterOperators =
  | { $eq: BSONValue }
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