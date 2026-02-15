//! By convention, root.zig is the root source file when making a library.
const std = @import("std");
const albedo = @import("albedo");
const napigen = @import("napigen");
const bson = @import("./bson.zig");

const ally = std.heap.smp_allocator;

pub const std_options: std.Options = .{
    .crypto_always_getrandom = true,
};

fn generateObjectIdBytes() [12]u8 {
    var raw: [12]u8 = undefined;
    const ts = @as(u32, @intCast(std.time.timestamp()));
    std.mem.writeInt(u32, raw[0..4], ts, .big);
    std.crypto.random.bytes(raw[4..12]);

    return raw;
}

fn objectIdConstructorFunction(env: napigen.napi.napi_env, info: napigen.napi.napi_callback_info) callconv(.c) napigen.napi_value {
    var argc: usize = 1;
    var argv: [1]napigen.napi_value = .{null};
    var this_arg: napigen.napi_value = null;
    const status = napigen.napi.napi_get_cb_info(env, info, &argc, &argv[0], &this_arg, null);
    if (status != napigen.napi.napi_ok) return null;

    if (argc >= 1 and argv[0] != null) {
        _ = napigen.napi.napi_set_named_property(env, this_arg, "buffer", argv[0]);
        return this_arg;
    }

    const raw = generateObjectIdBytes();

    var arraybuffer: napigen.napi.napi_value = undefined;
    var data_ptr: ?*anyopaque = null;
    if (napigen.napi.napi_create_arraybuffer(env, raw.len, &data_ptr, &arraybuffer) != napigen.napi.napi_ok) return null;
    if (data_ptr == null) return null;

    const dst = @as([*]u8, @ptrCast(data_ptr.?));
    @memcpy(dst[0..raw.len], raw[0..]);

    var typedarray: napigen.napi.napi_value = undefined;
    if (napigen.napi.napi_create_typedarray(env, napigen.napi.napi_uint8_array, raw.len, arraybuffer, 0, &typedarray) != napigen.napi.napi_ok) return null;
    _ = napigen.napi.napi_set_named_property(env, this_arg, "buffer", typedarray);

    return this_arg;
}

fn objectIdToStringFunction(env: napigen.napi.napi_env, info: napigen.napi.napi_callback_info) callconv(.c) napigen.napi_value {
    var argc: usize = 0;
    var this_arg: napigen.napi.napi_value = null;
    if (napigen.napi.napi_get_cb_info(env, info, &argc, null, &this_arg, null) != napigen.napi.napi_ok) return null;

    var buffer_value: napigen.napi.napi_value = undefined;
    if (napigen.napi.napi_get_named_property(env, this_arg, "buffer", &buffer_value) != napigen.napi.napi_ok) return null;

    var raw: [12]u8 = undefined;

    var is_buffer: bool = false;
    if (napigen.napi.napi_is_buffer(env, buffer_value, &is_buffer) != napigen.napi.napi_ok) return null;
    if (is_buffer) {
        var data_ptr: ?*anyopaque = null;
        var length: usize = 0;
        if (napigen.napi.napi_get_buffer_info(env, buffer_value, &data_ptr, &length) != napigen.napi.napi_ok) return null;
        if (data_ptr == null or length != 12) return null;
        const src = @as([*]const u8, @ptrCast(data_ptr.?));
        @memcpy(raw[0..12], src[0..12]);
    } else {
        var typed_array_type: napigen.napi.napi_typedarray_type = undefined;
        var length: usize = 0;
        var data_ptr: ?*anyopaque = null;
        if (napigen.napi.napi_get_typedarray_info(env, buffer_value, &typed_array_type, &length, &data_ptr, null, null) != napigen.napi.napi_ok) return null;
        if (data_ptr == null or length != 12) return null;
        if (typed_array_type != napigen.napi.napi_uint8_array and typed_array_type != napigen.napi.napi_uint8_clamped_array) return null;
        const src = @as([*]const u8, @ptrCast(data_ptr.?));
        @memcpy(raw[0..12], src[0..12]);
    }

    const hex = albedo.bson.ObjectId.toString(.{ .buffer = raw });
    var result: napigen.napi.napi_value = undefined;
    if (napigen.napi.napi_create_string_utf8(env, &hex[0], hex.len, &result) != napigen.napi.napi_ok) return null;
    return result;
}

