import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type PreflightResult = {
  platform?: string;
  python_found?: boolean;
  python_version?: string | null;
  python_executable?: string | null;
  ffmpeg_available?: boolean;
  vcruntime_found?: boolean;
  windows_helper_present?: boolean;
  windows_helper_path?: string | null;
  network_ok?: boolean;
};

export default function PreflightModal() {
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [visible, setVisible] = useState(true);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await invoke("prereflight_check");
        // res will be an object with keys we expect
        setResult(res as unknown as PreflightResult);
      } catch (e) {
        console.error("prereflight_check failed", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (!visible) return null;

  const needsAttention = () => {
    if (!result) return false;
    return !result.python_found || !result.ffmpeg_available || (typeof result.vcruntime_found !== 'undefined' && !result.vcruntime_found) || (typeof result.network_ok !== 'undefined' && !result.network_ok) || (typeof result.windows_helper_present !== 'undefined' && !result.windows_helper_present);
  };

  const handleInstall = async () => {
    setInstalling(true);
    setInstallError(null);
    try {
      await invoke("install_transcription_dependencies");
      // re-run prereflight
      const res = await invoke("prereflight_check");
      setResult(res as unknown as PreflightResult);
    } catch (e: any) {
      setInstallError(String(e));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
      <div className="bg-zinc-900 text-white rounded-lg max-w-lg w-full p-6 mx-4">
        <h2 className="text-xl font-semibold mb-3">Setup check</h2>
        {loading && <div>Checking system requirements...</div>}
        {!loading && result && (
          <div>
            <div className="space-y-2 mb-4">
              <div>Platform: {result.platform}</div>
              <div>Python: {result.python_found ? `Found (${result.python_version ?? "unknown"})` : "Missing"}</div>
              <div>FFmpeg: {result.ffmpeg_available ? "Available" : "Missing"}</div>
              {typeof result.vcruntime_found !== 'undefined' && <div>Visual C++ runtime: {result.vcruntime_found ? "Found" : "Missing"}</div>}
              {typeof result.windows_helper_present !== 'undefined' && <div>Windows helper: {result.windows_helper_present ? `Present (${result.windows_helper_path})` : "Missing"}</div>}
              <div>Network to pypi.org: {result.network_ok ? "OK" : "Unavailable"}</div>
            </div>

            {!needsAttention() && (
              <div className="text-green-400 mb-4">All required components appear available. You can continue.</div>
            )}

            {needsAttention() && (
              <div className="mb-4">
                <div className="text-yellow-300 mb-2">Some dependencies are missing or may prevent transcription from working.</div>
                <div className="text-sm text-zinc-300 mb-3">Click "Install" to attempt installing Python dependencies (this will create a venv and run pip). This does not install system packages like FFmpeg or Visual C++ redistributable.</div>
                <div className="flex gap-2">
                  <button
                    className="px-4 py-2 bg-indigo-600 rounded disabled:opacity-50"
                    onClick={handleInstall}
                    disabled={installing}
                  >
                    {installing ? "Installing..." : "Install"}
                  </button>
                  <button
                    className="px-4 py-2 bg-zinc-700 rounded"
                    onClick={() => setVisible(false)}
                    disabled={installing}
                  >
                    Dismiss
                  </button>
                </div>
                {installError && <div className="mt-3 text-red-400">Error: {installError}</div>}

                <div className="mt-4 text-sm text-zinc-300">
                  Manual steps:
                  <ul className="list-disc ml-5 mt-2">
                    <li>Install Python 3.12+ (Windows: install from python.org and ensure 'py' launcher or 'python' on PATH).</li>
                    <li>Install FFmpeg and add to PATH.</li>
                    <li>On Windows install Microsoft Visual C++ Redistributable (vcruntime).</li>
                  </ul>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button className="px-4 py-2 bg-zinc-700 rounded" onClick={() => setVisible(false)}>Close</button>
            </div>
          </div>
        )}

        {!loading && !result && (
          <div>
            <div className="text-red-400 mb-3">Could not run preflight check.</div>
            <div className="flex justify-end"><button className="px-4 py-2 bg-zinc-700 rounded" onClick={() => setVisible(false)}>Close</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
