/**
 * archives.ts — Multi-engine multi-file archive creator and extractor.
 *
 * Supports:
 *  - .zip (Standard Deflate & Store via zip.ts)
 *  - .tar.gz / .tgz (POSIX UStar tarball streamed through native CompressionStream('gzip'))
 *  - .gz (Single file native Gzip stream)
 *  - .tar (Fast uncompressed POSIX container)
 *
 * Bounded streaming chunking (64 KiB segments) to minimize heap pressure on low-memory devices.
 */

import { writeZip, readZip, type ZipEntryIn } from "./zip";
import { writeTar, readTar, type TarEntry } from "./tar";

export type ArchiveFormat = "zip" | "tar.gz" | "gz" | "tar";

export interface ArchiveFile {
  name: string;
  data: Uint8Array;
}

export interface ArchiveResult {
  data: Uint8Array;
  format: ArchiveFormat;
  filename: string;
  mimeType: string;
  uncompressedBytes: number;
  compressedBytes: number;
  ratio: number;
}

/**
 * Checks if modern Web Streams CompressionStream is supported in the environment.
 */
export function isNativeCompressionSupported(format: "gzip" | "deflate" | "deflate-raw" = "gzip"): boolean {
  if (typeof CompressionStream === "undefined") return false;
  try {
    new CompressionStream(format);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pipes a byte buffer through a native Web Streams CompressionStream in 64 KiB chunks.
 */
export async function streamCompressBytes(
  bytes: Uint8Array,
  format: "gzip" | "deflate" | "deflate-raw" = "gzip",
  onProgress?: (ratio: number) => void,
): Promise<Uint8Array> {
  const cs = new CompressionStream(format);
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  const chunkSize = 64 * 1024; // 64 KiB chunks for smooth memory footprint
  const total = bytes.length;
  let written = 0;

  // Stream write in background
  const writePromise = (async () => {
    for (let offset = 0; offset < total; offset += chunkSize) {
      const slice = bytes.subarray(offset, Math.min(total, offset + chunkSize));
      await writer.write(slice as BufferSource);
      written += slice.length;
      onProgress?.(total > 0 ? (written / total) * 0.7 : 0.5);
    }
    await writer.close();
  })();

  // Collect compressed chunks
  const outChunks: Uint8Array[] = [];
  let compressedTotal = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    outChunks.push(value);
    compressedTotal += value.length;
  }

  await writePromise;
  onProgress?.(1.0);

  const combined = new Uint8Array(compressedTotal);
  let pos = 0;
  for (const chunk of outChunks) {
    combined.set(chunk, pos);
    pos += chunk.length;
  }

  return combined;
}

/**
 * Pipes a compressed byte buffer through a native Web Streams DecompressionStream.
 */
export async function streamDecompressBytes(
  bytes: Uint8Array,
  format: "gzip" | "deflate" | "deflate-raw" = "gzip",
): Promise<Uint8Array> {
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  const writePromise = (async () => {
    try {
      await writer.write(bytes as BufferSource);
      await writer.close();
    } catch {
      // Ignore write errors if decompression stream is closed or aborted early
    }
  })();

  const outChunks: Uint8Array[] = [];
  let decompressedTotal = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    outChunks.push(value);
    decompressedTotal += value.length;
  }

  await writePromise;

  const combined = new Uint8Array(decompressedTotal);
  let pos = 0;
  for (const chunk of outChunks) {
    combined.set(chunk, pos);
    pos += chunk.length;
  }

  return combined;
}

/**
 * Bundles multiple files into a chosen archive format.
 */
