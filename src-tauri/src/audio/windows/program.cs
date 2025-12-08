using NAudio.Wave;
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static Process? whisperProcess;

    static void Main(string[] args)
    {
        string outputFile = "output.wav";

        // Parse command-line arguments
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--output" && i + 1 < args.Length)
                outputFile = args[i + 1];
        }

        Console.WriteLine($"Starting audio capture, saving to {outputFile} (send 'stop' to stdin to stop)...");

        try
        {
            var cancellationTokenSource = new CancellationTokenSource();

            // Start capture in a separate task
            var captureTask = Task.Run(() => StartCapture(outputFile, cancellationTokenSource.Token));

            // Read from stdin for stop command
            while (!cancellationTokenSource.IsCancellationRequested)
            {
                string? input = Console.ReadLine();
                if (input != null && input.Trim().ToLower() == "stop")
                {
                    Console.WriteLine("Received stop signal, stopping recording...");
                    cancellationTokenSource.Cancel();
                    break;
                }
            }

            // Wait for capture to finish
            captureTask.Wait();
            Console.WriteLine($"Recording stopped. Saved to {outputFile}");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            Console.Error.WriteLine($"StackTrace: {ex.StackTrace}");
            Environment.Exit(1);
        }
    }

    static void StartCapture(string outputFile, CancellationToken token)
    {
        try
        {
            using (var capture = new WasapiLoopbackCapture())
            using (var writer = new WaveFileWriter(outputFile, capture.WaveFormat))
            {
                capture.DataAvailable += (s, e) =>
                {
                    writer.Write(e.Buffer, 0, e.BytesRecorded);
                };

                capture.StartRecording();
                token.WaitHandle.WaitOne();
                capture.StopRecording();
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Capture error: {ex.Message}");
            throw;
        }
    }

    static void EnsurePythonVenv(string venvDir, string requirements)
    {
        if (!Directory.Exists(venvDir))
        {
            Console.WriteLine("Creating Python venv...");
            // Prefer the py launcher on Windows, fallback to python.exe
            try
            {
                RunCmd("py", $"-3 -m venv \"{venvDir}\"");
            }
            catch
            {
                RunCmd("python", $"-m venv \"{venvDir}\"");
            }
        }

        string pythonExe = Path.Combine(venvDir, "Scripts", "python.exe");
        if (!File.Exists(pythonExe))
        {
            throw new Exception("Python venv not created correctly.");
        }

        Console.WriteLine("Upgrading pip/setuptools/wheel and installing build helpers (cython, imageio-ffmpeg)...");
        // Upgrade pip, setuptools, wheel and install helpers to reduce likelihood of source builds
        RunCmd(pythonExe, $"-m pip install --upgrade pip setuptools wheel cython imageio-ffmpeg");

        Console.WriteLine("Installing Python dependencies (prefer binary wheels)...");
        // Use --prefer-binary to prefer prebuilt wheels and avoid compiling C extensions like 'av'
        RunCmd(pythonExe, $"-m pip install --prefer-binary -r \"{requirements}\"");
    }

    static string RunTranscription(string pythonExe, string script, string wavFile)
    {
        string transcriptFile = $"transcript_{DateTime.Now:yyyyMMdd_HHmmss}.txt";
        var psi = new ProcessStartInfo
        {
            FileName = pythonExe,
            Arguments = $"\"{script}\" \"{wavFile}\"", // Only pass audio file path, script outputs JSON to stdout
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = Path.GetDirectoryName(script) // Set working directory to script location
        };

        using (var process = new Process { StartInfo = psi })
        {
            var outputBuilder = new System.Text.StringBuilder();
            var errorBuilder = new System.Text.StringBuilder();

            using (var outputWaitHandle = new AutoResetEvent(false))
            using (var errorWaitHandle = new AutoResetEvent(false))
            {
                process.OutputDataReceived += (sender, e) => {
                    if (e.Data == null)
                    {
                        outputWaitHandle.Set();
                    }
                    else
                    {
                        outputBuilder.AppendLine(e.Data);
                    }
                };
                process.ErrorDataReceived += (sender, e) => {
                    if (e.Data == null)
                    {
                        errorWaitHandle.Set();
                    }
                    else
                    {
                        errorBuilder.AppendLine(e.Data);
                    }
                };

                process.Start();

                process.BeginOutputReadLine();
                process.BeginErrorReadLine();

                if (process.WaitForExit(600000) &&
                    outputWaitHandle.WaitOne(600000) &&
                    errorWaitHandle.WaitOne(600000))
                {
                    if (process.ExitCode != 0)
                    {
                        throw new Exception($"Transcription failed with exit code {process.ExitCode}:\n{errorBuilder.ToString()}");
                    }

                    // Parse JSON output from Python script
                    string jsonOutput = outputBuilder.ToString();
                    try
                    {
                        var result = System.Text.Json.JsonSerializer.Deserialize<TranscriptionResult>(jsonOutput);
                        File.WriteAllText(transcriptFile, result?.text ?? string.Empty);
                        Console.WriteLine($"Transcription completed. Language: {result?.language ?? "unknown"} ({(result?.language_probability).GetValueOrDefault():P2})");
                    }
                    catch (Exception ex)
                    {
                        // If JSON parsing fails, check if it's an error message
                        try
                        {
                            var error = System.Text.Json.JsonSerializer.Deserialize<TranscriptionError>(jsonOutput);
                            throw new Exception($"Transcription error: {error?.error ?? "unknown"}");
                        }
                        catch
                        {
                            // If neither works, save raw output
                            File.WriteAllText(transcriptFile, jsonOutput);
                            Console.WriteLine($"Warning: Could not parse JSON output: {ex.Message}");
                        }
                    }
                }
                else
                {
                    throw new Exception("Transcription process timed out or failed to complete.");
                }
            }
        }
        return transcriptFile;
    }

    // Classes to match the Python script's JSON output format
    class TranscriptionSegment
    {
        public string? text { get; set; }
        public double start { get; set; }
        public double end { get; set; }
    }

    class TranscriptionResult
    {
        public string? text { get; set; }
        public string? language { get; set; }
        public double language_probability { get; set; }
        public TranscriptionSegment[]? segments { get; set; }
    }

    class TranscriptionError
    {
        public string? error { get; set; }
    }

    static void RunCmd(string exe, string args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = exe,
            Arguments = args,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        
        using (var process = new Process { StartInfo = psi })
        {
            var errorBuilder = new System.Text.StringBuilder();

            // We only capture stderr for RunCmd as stdout is not typically used for status
            process.ErrorDataReceived += (sender, e) => {
                if (e.Data != null)
                {
                    errorBuilder.AppendLine(e.Data);
                }
            };

            process.Start();
            
            // We don't need to read stdout for pip/venv commands, but we must drain the buffer
            process.StandardOutput.ReadToEnd(); 
            process.BeginErrorReadLine();
            
            process.WaitForExit();

            if (process.ExitCode != 0)
            {
                throw new Exception($"Command failed: {exe} {args}\n{errorBuilder.ToString()}");
            }
        }
    }
}
