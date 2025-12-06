import {
  PDFExporter,
  pdfDefaultSchemaMappings,
} from "@blocknote/xl-pdf-exporter";
import * as ReactPDF from "@react-pdf/renderer";

// Create the exporter
const exporter = new PDFExporter(editor.schema, pdfDefaultSchemaMappings);

// Convert the blocks to a react-pdf document
const pdfDocument = await exporter.toReactPDFDocument(editor.document);

// Use react-pdf to write to file:
await ReactPDF.render(pdfDocument, `filename.pdf`);
