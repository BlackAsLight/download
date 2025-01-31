# Download

`download` is a function to support automatically resuming interrupted downloads
of large files for servers and content that support the Range header, instead of
having to restart the download from the beginning.

## Limitations and Requirements

- Acceptable status codes returned from fetch requests are 200, 201, and 206.
- If invalid information is received as a response then the readable returned
  from this function will receive an abort signal.

## Example

```ts
import { download } from "jsr:@doctor/download";

await Deno.mkdir(".output/", { recursive: true });
const { readable, headers } = await download("https://example.com/");
if (!headers.get("content-type")?.startsWith("text/html")) {
  await readable.cancel();
} else {
  const filename = headers.get("content-disposition")
    ?.split("; ")
    .find((x) => x.startsWith("filename="))
    ?.split("=")[1] ?? "index.html";
  await readable
    .pipeTo((await Deno.create(".output/" + filename)).writable);
  console.log("hello");
}
```