fn objectIdFromStringFunction(env: napigen.napi.napi_env, info: napigen.napi.napi_callback_info) callconv(.c) napigen.napi_value {
    var argc: usize = 1;
    var argv: [1]napigen.napi.napi_value = .{null};
    var this_arg: napigen.napi.napi_value = null;
    if (napigen.napi.napi_get_cb_info(env, info, &argc, &argv[0], &this_arg, null) != napigen.napi.napi_ok) return null;
    if (argc < 1 or argv[0] == null) return null;

    var str_len: usize = 0;
    if (napigen.napi.napi_get_value_string_utf8(env, argv[0], null, 0, &str_len) != napigen.napi.napi_ok) return null;

    var str_buf: [25]u8 = undefined;
    if (str_len != 24) return null;
    var written: usize = 0;
    if (napigen.napi.napi_get_value_string_utf8(env, argv[0], &str_buf[0], str_buf.len, &written) != napigen.napi.napi_ok) return null;

    const parsed = albedo.bson.ObjectId.parseString(str_buf[0..written]) catch return null;

    var arraybuffer: napigen.napi.napi_value = undefined;
    var data_ptr: ?*anyopaque = null;
    if (napigen.napi.napi_create_arraybuffer(env, 12, &data_ptr, &arraybuffer) != napigen.napi.napi_ok) return null;
    if (data_ptr == null) return null;

    const dst = @as([*]u8, @ptrCast(data_ptr.?));
    @memcpy(dst[0..12], parsed.buffer[0..12]);

    var typedarray: napigen.napi.napi_value = undefined;
    if (napigen.napi.napi_create_typedarray(env, napigen.napi.napi_uint8_array, 12, arraybuffer, 0, &typedarray) != napigen.napi.napi_ok) return null;

    var instance: napigen.napi.napi_value = undefined;
    if (napigen.napi.napi_new_instance(env, this_arg, 1, &typedarray, &instance) != napigen.napi.napi_ok) return null;
    return instance;
}

comptime {
    napigen.defineModule(initModule);
}

fn open(path: []const u8) !*albedo.Bucket {
    const bucket = try ally.create(albedo.Bucket);
    bucket.* = try albedo.Bucket.openFile(ally, path);
    return bucket;
}

fn close(bucket: *albedo.Bucket) void {
    bucket.deinit();
    bucket.allocator.destroy(bucket);
}

fn getTypedArraySlice(js: *napigen.JsContext, value: napigen.napi_value) ![]const u8 {
    const napi = napigen.napi;

    var is_buffer: bool = false;
    try napigen.check(napi.napi_is_buffer(js.env, value, &is_buffer));
    if (is_buffer) {
        var data_ptr: ?*anyopaque = null;
        var length: usize = 0;
        try napigen.check(napi.napi_get_buffer_info(js.env, value, &data_ptr, &length));
        if (data_ptr == null) return error.InvalidTypedArray;
        const ptr = @as([*]const u8, @ptrCast(data_ptr.?));
        return ptr[0..length];
    }

    var is_typed_array: bool = false;
    try napigen.check(napi.napi_is_typedarray(js.env, value, &is_typed_array));
    if (!is_typed_array) return error.InvalidTypedArray;

    var typed_array_type: napi.napi_typedarray_type = undefined;
    var length: usize = 0;
    var data_ptr: ?*anyopaque = null;
    try napigen.check(napi.napi_get_typedarray_info(js.env, value, &typed_array_type, &length, &data_ptr, null, null));
    if (data_ptr == null) return error.InvalidTypedArray;
    if (typed_array_type != napi.napi_uint8_array and typed_array_type != napi.napi_uint8_clamped_array) return error.InvalidTypedArray;

    const ptr = @as([*]const u8, @ptrCast(data_ptr.?));
    return ptr[0..length];
}

fn createUint8Array(env: napigen.napi_env, data: []const u8) !napigen.napi_value {
    const napi = napigen.napi;
    var buffer: napigen.napi_value = undefined;
    var uint8arr: napigen.napi_value = undefined;
    var data_ptr: ?*anyopaque = null;
    try napigen.check(napi.napi_create_arraybuffer(env, data.len, &data_ptr, &buffer));
    if (data_ptr == null) return error.InvalidTypedArray;
    const dst = @as([*]u8, @ptrCast(data_ptr.?));
    @memcpy(dst[0..data.len], data);
    try napigen.check(napi.napi_create_typedarray(env, napi.napi_uint8_array, data.len, buffer, 0, &uint8arr));
    return uint8arr;
}

fn list(js: *napigen.JsContext, bucket: *albedo.Bucket, queryBuf: napigen.napi_value) !*albedo.Bucket.ListIterator {
    const arena = try ally.create(std.heap.ArenaAllocator);
    arena.* = std.heap.ArenaAllocator.init(ally);

    const js_bytes = try getTypedArraySlice(js, queryBuf);
    const query_bytes = try arena.allocator().alloc(u8, js_bytes.len);
    @memcpy(query_bytes, js_bytes);
    const queryDoc = albedo.BSONDocument{ .buffer = query_bytes };

    const query = try albedo.Query.parse(arena.allocator(), queryDoc);
    const cursor = try bucket.listIterate(arena, query);
    return cursor;
}

