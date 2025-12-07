import {
  PDFExporter,
  pdfDefaultSchemaMappings,
} from "@blocknote/xl-pdf-exporter";
import * as ReactPDF from "@react-pdf/renderer";
import { BlockNoteEditor } from "@blocknote/core";

export async function exportToPDF(editor: BlockNoteEditor<any, any, any>, filename: string = "document.pdf") {
  // Create the exporter
  const exporter = new PDFExporter(editor.schema as any, pdfDefaultSchemaMappings as any);

  // Convert the blocks to a react-pdf document
  const pdfDocument = await exporter.toReactPDFDocument(editor.document as any);

  // Use react-pdf to write to file:
  await ReactPDF.render(pdfDocument, filename);
}
