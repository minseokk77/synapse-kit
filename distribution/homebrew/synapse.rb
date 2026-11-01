class Synapse < Formula
  desc "AI-Native Unified Compiler, Linter & Verification Framework for Tauri and Full-Stack Apps"
  homepage "https://github.com/minseokk77/synapse-kit"
  url "https://github.com/minseokk77/synapse-kit/archive/refs/tags/v0.2.1.tar.gz"
  license "MIT"

  depends_on "oven-sh/bun/bun"

  def install
    system "bun", "install", "--frozen-lockfile"
    system "bun", "run", "build"
    bin.install "dist/cli.js" => "synapse"
  end

  test do
    assert_match "synapse-kit v0.2.1", shell_output("#{bin}/synapse --version")
  end
end