fn listClose(cursor: *albedo.Bucket.ListIterator) !void {
    try cursor.deinit();
    cursor.arena.deinit();
}

fn listData(js: *napigen.JsContext, cursor: *albedo.Bucket.ListIterator) !napigen.napi_value {
    const doc = try cursor.next(cursor);
    if (doc == null) return js.null();

    return try createUint8Array(js.env, doc.?.buffer);
}

fn insert(js: *napigen.JsContext, bucket: *albedo.Bucket, docBuf: napigen.napi_value) !void {
    const js_bytes = try getTypedArraySlice(js, docBuf);
    const doc = albedo.BSONDocument{ .buffer = js_bytes };
    _ = try bucket.insert(doc);
}

const IndexOptions = struct {
    unique: bool,
    sparse: bool,
    reverse: bool,
};

fn ensureIndex(bucket: *albedo.Bucket, name: []const u8, options: IndexOptions) !void {
    try bucket.ensureIndex(name, .{
        .reverse = @intFromBool(options.reverse),
        .sparse = @intFromBool(options.sparse),
        .unique = @intFromBool(options.unique),
    });
}

fn listIndexes(js: *napigen.JsContext, bucket: *albedo.Bucket) !napigen.napi_value {
    const localAlly =
        js.arena.allocator();
    const data = try bucket.listIndexes();
    const returnObject = try js.createObject();
    for (data.indexes[0..]) |entry| {
        const indexObject = try js.createObject();
        const sentinelKey = try localAlly.allocSentinel(u8, entry.key.len, 0);
        defer localAlly.free(sentinelKey);
        @memcpy(sentinelKey[0..entry.key.len], entry.key);
        try js.setNamedProperty(indexObject, "name", try js.createString(entry.key));
        try js.setNamedProperty(indexObject, "unique", try js.createBoolean((entry.value.options.unique == 1)));
        try js.setNamedProperty(indexObject, "sparse", try js.createBoolean((entry.value.options.sparse == 1)));
        try js.setNamedProperty(indexObject, "reverse", try js.createBoolean((entry.value.options.reverse == 1)));
        try js.setNamedProperty(returnObject, sentinelKey, indexObject);
    }
    return returnObject;
}

fn dropIndex(bucket: *albedo.Bucket, name: []const u8) !void {
    try bucket.dropIndex(name);
}

fn delete(js: *napigen.JsContext, bucket: *albedo.Bucket, queryBuf: napigen.napi_value) !void {
    var arena = std.heap.ArenaAllocator.init(ally);

    const queryDoc = try getTypedArraySlice(js, queryBuf);
    var query = albedo.Query.parse(arena.allocator(), albedo.BSONDocument{ .buffer = queryDoc }) catch {
        arena.deinit();
        return error.InvalidQuery;
    };
    query.deinit(arena.allocator());

    try bucket.delete(query);
}

fn transform(js: *napigen.JsContext, bucket: *albedo.Bucket, queryBuf: napigen.napi_value) !*albedo.Bucket.TransformIterator {
    const arena = try ally.create(std.heap.ArenaAllocator);
    arena.* = std.heap.ArenaAllocator.init(ally);

    const js_bytes = try getTypedArraySlice(js, queryBuf);
    const query = try albedo.Query.parse(arena.allocator(), albedo.BSONDocument{ .buffer = js_bytes });

    return try bucket.transformIterate(arena, query);
}

fn transformData(js: *napigen.JsContext, iter: *albedo.Bucket.TransformIterator) !napigen.napi_value {
    const result = try iter.data();
    if (result == null) return null;

    return try createUint8Array(js.env, result.?.buffer);
}

fn transformApply(js: *napigen.JsContext, iter: *albedo.Bucket.TransformIterator, replaceBuffer: napigen.napi_value) !void {
    const doc: ?*const albedo.BSONDocument = blk: {
        if (try js.typeOf(replaceBuffer) == napigen.napi.napi_null) {
            break :blk null;
        }

        const js_bytes = try getTypedArraySlice(js, replaceBuffer);
        break :blk &albedo.BSONDocument.init(js_bytes);
    };

    if (doc == null) return;

    try iter.transform(doc);
}

fn transformClose(iter: *albedo.Bucket.TransformIterator) !void {
    try iter.close();
}