export async function createArchive(
  files: ArchiveFile[],
  format: ArchiveFormat = "zip",
  bundleBaseName: string = "archive",
  onProgress?: (ratio: number, message: string) => void,
): Promise<ArchiveResult> {
  if (files.length === 0) {
    throw new Error("Cannot create archive: no files provided.");
  }

  const uncompressedBytes = files.reduce((acc, f) => acc + f.data.length, 0);

  let outputBytes: Uint8Array;
  let filename: string;
  let mimeType: string;

  switch (format) {
    case "zip": {
      onProgress?.(0.2, "Packing ZIP archive...");
      const zipEntries: ZipEntryIn[] = files.map((f) => ({
        name: f.name,
        data: f.data,
      }));
      outputBytes = await writeZip(zipEntries);
      filename = `${bundleBaseName}.zip`;
      mimeType = "application/zip";
      break;
    }
    case "tar.gz": {
      onProgress?.(0.2, "Building POSIX tarball...");
      const tarEntries: TarEntry[] = files.map((f) => ({
        name: f.name,
        data: f.data,
      }));
      const rawTar = writeTar(tarEntries);
      onProgress?.(0.5, "Streaming Gzip compression...");
      outputBytes = await streamCompressBytes(rawTar, "gzip", (p) =>
        onProgress?.(0.5 + p * 0.45, `Compressing Gzip: ${Math.round(p * 100)}%`),
      );
      filename = `${bundleBaseName}.tar.gz`;
      mimeType = "application/gzip";
      break;
    }
    case "gz": {
      if (files.length > 1) {
        // Multi-file Gzip automatically converts to tar.gz
        return createArchive(files, "tar.gz", bundleBaseName, onProgress);
      }
      onProgress?.(0.3, "Streaming single-file Gzip...");
      outputBytes = await streamCompressBytes(files[0].data, "gzip", (p) =>
        onProgress?.(0.3 + p * 0.65, `Gzip compression: ${Math.round(p * 100)}%`),
      );
      filename = `${files[0].name}.gz`;
      mimeType = "application/gzip";
      break;
    }
    case "tar": {
      onProgress?.(0.5, "Packaging uncompressed tarball...");
      const tarEntries: TarEntry[] = files.map((f) => ({
        name: f.name,
        data: f.data,
      }));
      outputBytes = writeTar(tarEntries);
      filename = `${bundleBaseName}.tar`;
      mimeType = "application/x-tar";
      break;
    }
  }

  onProgress?.(1.0, "Archive complete.");

  const compressedBytes = outputBytes.length;
  const ratio = uncompressedBytes > 0 ? (uncompressedBytes - compressedBytes) / uncompressedBytes : 0;

  return {
    data: outputBytes,
    format,
    filename,
    mimeType,
    uncompressedBytes,
    compressedBytes,
    ratio: Math.max(0, ratio),
  };
}

/**
 * Extracts files from a supported archive (.zip, .tar.gz, .tgz, .tar, .gz).
 */
export async function extractArchive(
  archiveBytes: Uint8Array,
  filename: string,
): Promise<ArchiveFile[]> {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".zip")) {
    const arrayBuffer = archiveBytes.buffer.slice(
      archiveBytes.byteOffset,
      archiveBytes.byteOffset + archiveBytes.byteLength,
    ) as ArrayBuffer;
    const entries = await readZip(arrayBuffer);
    const result: ArchiveFile[] = [];
    for (const [name, data] of entries.entries()) {
      result.push({ name, data });
    }
    return result;
  }

  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    const rawTar = await streamDecompressBytes(archiveBytes, "gzip");
    const tarEntries = readTar(rawTar);
    return tarEntries.map((t) => ({ name: t.name, data: t.data }));
  }

  if (lower.endsWith(".tar")) {
    const tarEntries = readTar(archiveBytes);
    return tarEntries.map((t) => ({ name: t.name, data: t.data }));
  }

  if (lower.endsWith(".gz")) {
    const decompressed = await streamDecompressBytes(archiveBytes, "gzip");
    const cleanName = filename.replace(/\.gz$/i, "");
    return [{ name: cleanName, data: decompressed }];
  }

  throw new Error(`Unsupported archive format for file "${filename}". Expected .zip, .tar.gz, .tar, or .gz.`);
}
