import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Download,
  Terminal,
  Settings2,
  Cpu,
  ExternalLink
} from "lucide-react";
import { clsx } from "clsx";

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
  const [visible, setVisible] = useState(false); // Default hidden
  const [installError, setInstallError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const checkNeedsAttention = (res: PreflightResult | null) => {
    if (!res) return false;
    return !res.python_found ||
      !res.ffmpeg_available ||
      (typeof res.vcruntime_found !== 'undefined' && !res.vcruntime_found) ||
      (typeof res.network_ok !== 'undefined' && !res.network_ok) ||
      (typeof res.windows_helper_present !== 'undefined' && !res.windows_helper_present);
  };

  const runCheck = async () => {
    setLoading(true);
    try {
      const res = await invoke("prereflight_check") as PreflightResult;
      setResult(res);

      // Only show if there are issues
      if (checkNeedsAttention(res)) {
        setVisible(true);
      }
    } catch (e) {
      console.error("prereflight_check failed", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runCheck();
  }, []);

  const needsAttention = () => checkNeedsAttention(result);

  const handleInstall = async () => {
    setInstalling(true);
    setInstallError(null);
    try {
      await invoke("install_transcription_dependencies");
      // re-run prereflight
      await runCheck();
    } catch (e: any) {
      setInstallError(String(e));
    } finally {
      setInstalling(false);
    }
  };

  if (!visible) return null;

  const StatusRow = ({
    icon: Icon,
    label,
    status,
    detail
  }: {
    icon: any,
    label: string,
    status: 'ok' | 'error' | 'warning',
    detail?: string
  }) => (
    <div className="flex items-center justify-between p-3 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
      <div className="flex items-center gap-3">
        <div className={clsx("p-2 rounded-md bg-zinc-800", {
          "text-green-400": status === 'ok',
          "text-red-400": status === 'error',
          "text-yellow-400": status === 'warning'
        })}>
          <Icon size={18} />
        </div>
        <div>
          <div className="font-medium text-zinc-200 text-sm">{label}</div>
          {detail && <div className="text-xs text-zinc-500">{detail}</div>}
        </div>
      </div>

      <div>
        {status === 'ok' && <CheckCircle2 className="text-green-500" size={20} />}
        {status === 'error' && <XCircle className="text-red-500" size={20} />}
        {status === 'warning' && <AlertTriangle className="text-yellow-500" size={20} />}
      </div>
    </div>
  );

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => !needsAttention() && setVisible(false)}
        />

        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          className="relative bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-6 border-b border-zinc-800 bg-zinc-900/50">
            <div className="flex items-center gap-3 mb-1">
              <Settings2 className="text-indigo-400" size={24} />
              <h2 className="text-xl font-bold text-white">System Check</h2>
            </div>
            <p className="text-zinc-400 text-sm">Verifying environment dependencies</p>
          </div>

          <div className="p-6 overflow-y-auto custom-scrollbar">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <Loader2 className="animate-spin text-indigo-500" size={32} />
                <p className="text-zinc-500 text-sm">Scanning system...</p>
              </div>
            ) : result ? (
              <div className="space-y-4">
                {/* Platform Info */}
                <div className="flex items-center justify-between text-xs text-zinc-500 px-1 mb-2">
                  <span>OS: {result.platform}</span>
                  <span className={clsx(result.network_ok ? "text-green-500" : "text-red-500")}>
                    Network: {result.network_ok ? "Online" : "Offline"}
                  </span>
                </div>

                {/* Checks */}
                <div className="space-y-2">
                  <StatusRow
                    icon={Terminal}
                    label="Python Environment"
                    status={result.python_found ? 'ok' : 'error'}
                    detail={result.python_found ? `Version ${result.python_version || "Detected"}` : "Required for AI"}
                  />

                  <StatusRow
                    icon={Cpu}
                    label="FFmpeg Framework"
                    status={result.ffmpeg_available ? 'ok' : 'error'}
                    detail={result.ffmpeg_available ? "Installed" : "Required for Audio Processing"}
                  />

                  {typeof result.vcruntime_found !== 'undefined' && (
                    <StatusRow
                      icon={Settings2}
                      label="Visual C++ Runtime"
                      status={result.vcruntime_found ? 'ok' : 'error'}
                      detail={result.vcruntime_found ? "Installed" : "Required for Native Modules"}
                    />
                  )}

                  {typeof result.windows_helper_present !== 'undefined' && (
                    <StatusRow
                      icon={Cpu}
                      label="Audio Helper Binary"
                      status={result.windows_helper_present ? 'ok' : 'error'}
                      detail={result.windows_helper_present ? "Ready" : "Missing application resource"}
                    />
                  )}
                </div>

                {/* Status Message */}
                <div className={clsx("mt-6 p-4 rounded-lg border", {
                  "bg-green-500/10 border-green-500/20": !needsAttention(),
                  "bg-amber-500/10 border-amber-500/20": needsAttention()
                })}>
                  {!needsAttention() ? (
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="text-green-500 shrink-0" size={24} />
                      <div>
                        <h4 className="font-medium text-green-400">All Systems Go</h4>
                        <p className="text-sm text-green-500/80">Your environment is ready for transcription.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={24} />
                      <div>
                        <h4 className="font-medium text-amber-400">Missing Dependencies</h4>
                        <p className="text-sm text-amber-500/80 mt-1">
                          Some components are missing.
                          {typeof result.vcruntime_found !== 'undefined' && !result.vcruntime_found
                            ? " Windows requires Visual C++ Runtime."
                            : " Please install them to continue."}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Manual Steps (Collapsible) */}
                {needsAttention() && (
                  <button
                    onClick={() => setDetailsOpen(!detailsOpen)}
                    className="text-xs text-zinc-500 hover:text-zinc-300 w-full text-center mt-2 underline"
                  >
                    {detailsOpen ? "Hide Manual Instructions" : "Show Manual Instructions"}
                  </button>
                )}

                {detailsOpen && needsAttention() && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    className="bg-zinc-900 rounded-lg p-4 text-sm text-zinc-400 border border-zinc-800"
                  >
                    <ul className="list-disc ml-4 space-y-1">
                      {!result.python_found && (
                        <li>Install <b>Python 3.12+</b> from python.org (Ensure 'Add to PATH' is checked)</li>
                      )}
                      {!result.ffmpeg_available && (
                        <li>Install <b>FFmpeg</b> and add to system PATH</li>
                      )}
                      {typeof result.vcruntime_found !== 'undefined' && !result.vcruntime_found && (
                        <li>
                          Install <a href="https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist" target="_blank" className="text-indigo-400 hover:underline inline-flex items-center gap-1">
                            Visual C++ Redistributable <ExternalLink size={10} />
                          </a>
                        </li>
                      )}
                    </ul>
                  </motion.div>
                )}

                {installError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md text-red-400 text-sm">
                    <strong>Error:</strong> {installError}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-red-400">
                Failed to load system checks.
                <button onClick={runCheck} className="block mx-auto mt-4 text-indigo-400 hover:underline">Retry</button>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="p-6 border-t border-zinc-800 bg-zinc-900/30 flex justify-end gap-3">
            {needsAttention() ? (
              <>
                <button
                  onClick={() => setVisible(false)}
                  className="px-4 py-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors text-sm font-medium"
                  disabled={installing}
                >
                  Ignore
                </button>
                <button
                  onClick={handleInstall}
                  disabled={installing}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {installing ? (
                    <>
                      <Loader2 className="animate-spin" size={16} />
                      Installing...
                    </>
                  ) : (
                    <>
                      <Download size={16} />
                      Attempt Auto-Install
                    </>
                  )}
                </button>
              </>
            ) : (
              <button
                onClick={() => setVisible(false)}
                className="px-6 py-2 rounded-lg bg-zinc-100 hover:bg-white text-zinc-900 font-medium transition-colors shadow-lg shadow-white/5"
              >
                Close
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