const ReplicationStruct = struct {
    cb_ref: napigen.napi_ref,
    env: napigen.napi_env,
    fn call(
        context: ?*anyopaque, // User-provided context
        data: [*]const u8, // Raw data: header (64 bytes) + N pages (8192 bytes each)
        data_size: u32, // Total size of data (BucketHeader.byteSize + page_count * DEFAULT_PAGE_SIZE)
        _: u32, // Number of pages in the batch
    ) callconv(.c) u8 {
        const ctx: *ReplicationStruct = @ptrCast(@alignCast(context));
        const pageBuf = createUint8Array(ctx.env, data[0..data_size]) catch return 1;
        var cb: napigen.napi_value = undefined;
        napigen.check(napigen.napi.napi_get_reference_value(ctx.env, ctx.cb_ref, &cb)) catch return 1;
        var undie: napigen.napi_value = undefined;
        napigen.check(napigen.napi.napi_get_undefined(ctx.env, &undie)) catch return 1;
        const argv = [_]napigen.napi_value{pageBuf};
        napigen.check(napigen.napi.napi_call_function(ctx.env, undie, cb, 1, &argv[0], null)) catch return 1;
        return 0;
    }
};

fn setReplicationCallback(js: *napigen.JsContext, bucket: *albedo.Bucket, cb: napigen.napi_value) !void {
    var cb_ref: napigen.napi_ref = undefined;
    try napigen.check(napigen.napi.napi_create_reference(js.env, cb, 1, &cb_ref));
    const replicationStruct = try ally.create(ReplicationStruct);
    replicationStruct.* = .{
        .cb_ref = cb_ref,
        .env = js.env,
    };
    bucket.replication_callback = ReplicationStruct.call;
    bucket.replication_context = @ptrCast(replicationStruct);
}

fn applyReplicationBatch(js: *napigen.JsContext, bucket: *albedo.Bucket, data: napigen.napi_value) !void {
    if (bucket.replication_callback == null) return;
    const js_bytes = try getTypedArraySlice(js, data);
    try bucket.applyReplicatedBatch(js_bytes, @truncate(js_bytes.len >> 13));
}

fn initModule(js: *napigen.JsContext, exports: napigen.napi_value) anyerror!napigen.napi_value {
    var objectIdConstructor: napigen.napi_value = undefined;
    try napigen.check(napigen.napi.napi_define_class(js.env, "ObjectId", napigen.napi.NAPI_AUTO_LENGTH, objectIdConstructorFunction, null, 0, null, &objectIdConstructor));

    var objectIdProto: napigen.napi_value = undefined;
    try napigen.check(napigen.napi.napi_get_named_property(js.env, objectIdConstructor, "prototype", &objectIdProto));

    var objectIdToString: napigen.napi_value = undefined;
    try napigen.check(napigen.napi.napi_create_function(js.env, "toString", napigen.napi.NAPI_AUTO_LENGTH, objectIdToStringFunction, null, &objectIdToString));
    try napigen.check(napigen.napi.napi_set_named_property(js.env, objectIdProto, "toString", objectIdToString));

    var objectIdFromString: napigen.napi.napi_value = undefined;
    try napigen.check(napigen.napi.napi_create_function(js.env, "fromString", napigen.napi.NAPI_AUTO_LENGTH, objectIdFromStringFunction, null, &objectIdFromString));
    try napigen.check(napigen.napi.napi_set_named_property(js.env, objectIdConstructor, "fromString", objectIdFromString));

    try js.setNamedProperty(exports, "ObjectId", objectIdConstructor);
    try js.setNamedProperty(exports, "serialize", try js.createNamedFunction("serialize", bson.serialize));
    try js.setNamedProperty(exports, "deserialize", try js.createNamedFunction("deserialize", bson.deserialize));
    try js.setNamedProperty(exports, "open", try js.createFunction(open));
    try js.setNamedProperty(exports, "close", try js.createFunction(close));
    try js.setNamedProperty(exports, "list", try js.createFunction(list));
    try js.setNamedProperty(exports, "listClose", try js.createFunction(listClose));
    try js.setNamedProperty(exports, "listData", try js.createFunction(listData));
    try js.setNamedProperty(exports, "insert", try js.createFunction(insert));
    try js.setNamedProperty(exports, "ensureIndex", try js.createFunction(ensureIndex));
    try js.setNamedProperty(exports, "listIndexes", try js.createFunction(listIndexes));
    try js.setNamedProperty(exports, "dropIndex", try js.createFunction(dropIndex));
    try js.setNamedProperty(exports, "delete", try js.createFunction(delete));
    try js.setNamedProperty(exports, "transform", try js.createFunction(transform));
    try js.setNamedProperty(exports, "transformClose", try js.createFunction(transformClose));
    try js.setNamedProperty(exports, "transformData", try js.createFunction(transformData));
    try js.setNamedProperty(exports, "transformApply", try js.createFunction(transformApply));
    try js.setNamedProperty(exports, "setReplicationCallback", try js.createFunction(setReplicationCallback));
    try js.setNamedProperty(exports, "applyReplicationBatch", try js.createFunction(applyReplicationBatch));
    var ctor_ref: napigen.napi.napi_ref = undefined;
    try napigen.check(napigen.napi.napi_create_reference(js.env, objectIdConstructor, 1, &ctor_ref));
    bson.objectIdConstructorRef = ctor_ref;
    return exports;
}
