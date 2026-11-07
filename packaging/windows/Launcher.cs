// Inkacre.exe: starts Inkacre in the background (or finds it running) and opens it in the browser, through the
// Node runtime beside it (runtime\node.exe app\bin\cli.mjs app). Built by scripts/package.mjs with the C# compiler
// that ships with Windows (.NET Framework 4): csc /target:winexe /win32icon:inkacre.ico /out:Inkacre.exe Launcher.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class Launcher {
  [STAThread]
  static int Main() {
    string here = AppDomain.CurrentDomain.BaseDirectory;
    string node = Path.Combine(here, "runtime", "node.exe");
    string cli = Path.Combine(here, "app", "bin", "cli.mjs");
    if (!File.Exists(node) || !File.Exists(cli)) {
      MessageBox.Show("Inkacre is incomplete: runtime\\node.exe or app\\bin\\cli.mjs is missing. Unzip the whole download again.", "Inkacre", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return 1;
    }
    var start = new ProcessStartInfo(node, "--disable-warning=ExperimentalWarning \"" + cli + "\" app") {
      UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = here,
    };
    try {
      using (var process = Process.Start(start)) { process.WaitForExit(); return process.ExitCode; }
    } catch (Exception error) {
      MessageBox.Show("Inkacre could not start: " + error.Message, "Inkacre", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return 1;
    }
  }
}
