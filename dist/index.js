"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bucket = exports.Transaction = exports.ObjectId = exports.BSON = exports.albedo = void 0;
const detect_libc_1 = require("detect-libc");
const query_1 = require("./query");
__exportStar(require("./query"), exports);
function getNativeBinding() {
    const platformMap = {
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
    const archMap = {
        x64: "x86_64",
        arm64: "aarch64",
    };
    const platform = platformMap[process.platform] ?? process.platform;
    const arch = archMap[process.arch] ?? process.arch;
    let suffix = "";
    if (platform === "linux") {
        const libc = (0, detect_libc_1.familySync)(); // 'glibc' | 'musl' | null
        suffix = libc === detect_libc_1.MUSL ? "_musl" : "_gnu";
    }
    const filename = `albedo.${arch}_${platform}${suffix}.node`;
    return require(`../native/${filename}`); // or import() if you prefer ESM
}
exports.albedo = getNativeBinding();
exports.default = exports.albedo;
exports.BSON = {
    serialize: exports.albedo.serialize,
    deserialize: exports.albedo.deserialize,
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
exports.ObjectId = exports.albedo.ObjectId;
function convertToQuery(query) {
    if (query instanceof query_1.Query) {
        return query.query;
    }
    return query || {};
}
function* iterateTransform(iter) {
    try {
        let data;
        while ((data = exports.albedo.transformData(iter)) !== undefined) {
            const newDoc = yield data;
            exports.albedo.transformApply(iter, newDoc);
        }
    }
    finally {
        exports.albedo.transformClose(iter);
    }
}
function applyTransform(iter, fn) {
    try {
        let data;
        while ((data = exports.albedo.transformData(iter)) !== undefined) {
            exports.albedo.transformApply(iter, fn(data));
        }
    }
    finally {
        exports.albedo.transformClose(iter);
    }
}
function aggregateErrors(message, errors) {
    return new AggregateError(errors, message);
}
/**
 * Wrapper around a native transaction handle providing
 * write operations that are committed or rolled back together.
 */
class Transaction {
    handle;
    constructor(handle) {
        this.handle = handle;
    }
    get nativeHandle() {
        if (this.handle === null) {
            throw new Error("Transaction is closed");
        }
        return this.handle;
    }
    /**
     * Insert a document or raw byte buffer into the transaction.
     */
    insert(doc) {
        exports.albedo.transactionInsert(this.nativeHandle, doc);
    }
    /**
     * Delete documents matching the query from the transaction.
     */
    delete(query) {
        exports.albedo.transactionDelete(this.nativeHandle, convertToQuery(query));
    }
    /**
     * Generator that allows reading and modifying matching documents
     * within the transaction.
     */
    transformIterator(query) {
        return iterateTransform(exports.albedo.transactionTransform(this.nativeHandle, convertToQuery(query)));
    }
    /**
     * Apply a transformation function to matching documents in the transaction.
     */
    transform(query, fn) {
        applyTransform(exports.albedo.transactionTransform(this.nativeHandle, convertToQuery(query)), fn);
    }
    /**
     * Alias for `transform` that reads more naturally for document updates.
     */
    update(query, fn) {
        this.transform(query, fn);
    }
    /**
     * Commit the transaction.
     */
    commit() {
        exports.albedo.transactionCommit(this.nativeHandle);
    }
    /**
     * Roll back the transaction.
     */
    rollback() {
        exports.albedo.transactionRollback(this.nativeHandle);
    }
    /**
     * Close the transaction and release native resources.
     */
    close() {
        const handle = this.nativeHandle;
        exports.albedo.transactionClose(handle);
        this.handle = null;
    }
}
exports.Transaction = Transaction;
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
class Bucket {
    handle;
    /**
     * Create a Bucket instance from an existing native handle.
     * @param handle - opaque bucket handle returned by `albedo.open`
     * @example
     * ```ts
     * const raw = albedo.open('foo.db');
     * const bucket = new Bucket(raw);
     * ```
     */
    constructor(handle) {
        this.handle = handle;
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
    static open(path, options) {
        const handle = options ? exports.albedo.open_with_options(path, options) : exports.albedo.open(path);
        return new Bucket(handle);
    }
    /**
     * Close the bucket and release native resources.
     * @example
     * ```ts
     * bucket.close();
     * ```
     */
    close() {
        exports.albedo.close(this.handle);
    }
    /**
     * Insert a document or raw byte buffer into the bucket.
     * @param doc - object to serialize or pre-serialized buffer
     * @example
     * ```ts
     * bucket.insert({ name: 'Bob' });
     * ```
     */
    insert(doc) {
        exports.albedo.insert(this.handle, doc);
    }
    /**
     * Flush buffered bucket state through the native checkpoint mechanism.
     */
    checkpoint() {
        exports.albedo.checkpoint(this.handle);
    }
    /**
     * Begin a manual transaction on this bucket.
     */
    beginTransaction() {
        return new Transaction(exports.albedo.transactionBegin(this.handle));
    }
    /**
     * Run a callback inside a transaction and commit it on success.
     *
     * If the callback throws, the transaction is rolled back before the
     * original error is re-thrown.
     */
    tx(fn) {
        const tx = this.beginTransaction();
        let result;
        try {
            result = fn(tx);
        }
        catch (error) {
            try {
                tx.rollback();
            }
            catch (rollbackError) {
                try {
                    tx.close();
                }
                catch (closeError) {
                    throw aggregateErrors("Transaction failed, rollback failed, and close failed", [error, rollbackError, closeError]);
                }
                throw aggregateErrors("Transaction failed and rollback failed", [
                    error,
                    rollbackError,
                ]);
            }
            try {
                tx.close();
            }
            catch (closeError) {
                throw aggregateErrors("Transaction failed and close failed", [
                    error,
                    closeError,
                ]);
            }
            throw error;
        }
        try {
            tx.commit();
        }
        catch (commitError) {
            try {
                tx.close();
            }
            catch (closeError) {
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
    delete(query) {
        exports.albedo.delete(this.handle, convertToQuery(query));
    }
    /**
     * Retrieve information about all indexes defined on the bucket.
     * @example
     * ```ts
     * console.log(bucket.indexes);
     * ```
     */
    get indexes() {
        return exports.albedo.listIndexes(this.handle);
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
    ensureIndex(name, options) {
        exports.albedo.ensureIndex(this.handle, name, options);
    }
    /**
     * Remove an index by name.
     * @example
     * ```ts
     * bucket.dropIndex('name');
     * ```
     */
    dropIndex(name) {
        exports.albedo.dropIndex(this.handle, name);
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
    *list(query) {
        const cursor = exports.albedo.list(this.handle, convertToQuery(query));
        try {
            let data;
            while ((data = exports.albedo.listData(cursor)) !== null) {
                yield data;
            }
        }
        finally {
            exports.albedo.listClose(cursor);
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
    async *subscribe(query, options) {
        const pollingTimeout = options?.pollingTimeout ?? 50;
        const batchSize = options?.batchSize ?? 64;
        const subscription = exports.albedo.subscribe(this.handle, convertToQuery(query));
        try {
            while (true) {
                const batch = exports.albedo.subscribePoll(subscription, batchSize);
                console.log("Polled subscription, got batch:", batch);
                if (batch !== null) {
                    for (const event of batch.batch) {
                        yield event;
                    }
                }
                else {
                    await new Promise((r) => setTimeout(r, pollingTimeout));
                }
            }
        }
        finally {
            exports.albedo.subscribeClose(subscription);
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
    all(query) {
        return Array.from(this.list(query));
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
    one(query) {
        for (const doc of this.list(query)) {
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
    static convertToQuery(query) {
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
    *transformIterator(query) {
        yield* iterateTransform(exports.albedo.transform(this.handle, convertToQuery(query)));
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
    transform(query, fn) {
        applyTransform(exports.albedo.transform(this.handle, convertToQuery(query)), fn);
    }
    /**
     * Alias for `transform` that reads more naturally for document updates.
     */
    update(query, fn) {
        this.transform(query, fn);
    }
    replicationCursor() {
        return exports.albedo.replicationCursor(this.handle);
    }
    readReplicationBatch(cursor, maxBytes = 0) {
        return exports.albedo.readReplicationBatch(this.handle, cursor, maxBytes);
    }
    /**
     * Apply a batch of replication operations to this bucket.
     * @param data - bytes produced by another bucket's replication
     * @example
     * ```ts
     * bucket.applyReplicationBatch(remoteBytes);
     * ```
     */
    applyReplicationBatch(data) {
        return exports.albedo.applyReplicationBatch(this.handle, data);
    }
}
exports.Bucket = Bucket;
