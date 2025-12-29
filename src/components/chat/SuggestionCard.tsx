import { Check, X, Plus, Minus, RefreshCw, Edit3, ChevronDown, ChevronUp } from "lucide-react";
import useUiStore from "../../store/UiStore";
import { handleAiAction } from "../../lib/editor-actions";
import toast from "react-hot-toast";
import { useState } from "react";

interface SuggestionCardProps {
    actionDataList: any[];  // Changed to accept list of actions
    status: "pending" | "approved" | "refused";
    onStatusChange: (status: "pending" | "approved" | "refused") => void;
}

// Get action metadata for styling
const getActionMeta = (action: string) => {
    switch (action) {
        case "insertCode":
        case "insertHeading":
        case "insertText":
        case "insertParagraph":
            return { icon: Plus, label: "Add", color: "green", textClass: "text-green-400" };
        case "delete":
            return { icon: Minus, label: "Delete", color: "red", textClass: "text-red-400" };
        case "update":
            return { icon: Edit3, label: "Update", color: "yellow", textClass: "text-yellow-400" };
        case "replace":
            return { icon: RefreshCw, label: "Replace", color: "blue", textClass: "text-blue-400" };
        default:
            return { icon: Plus, label: "Edit", color: "zinc", textClass: "text-zinc-400" };
    }
};

// Get preview text from action
const getPreviewText = (actionData: any): string => {
    const data = actionData.data || {};
    return data.text || data.code || data.newContent || data.searchText || "";
};

export function SuggestionCard({ actionDataList, status, onStatusChange }: SuggestionCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processedCount, setProcessedCount] = useState(0);

    const totalActions = actionDataList.length;
    const isSingleAction = totalActions === 1;

    const handleApproveAll = async () => {
        const editor = useUiStore.getState().editor;
        if (!editor) {
            toast.error("Editor not connected");
            return;
        }

        setIsProcessing(true);
        let successCount = 0;

        for (let i = 0; i < actionDataList.length; i++) {
            const actionData = actionDataList[i];
            try {
                await handleAiAction(editor, actionData);
                successCount++;
                setProcessedCount(i + 1);
            } catch (e: any) {
                console.error(`Failed action ${i + 1}:`, e);
                toast.error(`Action ${i + 1} failed: ${e.message || "Unknown error"}`);
            }
        }

        setIsProcessing(false);
        if (successCount > 0) {
            onStatusChange("approved");
            if (successCount < totalActions) {
                toast.success(`Applied ${successCount}/${totalActions} changes`);
            }
        }
    };

    if (status === "approved") {
        return (
            <div className="bg-green-950/30 border border-green-800/40 rounded-lg p-3">
                <div className="flex items-center gap-2">
                    <div className="bg-green-500/20 p-1 rounded">
                        <Check size={14} className="text-green-400" />
                    </div>
                    <span className="text-xs text-green-400 font-medium">
                        {totalActions} Change{totalActions > 1 ? "s" : ""} Applied
                    </span>
                </div>
                <div className="mt-2 space-y-1">
                    {actionDataList.slice(0, 3).map((action, i) => (
                        <p key={i} className="text-xs text-zinc-500">• {action.description}</p>
                    ))}
                    {totalActions > 3 && (
                        <p className="text-xs text-zinc-600">...and {totalActions - 3} more</p>
                    )}
                </div>
            </div>
        );
    }

    if (status === "refused") {
        return (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-2 opacity-60">
                <div className="flex items-center gap-2">
                    <div className="bg-zinc-800 p-1 rounded">
                        <X size={14} className="text-zinc-500" />
                    </div>
                    <span className="text-xs text-zinc-500 line-through">
                        {totalActions} change{totalActions > 1 ? "s" : ""} refused
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-zinc-900 border border-zinc-700/50 rounded-lg overflow-hidden shadow-lg">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900/80">
                <div className="flex items-center gap-2">
                    <div className="flex -space-x-1">
                        {actionDataList.slice(0, 3).map((action, i) => {
                            const meta = getActionMeta(action.action);
                            const Icon = meta.icon;
                            return (
                                <div key={i} className={`w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center`}>
                                    <Icon size={10} className={meta.textClass} />
                                </div>
                            );
                        })}
                    </div>
                    <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                        {totalActions} Edit{totalActions > 1 ? "s" : ""}
                    </span>
                </div>
                {!isSingleAction && (
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
                    >
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {isExpanded ? "Less" : "Details"}
                    </button>
                )}
            </div>

            {/* Action Summary */}
            <div className="px-3 py-2 border-b border-zinc-800/50 space-y-1.5">
                {actionDataList.slice(0, isExpanded ? totalActions : (isSingleAction ? 1 : 2)).map((action, i) => {
                    const meta = getActionMeta(action.action);
                    const Icon = meta.icon;
                    const preview = getPreviewText(action);

                    return (
                        <div key={i} className="flex items-start gap-2">
                            <Icon size={12} className={`${meta.textClass} mt-0.5 flex-shrink-0`} />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-zinc-300">{action.description}</p>
                                {isExpanded && preview && (
                                    <p className="text-xs text-zinc-500 font-mono truncate mt-0.5">
                                        {preview.substring(0, 60)}{preview.length > 60 ? "..." : ""}
                                    </p>
                                )}
                            </div>
                        </div>
                    );
                })}
                {!isSingleAction && !isExpanded && totalActions > 2 && (
                    <p className="text-xs text-zinc-500 pl-5">+{totalActions - 2} more changes</p>
                )}
            </div>

            {/* Processing indicator */}
            {isProcessing && (
                <div className="px-3 py-2 bg-blue-950/30 border-b border-blue-900/30">
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-blue-400">
                            Applying changes... {processedCount}/{totalActions}
                        </span>
                    </div>
                    <div className="mt-2 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-blue-500 transition-all duration-300"
                            style={{ width: `${(processedCount / totalActions) * 100}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 p-3 bg-zinc-900/50">
                <button
                    onClick={handleApproveAll}
                    disabled={isProcessing}
                    className="flex-1 bg-green-600 hover:bg-green-500 disabled:bg-green-800 disabled:cursor-not-allowed text-white text-xs font-semibold py-2.5 rounded-md transition-all shadow-md hover:shadow-lg active:scale-95 flex items-center justify-center gap-1.5"
                >
                    <Check size={14} />
                    {isSingleAction ? "Approve" : `Approve All (${totalActions})`}
                </button>
                <button
                    onClick={() => onStatusChange("refused")}
                    disabled={isProcessing}
                    className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:cursor-not-allowed text-zinc-400 hover:text-zinc-200 text-xs font-medium py-2.5 rounded-md transition-all active:scale-95 flex items-center justify-center gap-1.5"
                >
                    <X size={14} />
                    {isSingleAction ? "Refuse" : "Refuse All"}
                </button>
            </div>
        </div>
    );
}
