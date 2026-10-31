const std = @import("std");

const Artifact = enum { ghostty, lib };


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
        const options = b.addOptions();
        options.addOption(Artifact, "artifact", .lib);
        options.addOption(bool, "oniguruma", true);
        options.addOption(bool, "simd", false);
        options.addOption(bool, "c_abi", false);
        options.addOption(bool, "slow_runtime_safety", false);
        options.addOption(bool, "kitty_graphics", true);
        options.addOption(bool, "tmux_control_mode", false);
        const ghostty_module = dep.module("ghostty-vt");
        if (b.lazyDependency("wuffs", .{
            .target = wasm_target,
            .optimize = optimize,
        })) |wuffs_c| {
            const wuffs_module = b.createModule(.{
                .root_source_file = dep.path("pkg/wuffs/src/main.zig"),
                .target = wasm_target,
                .optimize = optimize,
                .link_libc = false,
            });
            // Wuffs is a C single-header library. Its normal build assumes a
            // hosted libc, but the terminal module is deliberately
            // wasm32-freestanding. These declarations are the small C ABI
            // surface used by the generated base implementation; the Zig
            // runtime provides the symbols when the final module is linked.
            wuffs_module.addIncludePath(b.path("src/wuffs-compat"));
            wuffs_module.addIncludePath(wuffs_c.path("release/c"));
            wuffs_module.addCSourceFile(.{
                .file = wuffs_c.path("release/c/wuffs-v0.4.c"),
                .flags = &.{
                    "-DWUFFS_IMPLEMENTATION",
                    "-DWUFFS_CONFIG__MODULES",
                    "-DWUFFS_CONFIG__MODULE__AUX__BASE",
                    "-DWUFFS_CONFIG__MODULE__AUX__IMAGE",
                    "-DWUFFS_CONFIG__MODULE__BASE",
                    "-DWUFFS_CONFIG__MODULE__ADLER32",
                    "-DWUFFS_CONFIG__MODULE__CRC32",
                    "-DWUFFS_CONFIG__MODULE__DEFLATE",
                    "-DWUFFS_CONFIG__MODULE__PNG",
                    "-DWUFFS_CONFIG__MODULE__ZLIB",
                },
            });
            ghostty_module.addImport("wuffs", wuffs_module);
        }
        ghostty_module.addOptions("terminal_options", options);
        exe_mod.addImport("ghostty-vt", ghostty_module);
    }



    const exe = b.addExecutable(.{
        .name = "ghostty-vt",
        .root_module = exe_mod,
    });

    exe.rdynamic = true;
    exe.entry = .disabled;

    b.installArtifact(exe);
}
