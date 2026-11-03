import { Check, X, Plus, Minus, RefreshCw, Edit3, ChevronDown, ChevronUp, Table, List } from "lucide-react";
import type { EditorAction } from "../../lib/editor-actions";
import { useState } from "react";

interface SuggestionCardProps {
    actionDataList: EditorAction[];
    status: "pending" | "approved" | "refused";
    appliedCount: number;
    isProcessing: boolean;
    error?: string;
    onApprove: () => void;
    onRefuse: () => void;
}

// Get action metadata for styling
const getActionMeta = (action: string) => {
    switch (action) {
        case "insertCode":
        case "insertHeading":
        case "insertText":
        case "insertParagraph":
            return { icon: Plus, label: "Add", color: "green", textClass: "text-green-400" };
        case "insertTable":
            return { icon: Table, label: "Add Table", color: "green", textClass: "text-green-400" };
        case "insertList":
            return { icon: List, label: "Add List", color: "green", textClass: "text-green-400" };
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

export function SuggestionCard({ actionDataList, status, appliedCount, isProcessing, error, onApprove, onRefuse }: SuggestionCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const totalActions = actionDataList.length;
    const isSingleAction = totalActions === 1;

    if (status === "approved") {
        return (
            <div className="rounded-lg border border-zinc-800 bg-zinc-925 p-2.5">
                <div className="flex items-center gap-2">
                    <Check size={13} className="text-emerald-400" />
                    <span className="text-xs font-medium text-zinc-200">
                        {totalActions} Change{totalActions > 1 ? "s" : ""} Applied
                    </span>
                </div>
                <div className="mt-2 space-y-1">
                    {actionDataList.slice(0, 3).map((action, i) => (
                        <p key={i} className="text-xs text-zinc-500">• {action.description}</p>
                    ))}
                    {totalActions > 3 && (
                        <p className="text-xs text-zinc-500">...and {totalActions - 3} more</p>
                    )}
                </div>
            </div>
        );
    }

    if (status === "refused") {
        return (
            <div className="rounded-lg border border-zinc-800 bg-zinc-925 p-2.5">
                <div className="flex items-center gap-2">
                    <X size={13} className="text-zinc-500" />
                    <span className="text-xs text-zinc-500">
                        {appliedCount > 0 ? `${appliedCount} applied; ${totalActions - appliedCount} remaining changes refused` : `${totalActions} change${totalActions > 1 ? "s" : ""} refused`}
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-925">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 px-2.5 py-1.5">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-zinc-300">
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
            <div className="space-y-1.5 border-b border-zinc-800 px-2.5 py-2">
                {actionDataList.slice(0, isExpanded ? totalActions : (isSingleAction ? 1 : 2)).map((action, i) => {
                    const meta = getActionMeta(action.action);
                    const Icon = meta.icon;
                    const preview = getPreviewText(action);

                    return (
                        <div key={i} className="flex items-start gap-2">
                            <Icon size={12} className={`${meta.textClass} mt-0.5 flex-shrink-0`} />
                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] text-zinc-300">{action.description}</p>
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
                <div className="border-b border-zinc-800 px-2.5 py-2">
                    <div className="flex items-center gap-2">
                        <div className="size-3 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-200" />
                        <span className="text-xs text-zinc-300">
                            Applying changes... {appliedCount}/{totalActions}
                        </span>
                    </div>
                    <div className="mt-2 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-zinc-300"
                            style={{ width: `${(appliedCount / totalActions) * 100}%` }}
                        />
                    </div>
                </div>
            )}

            {error && <p role="alert" className="px-3 py-2 text-xs text-red-300">{error}{appliedCount > 0 && ` ${appliedCount}/${totalActions} changes applied; retry continues with the remaining changes.`}</p>}

            {/* Actions */}
            <div className="flex gap-1.5 p-1.5">
                <button
                    onClick={onApprove}
                    disabled={isProcessing}
                    className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-blue-500 text-xs font-medium text-zinc-925 hover:bg-blue-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                    <Check size={13} />
                    {appliedCount > 0 ? `Approve remaining (${totalActions - appliedCount})` : isSingleAction ? "Approve" : `Approve All (${totalActions})`}
                </button>
                <button
                    onClick={onRefuse}
                    disabled={isProcessing}
                    className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100 disabled:cursor-not-allowed"
                >
                    <X size={13} />
                    {isSingleAction ? "Refuse" : "Refuse All"}
                </button>
            </div>
        </div>
    );
}
