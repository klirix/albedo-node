"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Query = void 0;
exports.where = where;
function isQuery(value) {
    return value instanceof Query;
}
function toClause(value) {
    if (isQuery(value)) {
        return value.query.query ?? {};
    }
    return value;
}
/**
 * Builder for query objects that can be used with bucket
 * operations like `list`, `delete`, and `transform`.
 *
 * The class supports chaining to construct filters, sorting,
 * and pagination (offset/limit).
 */
class Query {
    _query = {};
    static or(...clauses) {
        return new Query().or(...clauses);
    }
    static and(...clauses) {
        return new Query().and(...clauses);
    }
    static nor(...clauses) {
        return new Query().nor(...clauses);
    }
    /**
     * Return the raw query object to pass to the native layer.
     */
    get query() {
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
    where(field, filter) {
        if (!this._query.query) {
            this._query.query = {};
        }
        this._query.query[field] = filter;
        return this;
    }
    /**
     * Add an `$or` clause to the query.
     * @param clauses - query groups where at least one must match
     */
    or(...clauses) {
        return this.addLogicalClause("$or", clauses);
    }
    /**
     * Add an `$and` clause to the query.
     * @param clauses - query groups where all must match
     */
    and(...clauses) {
        return this.addLogicalClause("$and", clauses);
    }
    /**
     * Add a `$nor` clause to the query.
     * @param clauses - query groups where none may match
     */
    nor(...clauses) {
        return this.addLogicalClause("$nor", clauses);
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
    sortBy(field, direction = "asc") {
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
    sector(offset, limit) {
        this._query.sector = { offset, limit };
        return this;
    }
    addLogicalClause(operator, clauses) {
        if (!this._query.query) {
            this._query.query = {};
        }
        this._query.query[operator] = clauses.map(toClause);
        return this;
    }
}
exports.Query = Query;
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
function where(field, filter) {
    return new Query().where(field, filter);
}
