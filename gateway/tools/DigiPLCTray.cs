using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using System.IO;

namespace DigiPLCTray
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new TrayApplicationContext());
        }
    }

    public class TrayApplicationContext : ApplicationContext
    {
        private NotifyIcon trayIcon;
        private Process gatewayProcess;

        public TrayApplicationContext()
        {
            // Initialize Tray Icon
            trayIcon = new NotifyIcon()
            {
                Icon = SystemIcons.Application,
                ContextMenu = new ContextMenu(new MenuItem[] {
                    new MenuItem("Open HMI", OpenHMI),
                    new MenuItem("-"),
                    new MenuItem("Exit", Exit)
                }),
                Visible = true,
                Text = "Digi-PLC Gateway"
            };

            trayIcon.DoubleClick += OpenHMI;

            StartGateway();
            
            // Automatically open browser on first launch
            OpenHMI(null, null);
        }

        private void StartGateway()
        {
            try
            {
                string exePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "gateway-win.exe");
                
                if (!File.Exists(exePath))
                {
                    MessageBox.Show("Could not find gateway-win.exe in the application folder.", "Digi-PLC Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                gatewayProcess = new Process();
                gatewayProcess.StartInfo.FileName = exePath;
                gatewayProcess.StartInfo.UseShellExecute = false;
                gatewayProcess.StartInfo.CreateNoWindow = true; // Hidden!
                
                gatewayProcess.Start();
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to start gateway service: " + ex.Message, "Digi-PLC Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void OpenHMI(object sender, EventArgs e)
        {
            try
            {
                Process.Start(new ProcessStartInfo("http://localhost:3001") { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to open browser: " + ex.Message);
            }
        }

        private void Exit(object sender, EventArgs e)
        {
            // Hide tray icon, otherwise it remains until you hover over it
            trayIcon.Visible = false;

            // Kill gateway process
            if (gatewayProcess != null && !gatewayProcess.HasExited)
            {
                try
                {
                    gatewayProcess.Kill();
                    gatewayProcess.WaitForExit(2000);
                }
                catch { }
            }

            Application.Exit();
        }
    }
}
