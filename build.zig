const std = @import("std");
const napigen = @import("napigen");
const albedo = @import("Albedo");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});

    const optimize = b.standardOptimizeOption(.{});

    const mod = b.addModule("albedo_node", .{
        .root_source_file = b.path("src/binding.zig"),
        .target = target,
        .optimize = optimize,
    });

    const albedoDep = b.dependencyFromBuildZig(albedo, .{});

    // mod.addImport("albedo/bson", albedoDep.module("bson"));
    mod.addImport("albedo", albedoDep.module("albedo"));

    const mod_tests = b.addTest(.{
        .root_module = mod,
    });

    const binding_lib = b.addLibrary(.{
        .linkage = .dynamic,
        .name = "albedo_node_binding",
        .root_module = mod,
    });

    const os_string = @tagName(target.result.os.tag);
    const arch_string = @tagName(target.result.cpu.arch);
    binding_lib.out_filename = b.fmt("albedo.{s}_{s}.node", .{ arch_string, os_string });

    napigen.setup(binding_lib);

    const binding_art = b.addInstallArtifact(binding_lib, .{
        .dest_dir = .{
            .override = .{ .custom = "../native" },
        },
    });

    b.dest_dir = ".";

    const run_mod_tests = b.addRunArtifact(mod_tests);

    const test_step = b.step("test", "Run tests");
    test_step.dependOn(&run_mod_tests.step);

    b.getInstallStep().dependOn(&binding_art.step);
}
