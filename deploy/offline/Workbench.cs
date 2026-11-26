using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;

class Workbench : ServiceBase {
    Process server;
    volatile bool stopping;
    protected override void OnStart(string[] args) {
        var release = AppDomain.CurrentDomain.BaseDirectory;
        var data = Path.Combine(Directory.GetParent(release.TrimEnd('\\')).Parent.FullName, "data");
        var info = new ProcessStartInfo(Path.Combine(release, @"python\python.exe"),
            "-m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log --no-proxy-headers");
        info.WorkingDirectory = release;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.EnvironmentVariables["APP_CONFIG_FILE"] = Path.Combine(data, "store.json");
        server = Process.Start(info);
        server.Exited += delegate { if (!stopping) Environment.Exit(1); };
        server.EnableRaisingEvents = true;
    }
    protected override void OnStop() {
        stopping = true;
        if (!server.HasExited) { server.Kill(); server.WaitForExit(); }
        server.Dispose();
    }
    static void Main() { ServiceBase.Run(new Workbench { ServiceName = "StoreAssistantWeb" }); }
}
