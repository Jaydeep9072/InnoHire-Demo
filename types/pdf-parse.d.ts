declare module "pdf-parse" {
  type PdfResult = { text: string; numpages: number; numrender: number; info: unknown; metadata: unknown; version: string };
  export default function pdfParse(data: Buffer): Promise<PdfResult>;
}
