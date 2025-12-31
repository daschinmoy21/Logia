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
  ExternalLink,
  ChevronDown,
  Shield,
  Wifi,
  WifiOff
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
  const [visible, setVisible] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const checkNeedsAttention = (res: PreflightResult | null) => {
    if (!res) return false;
    return !res.python_found ||
      (res.platform === 'linux' && !res.ffmpeg_available) ||
      (typeof res.vcruntime_found !== 'undefined' && !res.vcruntime_found) ||
      (typeof res.network_ok !== 'undefined' && !res.network_ok) ||
      (typeof res.windows_helper_present !== 'undefined' && !res.windows_helper_present);
  };

  const runCheck = async () => {
    setLoading(true);
    try {
      const res = await invoke("prereflight_check") as PreflightResult;
      setResult(res);

      const dismissed = localStorage.getItem('kortex_preflight_dismissed') === 'true';
      if (checkNeedsAttention(res) && !dismissed) {
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
    <div className="group flex items-center justify-between p-3 rounded-md hover:bg-zinc-800/50 transition-colors">
      <div className="flex items-center gap-3">
        <div className={clsx("p-1.5 rounded-md", {
          "bg-emerald-500/10 text-emerald-400": status === 'ok',
          "bg-red-500/10 text-red-400": status === 'error',
          "bg-amber-500/10 text-amber-400": status === 'warning'
        })}>
          <Icon size={16} strokeWidth={2} />
        </div>
        <div>
          <div className="font-medium text-zinc-200 text-sm">{label}</div>
          {detail && <div className="text-xs text-zinc-500">{detail}</div>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {status === 'ok' && (
          <span className="text-xs text-emerald-400 font-medium px-2 py-0.5 bg-emerald-500/10 rounded-full">Ready</span>
        )}
        {status === 'error' && (
          <span className="text-xs text-red-400 font-medium px-2 py-0.5 bg-red-500/10 rounded-full">Missing</span>
        )}
        {status === 'warning' && (
          <span className="text-xs text-amber-400 font-medium px-2 py-0.5 bg-amber-500/10 rounded-full">Warning</span>
        )}
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
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={() => !needsAttention() && setVisible(false)}
        />

        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[85vh]"
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Shield className="text-blue-400" size={20} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-zinc-100">System Check</h2>
                <p className="text-zinc-500 text-xs">Verifying environment dependencies</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="relative">
                  <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full"></div>
                  <Loader2 className="relative animate-spin text-blue-400" size={28} />
                </div>
                <p className="text-zinc-500 text-sm">Scanning system...</p>
              </div>
            ) : result ? (
              <div className="p-4 space-y-4">
                {/* Platform Badge */}
                <div className="flex items-center justify-between text-xs px-1">
                  <span className="text-zinc-600 uppercase tracking-wide font-medium">
                    Platform: <span className="text-zinc-400">{result.platform}</span>
                  </span>
                  <span className={clsx("flex items-center gap-1.5 font-medium", {
                    "text-emerald-400": result.network_ok,
                    "text-red-400": !result.network_ok
                  })}>
                    {result.network_ok ? <Wifi size={12} /> : <WifiOff size={12} />}
                    {result.network_ok ? "Online" : "Offline"}
                  </span>
                </div>

                {/* Checks */}
                <div className="bg-zinc-800/30 rounded-lg border border-zinc-800/50 divide-y divide-zinc-800/50">
                  <StatusRow
                    icon={Terminal}
                    label="Python Environment"
                    status={result.python_found ? 'ok' : 'error'}
                    detail={result.python_found ? `v${result.python_version || "Detected"}` : "Required for AI"}
                  />

                  {result.platform === 'linux' && (
                    <StatusRow
                      icon={Cpu}
                      label="FFmpeg Framework"
                      status={result.ffmpeg_available ? 'ok' : 'error'}
                      detail={result.ffmpeg_available ? "Installed" : "Required for Audio"}
                    />
                  )}

                  {typeof result.vcruntime_found !== 'undefined' && (
                    <StatusRow
                      icon={Settings2}
                      label="Visual C++ Runtime"
                      status={result.vcruntime_found ? 'ok' : 'error'}
                      detail={result.vcruntime_found ? "Installed" : "Required"}
                    />
                  )}

                  {typeof result.windows_helper_present !== 'undefined' && (
                    <StatusRow
                      icon={Cpu}
                      label="Audio Helper"
                      status={result.windows_helper_present ? 'ok' : 'error'}
                      detail={result.windows_helper_present ? "Ready" : "Missing"}
                    />
                  )}
                </div>

                {/* Status Message */}
                <div className={clsx("p-3 rounded-lg border", {
                  "bg-emerald-500/5 border-emerald-500/20": !needsAttention(),
                  "bg-amber-500/5 border-amber-500/20": needsAttention()
                })}>
                  {!needsAttention() ? (
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="text-emerald-400 shrink-0" size={18} />
                      <div>
                        <h4 className="font-medium text-emerald-400 text-sm">All Systems Go</h4>
                        <p className="text-xs text-zinc-500 mt-0.5">Your environment is ready for transcription.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="text-amber-400 shrink-0 mt-0.5" size={18} />
                      <div>
                        <h4 className="font-medium text-amber-400 text-sm">Missing Dependencies</h4>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          Some components need to be installed.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Collapsible Manual Steps */}
                {needsAttention() && (
                  <div>
                    <button
                      onClick={() => setDetailsOpen(!detailsOpen)}
                      className="flex items-center justify-between w-full text-xs text-zinc-500 hover:text-zinc-300 py-2 transition-colors"
                    >
                      <span>Manual Installation Steps</span>
                      <ChevronDown size={14} className={clsx("transition-transform", { "rotate-180": detailsOpen })} />
                    </button>

                    <AnimatePresence>
                      {detailsOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="bg-zinc-800/50 rounded-lg p-3 text-sm text-zinc-400 border border-zinc-700/50">
                            <ul className="space-y-2">
                              {!result.python_found && (
                                <li className="flex items-start gap-2">
                                  <span className="text-zinc-600 mt-1">•</span>
                                  <span>Install <b className="text-zinc-300">Python 3.12+</b> from python.org</span>
                                </li>
                              )}
                              {result.platform === 'linux' && !result.ffmpeg_available && (
                                <li className="flex items-start gap-2">
                                  <span className="text-zinc-600 mt-1">•</span>
                                  <span>Install <b className="text-zinc-300">FFmpeg</b> via package manager</span>
                                </li>
                              )}
                              {typeof result.vcruntime_found !== 'undefined' && !result.vcruntime_found && (
                                <li className="flex items-start gap-2">
                                  <span className="text-zinc-600 mt-1">•</span>
                                  <span>
                                    Install{" "}
                                    <a
                                      href="https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist"
                                      target="_blank"
                                      className="text-blue-400 hover:underline inline-flex items-center gap-1"
                                    >
                                      VC++ Redistributable <ExternalLink size={10} />
                                    </a>
                                  </span>
                                </li>
                              )}
                            </ul>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {installError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
                    <strong>Error:</strong> {installError}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12 text-red-400">
                <XCircle size={24} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">Failed to load system checks.</p>
                <button onClick={runCheck} className="mt-3 text-blue-400 hover:underline text-sm">Retry</button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-900/50 flex justify-end gap-2">
            {needsAttention() ? (
              <>
                <button
                  onClick={() => setVisible(false)}
                  className="px-3 py-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors text-sm font-medium"
                  disabled={installing}
                >
                  Ignore
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem('kortex_preflight_dismissed', 'true');
                    setVisible(false);
                  }}
                  className="px-3 py-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors text-sm font-medium"
                >
                  Don't Show Again
                </button>
                <button
                  onClick={handleInstall}
                  disabled={installing}
                  className="px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-all flex items-center gap-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {installing ? (
                    <>
                      <Loader2 className="animate-spin" size={14} />
                      Installing...
                    </>
                  ) : (
                    <>
                      <Download size={14} />
                      Auto-Install
                    </>
                  )}
                </button>
              </>
            ) : (
              <button
                onClick={() => setVisible(false)}
                className="px-4 py-1.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-900 font-medium transition-colors text-sm"
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
