using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;

class Setup {
    static int Main() {
        using (var mutex = new Mutex(false, @"Global\StoreAssistantSetup")) {
            if (!mutex.WaitOne(0)) return 1;
            try {
                var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "StoreAssistant");
                var release = Path.Combine(root, "releases", Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(release);
                Console.WriteLine("正在解压门店助手离线组件……");
                using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("runtime.zip"))
                using (var zip = new ZipArchive(stream, ZipArchiveMode.Read)) zip.ExtractToDirectory(release);
                var info = new ProcessStartInfo(Path.Combine(release, @"python\python.exe"), "manage.py install");
                info.WorkingDirectory = release;
                info.UseShellExecute = false;
                using (var process = Process.Start(info)) {
                    process.WaitForExit();
                    if (process.ExitCode != 0) throw new Exception("安装未完成，请查看上方提示。");
                }
                return 0;
            } catch (Exception error) {
                Console.Error.WriteLine(error.Message);
                Console.ReadLine();
                return 1;
            }
        }
    }
}
