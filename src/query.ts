type BSONValue = any;

export type FilterOperators =
  | { $eq: BSONValue }
  | BSONValue
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

export interface QueryClause {
  $or?: QueryClause[];
  $and?: QueryClause[];
  $nor?: QueryClause[];
  [field: string]: FilterOperators | QueryClause[] | undefined;
}

export type QuerySort = { asc: string } | { desc: string };

export interface QuerySector {
  offset?: number;
  limit?: number;
}

export interface QueryObject {
  query?: QueryClause;
  sort?: QuerySort;
  sector?: QuerySector;
  projection?: { omit: string[] } | { pick: string[] };
  cursor?: Record<string, unknown>;
}

export type QueryInput = QueryObject | Query;
export type QueryClauseInput = QueryClause | Query;

function isQuery(value: QueryClauseInput): value is Query {
  return value instanceof Query;
}

function toClause(value: QueryClauseInput): QueryClause {
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
export class Query {
  private _query: QueryObject = {};

  static or(...clauses: QueryClauseInput[]): Query {
    return new Query().or(...clauses);
  }

  static and(...clauses: QueryClauseInput[]): Query {
    return new Query().and(...clauses);
  }

  static nor(...clauses: QueryClauseInput[]): Query {
    return new Query().nor(...clauses);
  }

  /**
   * Return the raw query object to pass to the native layer.
   */
  get query(): QueryObject {
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
   * Add an `$or` clause to the query.
   * @param clauses - query groups where at least one must match
   */
  or(...clauses: QueryClauseInput[]): this {
    return this.addLogicalClause("$or", clauses);
  }

  /**
   * Add an `$and` clause to the query.
   * @param clauses - query groups where all must match
   */
  and(...clauses: QueryClauseInput[]): this {
    return this.addLogicalClause("$and", clauses);
  }

  /**
   * Add a `$nor` clause to the query.
   * @param clauses - query groups where none may match
   */
  nor(...clauses: QueryClauseInput[]): this {
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

  private addLogicalClause(
    operator: "$or" | "$and" | "$nor",
    clauses: QueryClauseInput[],
  ): this {
    if (!this._query.query) {
      this._query.query = {};
    }
    this._query.query[operator] = clauses.map(toClause);
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
