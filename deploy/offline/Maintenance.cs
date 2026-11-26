using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

class Maintenance {
    static int Main(string[] args) {
        if (args.Length != 1 || (args[0] != "backup" && args[0] != "uninstall")) return 1;
        using (var mutex = new Mutex(false, @"Global\StoreAssistantSetup")) {
            if (!mutex.WaitOne(0)) return 1;
            try {
                var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "StoreAssistant");
                var releases = Path.Combine(root, "releases");
                var id = File.ReadAllText(Path.Combine(root, "active")).Trim();
                Guid parsed;
                if (!Guid.TryParseExact(id, "N", out parsed)) return 1;
                var release = Path.Combine(releases, id);
                var info = new ProcessStartInfo(Path.Combine(release, @"python\python.exe"), "manage.py " + args[0]);
                info.WorkingDirectory = release;
                info.UseShellExecute = false;
                using (var process = Process.Start(info)) {
                    process.WaitForExit();
                    if (args[0] == "uninstall" && process.ExitCode == 10) {
                        if ((File.GetAttributes(releases) & FileAttributes.ReparsePoint) != 0) return 1;
                        Directory.Delete(releases, true);
                        File.Delete(Path.Combine(root, "active"));
                    } else if (process.ExitCode != 0) throw new Exception("操作未完成。");
                }
                Console.WriteLine("按回车关闭。");
                Console.ReadLine();
                return 0;
            } catch (Exception error) {
                Console.Error.WriteLine(error.Message);
                Console.ReadLine();
                return 1;
            }
        }
    }
}
