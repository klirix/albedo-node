const ng = @import("napigen");
const napi = ng.napi;
const napi_value = napi.napi_value;
const albedo = @import("albedo");
const std = @import("std");
const bson = albedo.bson;

pub var objectIdConstructorRef: ?napi.napi_ref = null;

// Ensure we use getrandom for secure random bytes, which is needed for ObjectId generation

fn getObjectIdConstructor(js: *ng.JsContext) ng.Error!napi_value {
    if (objectIdConstructorRef == null) return error.napi_invalid_arg;
    var ctor: napi_value = undefined;
    try ng.check(napi.napi_get_reference_value(js.env, objectIdConstructorRef.?, &ctor));
    return ctor;
}

// Takes a JavaScript object and returns a Uint8Array of BSON data.
pub fn serialize(js: *ng.JsContext, jsObject: napi_value) !napi_value {
    const doc = try jsObjectToBsonDoc(js, jsObject);
    var buffer: napi_value = undefined;
    var uint8arr: napi_value = undefined;
    var data_ptr: ?*anyopaque = null;
    try ng.check(napi.napi_create_arraybuffer(js.env, doc.buffer.len, &data_ptr, &buffer));
    const newBytes = @as([*]u8, @ptrCast(data_ptr.?));
    @memcpy(newBytes[0..doc.buffer.len], doc.buffer);
    try ng.check(napi.napi_create_typedarray(js.env, napi.napi_uint8_array, doc.buffer.len, buffer, 0, &uint8arr));
    return uint8arr;
}

fn jsObjectToBsonDoc(js: *ng.JsContext, jsObject: napi_value) ng.Error!albedo.BSONDocument {
    var propertyNames: napi_value = undefined;
    try ng.check(napi.napi_get_property_names(js.env, jsObject, &propertyNames));
    const length = try js.getArrayLength(propertyNames);
    const ally = js.arena.allocator();
    const keypairs = try ally.alloc(bson.BSONKeyValuePair, length);
    defer ally.free(keypairs);
    for (0..length) |i| {
        const jsStringKey = try js.getElement(propertyNames, @truncate(i));
        const keyStr = try js.readString(jsStringKey);
        // Don't defer free keyStr - it's needed in the BSONDocument
        var keySentinel: [:0]u8 = try ally.allocSentinel(u8, keyStr.len, 0); // Sentinel to ensure the string data is not modified
        defer ally.free(keySentinel);
        @memcpy(keySentinel[0..keyStr.len], keyStr);
        const jsValue = try js.getNamedProperty(jsObject, keySentinel);
        const value = try jsValueToBsonValue(js, jsValue);
        keypairs[i] = bson.BSONKeyValuePair{ .key = keyStr, .value = value };
    }
    return try bson.BSONDocument.fromPairs(ally, keypairs);
}

