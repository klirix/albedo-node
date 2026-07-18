type BSONValue = any;
export type FilterOperators = {
    $eq: BSONValue;
} | BSONValue | {
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
export interface QueryClause {
    $or?: QueryClause[];
    $and?: QueryClause[];
    $nor?: QueryClause[];
    [field: string]: FilterOperators | QueryClause[] | undefined;
}
export type QuerySort = {
    asc: string;
} | {
    desc: string;
};
export interface QuerySector {
    offset?: number;
    limit?: number;
}
export interface QueryObject {
    query?: QueryClause;
    sort?: QuerySort;
    sector?: QuerySector;
    projection?: {
        omit: string[];
    } | {
        pick: string[];
    };
    cursor?: Record<string, unknown>;
}
export type QueryInput = QueryObject | Query;
export type QueryClauseInput = QueryClause | Query;
/**
 * Builder for query objects that can be used with bucket
 * operations like `list`, `delete`, and `transform`.
 *
 * The class supports chaining to construct filters, sorting,
 * and pagination (offset/limit).
 */
export declare class Query {
    private _query;
    static or(...clauses: QueryClauseInput[]): Query;
    static and(...clauses: QueryClauseInput[]): Query;
    static nor(...clauses: QueryClauseInput[]): Query;
    /**
     * Return the raw query object to pass to the native layer.
     */
    get query(): QueryObject;
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
     * Add an `$or` clause to the query.
     * @param clauses - query groups where at least one must match
     */
    or(...clauses: QueryClauseInput[]): this;
    /**
     * Add an `$and` clause to the query.
     * @param clauses - query groups where all must match
     */
    and(...clauses: QueryClauseInput[]): this;
    /**
     * Add a `$nor` clause to the query.
     * @param clauses - query groups where none may match
     */
    nor(...clauses: QueryClauseInput[]): this;
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
    private addLogicalClause;
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
export {};
