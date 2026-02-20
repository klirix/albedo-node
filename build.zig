const std = @import("std");
const napigen = @import("napigen");
const albedo = @import("Albedo");

const targetMatrix = [_]std.Target.Query{
    .{ .cpu_arch = .x86_64, .os_tag = .linux },
    .{ .cpu_arch = .x86_64, .os_tag = .linux },
    .{ .cpu_arch = .aarch64, .os_tag = .linux, .abi = .musl },
    .{ .cpu_arch = .x86_64, .os_tag = .linux, .abi = .musl },
    // .{ .cpu_arch = .aarch64, .os_tag = .windows },
    // .{ .cpu_arch = .x86_64, .os_tag = .windows },
    .{ .cpu_arch = .aarch64, .os_tag = .macos },
    .{ .cpu_arch = .x86_64, .os_tag = .macos },
};

pub fn build(b: *std.Build) void {
    const defaultTarget = b.standardTargetOptions(.{});

    const optimize = b.standardOptimizeOption(.{});

    for (targetMatrix) |query| {
        const target = std.Build.resolveTargetQuery(b, query);

        const mod = b.addModule("albedo_node", .{
            .root_source_file = b.path("src/binding.zig"),
            .target = target,
            .optimize = optimize,
        });

        const albedoDep = b.dependencyFromBuildZig(albedo, .{});

        // mod.addImport("albedo/bson", albedoDep.module("bson"));
        mod.addImport("albedo", albedoDep.module("albedo"));

        const binding_lib = b.addLibrary(.{
            .linkage = .dynamic,
            .name = "albedo_node_binding",
            .root_module = mod,
        });

        const os_string = @tagName(target.result.os.tag);
        const arch_string = @tagName(target.result.cpu.arch);

        binding_lib.out_filename = if (query.abi != null) b.fmt("albedo.{s}_{s}_{s}.node", .{
            arch_string,
            os_string,
            @tagName(query.abi.?),
        }) else b.fmt("albedo.{s}_{s}.node", .{
            arch_string,
            os_string,
        });

        napigen.setup(binding_lib);

        const binding_art = b.addInstallArtifact(binding_lib, .{
            .dest_dir = .{
                .override = .{ .custom = "../native" },
            },
        });
        b.getInstallStep().dependOn(&binding_art.step);
    }

    const test_mod = b.addModule("albedo_node", .{
        .root_source_file = b.path("src/binding.zig"),
        .target = defaultTarget,
        .optimize = optimize,
    });

    b.dest_dir = ".";

    const mod_tests = b.addTest(.{
        .root_module = test_mod,
    });

    const run_mod_tests = b.addRunArtifact(mod_tests);

    const test_step = b.step("test", "Run tests");
    test_step.dependOn(&run_mod_tests.step);
}