fn jsValueToBsonValue(js: *ng.JsContext, value: napi_value) !albedo.BSONValue {
    const valueType = try js.typeOf(value);
    return switch (valueType) {
        napi.napi_number => {
            const num = try js.readNumber(f64, value);
            return albedo.BSONValue.init(num);
        },
        napi.napi_string => {
            const str = try js.readString(value);
            return albedo.BSONValue.init(str);
        },
        napi.napi_boolean => {
            const b = try js.readBoolean(value);
            return albedo.BSONValue.init(b);
        },
        napi.napi_object => {
            var is_array: bool = false;
            try ng.check(napi.napi_is_array(js.env, value, &is_array));
            if (is_array) {
                const arr_doc = try jsObjectToBsonDoc(js, value);
                return albedo.BSONValue{ .array = arr_doc };
            }

            var is_date: bool = false;
            try ng.check(napi.napi_is_date(js.env, value, &is_date));
            if (is_date) {
                var timestamp_ms: f64 = undefined;
                try ng.check(napi.napi_get_date_value(js.env, value, &timestamp_ms));
                return albedo.BSONValue{ .datetime = .{ .value = @as(u64, @intFromFloat(timestamp_ms)) } };
            }

            // If this is an ObjectId instance, encode as BSON ObjectId.
            if (objectIdConstructorRef) |ctor_ref| {
                var ctor: napi_value = undefined;
                try ng.check(napi.napi_get_reference_value(js.env, ctor_ref, &ctor));

                var is_object_id: bool = false;
                try ng.check(napi.napi_instanceof(js.env, value, ctor, &is_object_id));
                if (is_object_id) {
                    var buffer_value: napi_value = undefined;
                    try ng.check(napi.napi_get_named_property(js.env, value, "buffer", &buffer_value));

                    var raw: [12]u8 = undefined;

                    var is_buffer: bool = false;
                    try ng.check(napi.napi_is_buffer(js.env, buffer_value, &is_buffer));
                    if (is_buffer) {
                        var data_ptr: ?*anyopaque = null;
                        var length: usize = 0;
                        try ng.check(napi.napi_get_buffer_info(js.env, buffer_value, &data_ptr, &length));
                        if (data_ptr != null and length == 12) {
                            const ptr = @as([*]const u8, @ptrCast(data_ptr.?));
                            @memcpy(raw[0..12], ptr[0..12]);
                            return albedo.BSONValue{ .objectId = .{ .value = .{ .buffer = raw } } };
                        }
                    }

                    var typed_array_type: napi.napi_typedarray_type = undefined;
                    var length: usize = 0;
                    var data_ptr: ?*anyopaque = null;
                    if (napi.napi_get_typedarray_info(js.env, buffer_value, &typed_array_type, &length, &data_ptr, null, null) == napi.napi_ok) {
                        if (data_ptr != null and length == 12 and (typed_array_type == napi.napi_uint8_array or typed_array_type == napi.napi_uint8_clamped_array)) {
                            const ptr = @as([*]const u8, @ptrCast(data_ptr.?));
                            @memcpy(raw[0..12], ptr[0..12]);
                            return albedo.BSONValue{ .objectId = .{ .value = .{ .buffer = raw } } };
                        }
                    }
                }
            }

            var is_typed_array: bool = false;
            try ng.check(napi.napi_is_typedarray(js.env, value, &is_typed_array));
            if (is_typed_array) {
                var typed_array_type: napi.napi_typedarray_type = undefined;
                var length: usize = 0;
                var data_ptr: ?*anyopaque = null;
                var arraybuffer: napi_value = undefined;
                var byte_offset: usize = 0;
                try ng.check(napi.napi_get_typedarray_info(js.env, value, &typed_array_type, &length, &data_ptr, &arraybuffer, &byte_offset));

                const elem_size: usize = switch (typed_array_type) {
                    napi.napi_int8_array, napi.napi_uint8_array, napi.napi_uint8_clamped_array => 1,
                    napi.napi_int16_array, napi.napi_uint16_array => 2,
                    napi.napi_int32_array, napi.napi_uint32_array, napi.napi_float32_array => 4,
                    napi.napi_float64_array, napi.napi_bigint64_array, napi.napi_biguint64_array => 8,
                    else => return albedo.BSONValue{ .null = .{} }, // Unsupported typed array type
                };

                const byte_len = length * elem_size;
                const ptr = @as([*]const u8, @ptrCast(data_ptr.?));
                const source_bytes = ptr[0..byte_len];

                // Copy bytes to arena-allocated memory to ensure proper lifetime
                const ally = js.arena.allocator();
                const bytes = try ally.alloc(u8, byte_len);
                @memcpy(bytes, source_bytes);

                return albedo.BSONValue{ .binary = .{ .value = bytes, .subtype = 0x00 } };
            }

            const nested_doc = try jsObjectToBsonDoc(js, value);
            return albedo.BSONValue{ .document = nested_doc };
        },
        napi.napi_null => albedo.BSONValue{ .null = .{} },
        // Handle other JavaScript types as needed...
        else => albedo.BSONValue{ .null = .{} },
    };
}

// Takes a Uint8Array of BSON data and returns a JavaScript object.
pub fn deserialize(js: *ng.JsContext, uint8arr: napi_value) !napi_value {
    var typedarray_type: napi.napi_typedarray_type = undefined;
    var size: usize = undefined;
    var data_ptr: ?*anyopaque = null;
    try ng.check(napi.napi_get_typedarray_info(js.env, uint8arr, &typedarray_type, &size, &data_ptr, null, null));
    const ptr = @as([*]const u8, @ptrCast(data_ptr.?));
    const docBuffer: []const u8 = ptr[0..size];
    const doc = albedo.BSONDocument.init(docBuffer);
    return bsonDocToJsObject(js, doc);
}

