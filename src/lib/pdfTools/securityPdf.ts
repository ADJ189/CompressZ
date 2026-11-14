/**
 * securityPdf.ts — Cryptographic password protection and decryption for PDF files.
 *
 * Uses QPDF WebAssembly engine to enforce AES-256/128 encryption standards,
 * dual user/owner passwords, and granular permission enforcement.
 */

import { runQpdfCommand } from "../qpdfWasm";

export type PdfEncryptionStandard =
  | "aes-256-r6" // PDF 2.0 (V=5, R=6) — Modern Standard (Default & Max Security)
  | "aes-256-r5" // PDF 1.7 (V=5, R=5) — AES-256-CBC (Acrobat 9+)
  | "aes-128";    // PDF 1.6 (V=4, R=4) — AES-128 (Legacy Compatible, --use-aes=y enforced)

export interface ProtectPdfOptions {
  userPassword?: string;
  ownerPassword?: string;
  standard?: PdfEncryptionStandard;
  keyLength?: 128 | 256;
  allowPrinting?: boolean;
  allowCopying?: boolean;
  allowModifying?: boolean;
  allowAnnotations?: boolean;
  onProgress?: (pct: number) => void;
}

export interface UnlockPdfOptions {
  password?: string;
  onProgress?: (pct: number) => void;
}

/**
 * Pure calculation: compile QPDF command-line encryption arguments.
 * Enforces AES-256 as standard default; strictly adds --use-aes=y for 128-bit.
 */
export function buildQpdfEncryptionArgs(
  options: ProtectPdfOptions,
  inputFile: string = "in.pdf",
  outputFile: string = "out.pdf",
): string[] {
  const userPass = options.userPassword || "";
  const ownerPass = options.ownerPassword || options.userPassword || "owner";
  
  // Default to 256-bit AES (PDF 2.0 V=5, R=6)
  const is128 = options.standard === "aes-128" || options.keyLength === 128;
  const keyLen = is128 ? "128" : "256";

  const args: string[] = [
    "--encrypt",
    userPass,
    ownerPass,
    keyLen,
  ];

  // Strictly enforce AES over insecure RC4 for 128-bit encryption
  if (is128) {
    args.push("--use-aes=y");
  }

  // Permissions flags
  if (options.allowPrinting === false) {
    args.push("--print=none");
  } else {
    args.push("--print=full");
  }

  if (options.allowCopying === false) {
    args.push("--extract=n");
  } else {
    args.push("--extract=y");
  }

  if (options.allowModifying === false) {
    args.push("--modify=none");
  }

  if (options.allowAnnotations === false) {
    args.push("--annotate=n");
  }

  args.push("--", inputFile, outputFile);
  return args;
}

/**
 * Encrypt a PDF document with user and/or owner passwords.
 */
export async function protectPdf(
  pdfBytes: Uint8Array,
  options: ProtectPdfOptions,
): Promise<Uint8Array> {
  if (!options.userPassword && !options.ownerPassword) {
    throw new Error("Please specify at least a user password or owner password.");
  }

  options.onProgress?.(15);
  const args = buildQpdfEncryptionArgs(options, "source.pdf", "encrypted.pdf");

  options.onProgress?.(40);
  const result = await runQpdfCommand(args, [
    { name: "source.pdf", data: pdfBytes },
  ]);

  options.onProgress?.(90);

  const out = result.outputFiles.find((f) => f.name === "encrypted.pdf");
  if (!out || out.data.length === 0) {
    throw new Error(`Encryption failed: ${result.stdout || "Unknown QPDF error"}`);
  }

  options.onProgress?.(100);
  return out.data;
}

/**
 * Decrypt a password-protected PDF document.
 */
export async function unlockPdf(
  pdfBytes: Uint8Array,
  options: UnlockPdfOptions = {},
): Promise<Uint8Array> {
  options.onProgress?.(20);

  const args: string[] = ["--decrypt"];
  if (options.password) {
    args.push(`--password=${options.password}`);
  }
  args.push("--", "locked.pdf", "unlocked.pdf");

  options.onProgress?.(50);
  const result = await runQpdfCommand(args, [
    { name: "locked.pdf", data: pdfBytes },
  ]);

  options.onProgress?.(90);
  const out = result.outputFiles.find((f) => f.name === "unlocked.pdf");
  if (!out || out.data.length === 0) {
    throw new Error(
      `Decryption failed. Please verify that the password is correct: ${result.stdout}`,
    );
  }

  options.onProgress?.(100);
  return out.data;
}
