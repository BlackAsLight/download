import { delay } from "@std/async/delay";

/**
 * # Overview
 * `download` is a function to support automatically resuming interrupted
 * downloads of large files for servers and content that support the Range
 * header, instead of having to restart the download from the beginning.
 *
 * ## Limitations and Requirements
 * - Acceptable status codes returned from fetch requests are 200, 201, and 206.
 * - If invalid information is received as a response then the readable returned
 * from this function will receive an abort signal.
 *
 * @example Basic Usage
 * ```ts
 * import { download } from "jsr:@doctor/download";
 *
 * await Deno.mkdir('.output/', { recursive: true });
 * const { readable, headers } = await download("https://example.com/");
 * if (!headers.get("content-type")?.startsWith("text/html")) {
 *   await readable.cancel();
 * } else {
 *   const filename = headers.get("content-disposition")
 *     ?.split("; ")
 *     .find(x => x.startsWith("filename="))
 *     ?.split("=")[1] ?? "index.html";
 *   await readable
 *     .pipeTo((await Deno.create(".output/" + filename)).writable);
 * console.log('hello')
 * }
 * ```
 *
 * @param url - The URL to download from.
 * @param init - The request init options.
 * @param retryDelay - The delay in milliseconds between retries.
 * @returns A promise that resolves to an object containing the readable stream and headers.
 *
 * @module
 */
export async function download(
  url: string | URL,
  init: RequestInit = {},
  retryDelay = 5_000,
): Promise<{ readable: ReadableStream<Uint8Array>; headers: Headers }> {
  init.headers = init.headers ?? {};
  let response = await fetch(url, init);
  const headers = new Headers(response.headers);
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  switch (response.status) {
    case 200:
    case 201:
    case 206:
      break;
    default:
      await response.body?.cancel();
      await writable.abort(
        `Invalid Status Code (${response.status}): ${response.statusText}`,
      );
      return { readable, headers };
  }

  const etag = response.headers.get("etag");
  const range = function (): { start: number; end: number } | null {
    const range = new Headers(init.headers).get("range");
    if (range == null) return null;
    const dashIndex = range.indexOf("-");
    const commaIndex = Math.max(range.indexOf(","), 0) || undefined;
    return {
      start: Number(range.substring(0, dashIndex)),
      end: Number(range.substring(dashIndex + 1, commaIndex)),
    };
  }();
  const contentRange = function (): {
    start: number;
    end: number;
    total: number;
  } | null {
    const contentRange = response.headers.get("content-range");
    if (contentRange == null) return null;
    if (!contentRange.startsWith("bytes ")) {
      throw new TypeError(
        `Content-Range header has unsupported unit: ${contentRange}`,
      );
    }
    const dashIndex = contentRange.indexOf("-");
    const slashIndex = contentRange.indexOf("/");
    const totalSize = contentRange.substring(slashIndex);
    return {
      start: Number(contentRange.substring(6, dashIndex)),
      end: Number(contentRange.substring(dashIndex + 1, slashIndex)),
      total: totalSize == "*" ? Infinity : Number(contentRange),
    };
  }();

  let currentSize = contentRange?.start ?? 0;
  let bytesLeft = contentRange == null
    ? Number(response.headers.get("content-length")) || Infinity
    : contentRange.end - contentRange.start;

  (async () => {
    while (true) {
      try {
        await response.body
          ?.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller): void {
                chunk = chunk.subarray(0, bytesLeft);
                currentSize += chunk.length;
                bytesLeft -= chunk.length;
                controller.enqueue(chunk);
              },
            }),
          )
          .pipeTo(writable, { preventClose: true, preventCancel: true });
        await writable.close();
        return;
      } catch {
        if (init.signal?.aborted) return;
      }
      await delay(retryDelay);
      init.headers = {
        ...init.headers,
        range: `bytes=${currentSize}-${range?.end ?? ""}`,
        "if-match": etag ?? "",
      };
      response = await fetch(url, init);
      if (response.status !== 206) {
        await response.body?.cancel();
        await writable.abort(`Status Code (${response.status}) wasn't 206`);
        return;
      }
    }
  })();

  return { readable, headers };
}
