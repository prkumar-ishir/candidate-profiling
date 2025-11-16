import JSZip from 'jszip';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorker;

type PdfTextItem = {
  str?: string;
};

const SUPPORTED_FILE_TYPES = ['pdf', 'docx', 'txt', 'text'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFileError';
  }
}

export async function fileToPlainText(file: File): Promise<string> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('Maximum file size is 10 MB.');
  }

  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!SUPPORTED_FILE_TYPES.includes(extension)) {
    throw new UnsupportedFileError('Only PDF, DOCX, or TXT files are supported.');
  }

  if (extension === 'pdf') {
    return extractPdfText(file);
  }

  if (extension === 'docx') {
    return extractDocxText(file);
  }

  return readTextFile(file);
}

async function extractPdfText(file: File): Promise<string> {
  const pdfData = await file.arrayBuffer();
  const pdf = await getDocument({ data: pdfData }).promise;
  const textChunks: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = (content.items as PdfTextItem[])
      .map((item) => item.str ?? '')
      .join(' ');
    textChunks.push(pageText);
  }

  return textChunks.join('\n');
}

async function extractDocxText(file: File): Promise<string> {
  const docData = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(docData);
  const documentFile = zip.file('word/document.xml');

  if (!documentFile) {
    throw new Error('Unable to read DOCX contents.');
  }

  const xmlText = await documentFile.async('text');
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
  const textNodes = Array.from(xmlDoc.getElementsByTagName('w:t'));

  return textNodes.map((node) => node.textContent ?? '').join(' ');
}

async function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Unable to read the file.'));
    reader.readAsText(file);
  });
}
