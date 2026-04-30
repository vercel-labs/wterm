const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});

    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });

    const exe_mod = b.createModule(.{
        .root_source_file = b.path("src/wasm_api.zig"),
        .target = wasm_target,
        .optimize = optimize,
    });

    if (b.lazyDependency("ghostty", .{
        .target = wasm_target,
        .simd = false,
    })) |dep| {
        exe_mod.addImport("ghostty-vt", dep.module("ghostty-vt"));
    }

    const exe = b.addExecutable(.{
        .name = "ghostty-vt",
        .root_module = exe_mod,
    });

    exe.rdynamic = true;
    exe.entry = .disabled;

    b.installArtifact(exe);
}