fn bsonDocToJsObject(js: *ng.JsContext, doc: albedo.BSONDocument) ng.Error!napi_value {
    // Check if this is actually an array (keys are "0", "1", "2", ...)
    var pairIter = doc.iter();
    var isArray = true;
    var expectedIndex: usize = 0;
    var count: usize = 0;
    while (pairIter.next()) |pair| {
        var indexBuf: [20]u8 = undefined;
        const expectedKey = std.fmt.bufPrint(&indexBuf, "{d}", .{expectedIndex}) catch {
            isArray = false;
            break;
        };
        if (!std.mem.eql(u8, pair.key, expectedKey)) {
            isArray = false;
            break;
        }
        expectedIndex += 1;
        count += 1;
    }

    if (isArray and count > 0) {
        // Create JavaScript array
        const arr = try js.createArray();
        pairIter = doc.iter();
        var index: u32 = 0;
        while (pairIter.next()) |pair| {
            const jsValue = try bsonValueToJsValue(js, pair.value);
            try js.setElement(arr, index, jsValue);
            index += 1;
        }
        return arr;
    }

    // Create JavaScript object
    const obj = try js.createObject();
    // Iterate over the BSON document and set properties on the JavaScript object.
    pairIter = doc.iter();
    var nameBuffer = std.mem.zeroes([256]u8); // Buffer for property names, adjust size as needed
    while (pairIter.next()) |pair| {
        const jsValue = blk: {
            if (std.mem.eql(u8, pair.key, "_id")) {
                switch (pair.value) {
                    .binary => |bin| {
                        if (bin.value.len == 12) {
                            break :blk try createObjectIdInstance(js, bin.value);
                        }
                    },
                    else => {},
                }
            }
            break :blk try bsonValueToJsValue(js, pair.value);
        };
        const key: [*:0]const u8 = blk: {
            if (pair.key.len >= nameBuffer.len) {
                const ally = js.arena.allocator();
                const name = try ally.allocSentinel(u8, pair.key.len, 0);
                @memcpy(name, pair.key);
                break :blk name.ptr;
            } else {
                @memcpy(nameBuffer[0..pair.key.len], pair.key);
                nameBuffer[pair.key.len] = 0;
                break :blk @ptrCast(&nameBuffer);
            }
        };
        try js.setNamedProperty(obj, key, jsValue);
    }
    return obj;
}

fn createObjectIdInstance(js: *ng.JsContext, bytes: []const u8) ng.Error!napi_value {
    if (bytes.len != 12) return error.napi_invalid_arg;

    var buffer: napi_value = undefined;
    var array: napi_value = undefined;
    var data_ptr: ?*anyopaque = null;

    try ng.check(napi.napi_create_arraybuffer(js.env, 12, &data_ptr, &buffer));
    const newBytes = @as([*]u8, @ptrCast(data_ptr.?));
    @memcpy(newBytes[0..12], bytes[0..12]);
    try ng.check(napi.napi_create_typedarray(js.env, napi.napi_uint8_array, 12, buffer, 0, &array));

    const ctor = try getObjectIdConstructor(js);
    var argv = [_]napi_value{array};
    var objId: napi_value = undefined;
    try ng.check(napi.napi_new_instance(js.env, ctor, 1, &argv[0], &objId));
    return objId;
}

fn bsonValueToJsValue(js: *ng.JsContext, value: albedo.BSONValue) ng.Error!napi_value {
    return switch (value) {
        .double => |v| try js.createNumber(v.value),
        .int32 => |v| try js.createNumber(v.value),
        .string => try js.createString(value.string.value),
        .datetime => |v| {
            var dateObj: napi_value = undefined;
            try ng.check(napi.napi_create_date(js.env, @floatFromInt(v.value), &dateObj));
            return dateObj;
        },
        .int64 => |v| blk3: {
            var bigIntValue: napi_value = undefined;
            try ng.check(napi.napi_create_bigint_int64(js.env, v.value, &bigIntValue));
            break :blk3 bigIntValue;
        },
        .null => try js.null(),
        .boolean => |v| try js.createBoolean(v.value),
        .array => try bsonDocToJsObject(js, value.array),
        .document => try bsonDocToJsObject(js, value.document),
        .binary => |v| blk: {
            if (v.subtype == 0x07 and v.value.len == 12) {
                break :blk try createObjectIdInstance(js, v.value);
            }

            var buffer: napi_value = undefined;
            var data_ptr: ?*anyopaque = null;
            try ng.check(napi.napi_create_arraybuffer(js.env, v.value.len, &data_ptr, &buffer));
            const newBytes = @as([*]u8, @ptrCast(data_ptr.?));
            @memcpy(newBytes[0..v.value.len], v.value);
            var typedArray: napi_value = undefined;
            try ng.check(napi.napi_create_typedarray(js.env, napi.napi_uint8_array, v.value.len, buffer, 0, &typedArray));
            break :blk typedArray;
        },
        .objectId => |oid| blk2: {
            break :blk2 try createObjectIdInstance(js, oid.value.buffer[0..12]);
        },
        // Handle other BSON types as needed...
        else => try js.null(),
    };
}
