/**
 * AI Editor Actions for BlockNote
 * Supports: Insert, Update, Delete, Replace operations
 */

export interface EditorAction {
    type: "editor_action";
    action: "insertText" | "insertCode" | "insertHeading" | "insertParagraph" |
    "update" | "delete" | "replace";
    description: string;
    data: any;
}

export const handleAiAction = async (editor: any, action: EditorAction) => {
    if (!editor) {
        console.error("Editor instance not found");
        throw new Error("Editor not connected");
    }

    console.log("Executing AI Action:", JSON.stringify(action, null, 2));

    try {
        switch (action.action) {
            // === INSERT ACTIONS ===
            case "insertText":
                handleInsertText(editor, action.data);
                break;
            case "insertCode":
                handleInsertCodeBlock(editor, action.data);
                break;
            case "insertHeading":
                handleInsertHeading(editor, action.data);
                break;
            case "insertParagraph":
                handleInsertParagraph(editor, action.data);
                break;

            // === EDIT ACTIONS ===
            case "update":
                handleUpdate(editor, action.data);
                break;
            case "delete":
                handleDelete(editor, action.data);
                break;
            case "replace":
                handleReplace(editor, action.data);
                break;

            default:
                // Fallback to simple text insertion
                const text = extractText(action.data);
                if (text) {
                    editor.insertInlineContent(text);
                }
        }
        console.log("Successfully executed action");
    } catch (error) {
        console.error("Failed to execute AI action:", error);
        throw error;
    }
};

// =============================================================================
// INSERT HANDLERS
// =============================================================================

/**
 * Insert text at cursor position
 */
const handleInsertText = (editor: any, data: any) => {
    const text = extractText(data);
    if (text) {
        editor.insertInlineContent(text);
    }
};

/**
 * Insert a code block
 */
const handleInsertCodeBlock = (editor: any, data: any) => {
    const code = data.code || data.text || extractText(data);
    const language = data.language || "plaintext";

    const refBlockId = getLastBlockId(editor);
    if (refBlockId) {
        editor.insertBlocks(
            [{
                type: "codeBlock",
                props: { language },
                content: code,
            }],
            refBlockId,
            "after"
        );
    }
};

/**
 * Insert a heading
 */
const handleInsertHeading = (editor: any, data: any) => {
    const text = data.text || extractText(data);
    const level = data.level || 2;

    const refBlockId = getLastBlockId(editor);
    if (refBlockId) {
        editor.insertBlocks(
            [{
                type: "heading",
                props: { level },
                content: text,
            }],
            refBlockId,
            "after"
        );
    }
};

/**
 * Insert a paragraph
 */
const handleInsertParagraph = (editor: any, data: any) => {
    const text = data.text || extractText(data);

    const refBlockId = getLastBlockId(editor);
    if (refBlockId) {
        editor.insertBlocks(
            [{
                type: "paragraph",
                content: text,
            }],
            refBlockId,
            "after"
        );
    }
};

// =============================================================================
// EDIT HANDLERS
// =============================================================================

/**
 * Update an existing block
 * data: { blockId?: string, searchText?: string, newContent: string, newType?: string }
 */
const handleUpdate = (editor: any, data: any) => {
    const { blockId, searchText, newContent, newType } = data;

    let targetBlockId = blockId;

    // If no blockId provided, search for block containing the text
    if (!targetBlockId && searchText) {
        targetBlockId = findBlockByContent(editor, searchText);
    }

    if (!targetBlockId) {
        console.warn("No block found to update");
        throw new Error("Could not find the block to update. Try specifying the text more precisely.");
    }

    const update: any = {};
    if (newContent) update.content = newContent;
    if (newType) update.type = newType;

    editor.updateBlock(targetBlockId, update);
    console.log(`Updated block ${targetBlockId}`);
};

/**
 * Delete blocks
 * data: { blockIds?: string[], searchText?: string }
 */
const handleDelete = (editor: any, data: any) => {
    const { blockIds, searchText } = data;

    let idsToDelete: string[] = blockIds || [];

    // If no blockIds provided, search for block containing the text
    if (idsToDelete.length === 0 && searchText) {
        const foundId = findBlockByContent(editor, searchText);
        if (foundId) {
            idsToDelete = [foundId];
        }
    }

    if (idsToDelete.length === 0) {
        console.warn("No blocks found to delete");
        throw new Error("Could not find the block(s) to delete.");
    }

    editor.removeBlocks(idsToDelete);
    console.log(`Deleted blocks: ${idsToDelete.join(", ")}`);
};

/**
 * Replace blocks with new content
 * data: { blockIds?: string[], searchText?: string, newBlocks: Array<{type, content}> }
 */
const handleReplace = (editor: any, data: any) => {
    const { blockIds, searchText, newBlocks, newContent } = data;

    let idsToReplace: string[] = blockIds || [];

    // If no blockIds provided, search for block containing the text
    if (idsToReplace.length === 0 && searchText) {
        const foundId = findBlockByContent(editor, searchText);
        if (foundId) {
            idsToReplace = [foundId];
        }
    }

    if (idsToReplace.length === 0) {
        console.warn("No blocks found to replace");
        throw new Error("Could not find the block(s) to replace.");
    }

    // Build replacement blocks
    let replacementBlocks: any[] = [];

    if (newBlocks && Array.isArray(newBlocks)) {
        replacementBlocks = newBlocks.map(b => ({
            type: b.type || "paragraph",
            content: typeof b.content === "string" ? b.content : extractText(b),
            ...(b.props ? { props: b.props } : {})
        }));
    } else if (newContent) {
        replacementBlocks = [{
            type: "paragraph",
            content: newContent
        }];
    }

    if (replacementBlocks.length === 0) {
        throw new Error("No replacement content provided.");
    }

    editor.replaceBlocks(idsToReplace, replacementBlocks);
    console.log(`Replaced blocks: ${idsToReplace.join(", ")}`);
};

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Find a block by its content (fuzzy search)
 */
const findBlockByContent = (editor: any, searchText: string): string | null => {
    let foundId: string | null = null;
    const searchLower = searchText.toLowerCase().trim();

    editor.forEachBlock((block: any) => {
        if (foundId) return false; // Already found, stop searching

        const blockContent = getBlockTextContent(block);
        if (blockContent.toLowerCase().includes(searchLower)) {
            foundId = block.id;
            return false; // Stop traversal
        }
        return true; // Continue traversal
    });

    return foundId;
};

/**
 * Get text content from a block
 */
const getBlockTextContent = (block: any): string => {
    if (!block.content) return "";
    if (typeof block.content === "string") return block.content;
    if (Array.isArray(block.content)) {
        return block.content.map((c: any) => c.text || "").join("");
    }
    return "";
};

/**
 * Get the last block ID in the document
 */
const getLastBlockId = (editor: any): string | null => {
    const doc = editor.document;
    if (doc && doc.length > 0) {
        return doc[doc.length - 1].id;
    }
    return null;
};

/**
 * Extract plain text from any data structure
 */
const extractText = (data: any): string => {
    if (!data) return "";
    if (typeof data === "string") return data;
    if (data.text) return data.text;
    if (data.code) return data.code;
    if (data.content) {
        if (typeof data.content === "string") return data.content;
        if (Array.isArray(data.content)) {
            return data.content.map((item: any) => {
                if (typeof item === "string") return item;
                if (item.text) return item.text;
                return "";
            }).join("");
        }
    }
    if (data.blocks && Array.isArray(data.blocks)) {
        return data.blocks.map((block: any) => extractText(block)).join("\n\n");
    }
    return "";
};
