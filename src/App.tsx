import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import JSZip from "jszip";
import React, { useRef, useState } from "react";
import { DownloadIcon } from "./components/DownloadIcon";

interface FileProgress {
  filename: string;
  progress: number;
  status: string;
  isComplete: boolean;
  hasError: boolean;
  fileSizeBeforeCompression: number;
  fileSizeAfterCompression: number | undefined;
}

interface ProcessedFile {
  filename: string;
  blob: Blob;
}

const App = () => {
  const [loaded, setLoaded] = useState(false);
  const ffmpegRef = useRef(new FFmpeg());
  const [statusText, setStatusText] = useState("");
  const [fileProgresses, setFileProgresses] = useState<FileProgress[]>([]);
  const [mp4Files, setMp4Files] = useState<ProcessedFile[]>([]);
  const [thumbnailFiles, setThumbnailFiles] = useState<ProcessedFile[]>([]);
  const [isDragover, setIsDragover] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const currentFileIndexRef = useRef<number>(-1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLParagraphElement | null>(null);

  const convertBytesToMB = (bytes: number) => {
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  };

  const load = async () => {
    const baseURL =
      "https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/esm";
    const ffmpeg = ffmpegRef.current;

    ffmpeg.on("log", ({ message }) => {
      if (messageRef.current) messageRef.current.innerHTML = message;
    });
    ffmpeg.on("progress", ({ progress, time }) => {
      console.log("progress", progress);
      console.log("time", time);
    });

    // toBlobURL is used to bypass CORS issue, urls with the same
    // domain can be used directly.
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(
        `${baseURL}/ffmpeg-core.wasm`,
        "application/wasm"
      ),
      workerURL: await toBlobURL(
        `${baseURL}/ffmpeg-core.worker.js`,
        "text/javascript"
      ),
    });
    setLoaded(true);
  };

  load();

  // const ffmpeg = new FFmpeg();
  // {
  // log: true,
  // progress: ({ ratio }) => {
  //   // Update progress for the currently processing file
  //   const currentIndex = currentFileIndexRef.current;
  //   if (currentIndex >= 0 && ratio > 0) {
  //     setFileProgresses((prev) =>
  //       prev.map((fp, index) =>
  //         index === currentIndex
  //           ? {
  //               ...fp,
  //               progress: Math.round(2 + ratio * 98), // 2% base + 98% for compression
  //               status: "",
  //             }
  //           : fp
  //       )
  //     );
  //   }
  // },
  // }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragover(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragover(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragover(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  };

  const handleFiles = async (fileList: FileList) => {
    if (!fileList.length) return;

    const files = Array.from(fileList).filter((f) => f.type === "video/mp4");
    if (!files.length) {
      setStatusText("Please select MP4 files only.");
      return;
    }

    setFileProgresses([]);
    setMp4Files([]);
    setThumbnailFiles([]);

    const newFileProgresses: FileProgress[] = files.map((file) => ({
      filename: file.name,
      progress: 0,
      status: "Preparing...",
      isComplete: false,
      hasError: false,
      fileSizeBeforeCompression: file.size,
      fileSizeAfterCompression: undefined,
    }));
    setFileProgresses(newFileProgresses);

    const processedMp4Files: ProcessedFile[] = [];
    const processedThumbnailFiles: ProcessedFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      currentFileIndexRef.current = i; // Set current file index for progress callback
      setStatusText(`Compressing (${i + 1}/${files.length}): ${file.name}`);

      const updateFileProgress = (
        progress: number,
        status: string,
        isComplete = false,
        hasError = false,
        fileSizeBeforeCompression: number | undefined = undefined,
        fileSizeAfterCompression: number | undefined = undefined
      ) => {
        setFileProgresses((prev) =>
          prev.map((fp, index) =>
            index === i
              ? {
                  ...fp,
                  progress,
                  status,
                  isComplete,
                  hasError,
                  fileSizeBeforeCompression:
                    fileSizeBeforeCompression ??
                    fp.fileSizeBeforeCompression ??
                    0,
                  fileSizeAfterCompression:
                    fileSizeAfterCompression ??
                    fp.fileSizeAfterCompression ??
                    0,
                }
              : fp
          )
        );
      };

      const inputName = `input${i}.mp4`;
      const outputMp4Name = file.name.replace(/\.mp4$/i, "-compressed.mp4");
      const baseName = file.name.replace(/\.mp4$/i, "");
      const outputThumbnailName = `${baseName}-thumbnail.jpg`;

      try {
        const ffmpeg = ffmpegRef.current;

        updateFileProgress(1, "Loading file...");
        await ffmpeg.writeFile(inputName, await fetchFile(file));

        updateFileProgress(
          2,
          "Starting compression...",
          false,
          false,
          file.size
        );
        // The FFmpeg progress callback will update progress from 10% to ~85%
        await ffmpeg.exec([
          "-i",
          inputName,
          // "-c:v",
          // "libx264",
          // "-crf",
          // "23",
          // "-preset",
          // "medium",
          // "-c:a",
          // "aac",
          // "-b:a",
          // "128k",
          outputMp4Name,
        ]);

        updateFileProgress(98, "Creating thumbnail...");
        const mp4Data = await ffmpeg.readFile(outputMp4Name);
        const mp4Blob = new Blob(
          [new Uint8Array(mp4Data as unknown as ArrayBuffer)],
          { type: "video/mp4" }
        );
        processedMp4Files.push({ filename: outputMp4Name, blob: mp4Blob });

        // Extract first frame as jpg
        await ffmpeg.exec([
          "-i",
          inputName,
          // "-ss",
          // "0",
          // "-frames:v",
          // "1",
          outputThumbnailName,
        ]);

        updateFileProgress(99, "Finalizing...");
        const thumbData = await ffmpeg.readFile(outputThumbnailName);
        const thumbBlob = new Blob(
          [new Uint8Array(thumbData as unknown as ArrayBuffer).buffer],
          { type: "image/jpeg" }
        );
        processedThumbnailFiles.push({
          filename: outputThumbnailName,
          blob: thumbBlob,
        });

        // Clean up FS
        ffmpeg.deleteFile(inputName);
        ffmpeg.deleteFile(outputMp4Name);
        ffmpeg.deleteFile(outputThumbnailName);

        updateFileProgress(
          100,
          "Complete!",
          true,
          false,
          file.size,
          mp4Blob.size
        );

        setMp4Files(processedMp4Files);
        setThumbnailFiles(processedThumbnailFiles);
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : "An unknown error occurred";
        updateFileProgress(0, `Error: ${errorMessage}`, false, true);
      } finally {
        currentFileIndexRef.current = -1; // Reset current file index
      }
    }

    setStatusText("All compressions complete!");
  };

  const downloadAll = async () => {
    if (!mp4Files.length && !thumbnailFiles.length) return;

    setIsDownloading(true);

    const zip = new JSZip();

    mp4Files.forEach(({ filename, blob }) => {
      zip.file(filename, blob);
    });

    thumbnailFiles.forEach(({ filename, blob }) => {
      zip.file(filename, blob);
    });

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = "compressed_mp4_files_with_thumbnails.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setIsDownloading(false);
  };

  return (
    <div className="prose prose-lg max-w-7xl container mx-auto py-8 px-4">
      <h1 className="text-center">MP4 Compressor</h1>

      {!loaded ? (
        <div
          className={`w-full p-8 rounded-lg shadow-md text-center transition-colors bg-white`}
        >
          <p className="animate-pulse">Loading compression binary</p>
        </div>
      ) : (
        <div
          className={`w-full p-8 rounded-lg shadow-md text-center transition-colors ${
            isDragover ? "bg-sky-600/20" : "bg-white"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <p>
            Drag & drop MP4 files here
            <br />
            or
            <br />
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4"
              multiple
              onChange={handleFileInput}
              className="border border-sky-600/40 p-4 rounded-xl text-sm text-sky-800 file:rounded-md file:mr-5 file:py-1 file:px-3 file:border-[1px] file:text-xs file:font-medium file:bg-sky-50 file:text-sky-700 hover:file:cursor-pointer hover:file:bg-sky-50 hover:file:text-sky-700"
            />
          </p>

          <p ref={messageRef}></p>

          <div className="text-slate-500 text-sm mt-4">
            {statusText ?? <>&nbsp;</>}
          </div>

          {fileProgresses.length > 0 && (
            <div className="mt-4">
              <table className="w-full [&_td]:align-top">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Progress</th>
                    <th>Original</th>
                    <th>Compressed</th>
                    <th className="min-w-[100px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {fileProgresses.map((fp, index) => (
                    <tr key={index}>
                      <td className="flex justify-between items-center mb-2">
                        <h4 className="not-prose break-all text-sm">
                          {fp.filename}
                        </h4>
                      </td>
                      <td>
                        <div className="progress-bar min-w-[200px] w-full h-5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`progress-fill h-full transition-all duration-500 ease-in-out ${
                              fp.hasError
                                ? "bg-red-500"
                                : fp.isComplete
                                ? "bg-green-600"
                                : "bg-sky-600"
                            }`}
                            style={{ width: `${fp.progress}%` }}
                          />
                        </div>
                        <div className="text-sm font-semibold text-gray-700 text-center">
                          {fp.progress}%
                        </div>
                      </td>
                      <td>{convertBytesToMB(fp.fileSizeBeforeCompression)}</td>
                      <td>
                        {fp.fileSizeAfterCompression
                          ? convertBytesToMB(fp.fileSizeAfterCompression)
                          : ""}
                      </td>
                      <td>
                        <p className="flex flex-wrap gap-3 not-prose">
                          {mp4Files[index] && (
                            <a
                              aria-label="Download MP4"
                              href={URL.createObjectURL(
                                mp4Files[index].blob as Blob
                              )}
                              download={mp4Files[index].filename}
                              className="hover:underline text-sky-600 hover:text-sky-800 flex items-center gap-1"
                            >
                              <DownloadIcon className="size-3" /> MP4
                            </a>
                          )}
                          {thumbnailFiles[index] && (
                            <a
                              aria-label="Download JPG"
                              href={URL.createObjectURL(
                                thumbnailFiles[index].blob as Blob
                              )}
                              download={thumbnailFiles[index].filename}
                              className="hover:underline text-sky-600 hover:text-sky-800 flex items-center gap-1"
                            >
                              <DownloadIcon className="size-3" /> JPG
                            </a>
                          )}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(mp4Files.length > 0 || thumbnailFiles.length > 0) && (
            <div className="flex justify-center mt-4">
              <button
                onClick={downloadAll}
                disabled={isDownloading}
                className="flex items-center gap-x-1.5 rounded-md bg-sky-600 px-2.5 py-1.5 text-sm font-semibold text-white shadow-xs hover:bg-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:opacity-50"
              >
                <DownloadIcon className="size-4" />
                <span>
                  {isDownloading ? "Zipping..." : "Download All as ZIP"}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      <div className="text-center mt-8 prose-sm prose mx-auto max-w-3xl">
        <p>
          This tool compresses MP4 files to reduce their size. It also extracts
          the first frame of the video as a thumbnail. This tool is free and
          open source. You can find the source code on{" "}
          <a href="https://github.com/michaelbonner/mp4-compressor">GitHub</a>.
        </p>
        <p>
          <strong>Privacy note:</strong> Videos never leave your computer! All
          of the processing happens locally on your device.
        </p>
        <p className="mt-8 mb-0">
          Provided by{" "}
          <a href="https://bootpackdigital.com/">Bootpack Digital</a>
          <br />
          Come check us out so we can{" "}
          <a href="https://bootpackdigital.com/">
            build a custom website or app for you
          </a>
        </p>
        <p className="mt-0">
          <a href="https://bootpackdigital.com/">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              enableBackground="new 0 0 922 278"
              viewBox="0 0 922 278"
              className="w-80 mx-auto"
            >
              <path
                d="m218.8 138.6c1.9 1.7 3.6 3.7 4.9 6 2 3.5 3.2 7.6 3.2 12v35.9c0 8.9-4.8 16.6-12 20.7v-56.7c0-6.6-5.4-12-12-12h-83.8v-12h83.9c6.6 0 12-5.4 12-12v-35.9c-.1-6.5-5.4-11.8-12-11.8h-119.7v119.7h-12v-131.7h131.7c4.4 0 8.4 1.2 12 3.2 3.6 2.1 6.7 5.1 8.8 8.8 2 3.5 3.2 7.6 3.2 12v35.9c0 4.4-1.2 8.4-3.2 12-1.4 2.2-3 4.2-5 5.9z"
                fill="#005d8f"
              />
              <path
                d="m203 162.6v47.9c0 2.6-1.7 4.8-4 5.6-.6.2-1.3.3-2 .3h-48.2c-3.1 0-5.7-2.5-5.7-5.7v-24.6c0-3.1 2.5-5.7 5.7-5.7h30.2v12h-22.4c-.9 0-1.5.7-1.5 1.5v8.9c0 .9.7 1.5 1.5 1.5h33.1c.7 0 1.3-.6 1.3-1.3v-33.3c0-.7-.6-1.3-1.3-1.3h-57c-.9 0-1.5.7-1.5 1.5v46.4h-12v-54.2c0-3.1 2.5-5.7 5.7-5.7h72.1c3.3.2 6 2.9 6 6.2z"
                fill="#f06052"
              />
              <path
                d="m203 90.7v23.9c0 3.3-2.7 6-6 6h-77.8v-12h70.3c.9 0 1.5-.7 1.5-1.5v-8.9c0-.9-.7-1.5-1.5-1.5h-82.3v119.7h-35.9v-12h23.9v-119.7h101.8c3.3 0 6 2.7 6 6z"
                fill="#2787b7"
              />
              <g fill="#f06052">
                <path d="m294.7 181.9c3.8 0 6 2.3 6 6v5.2c0 3.6-2.2 6-6 6h-5.9v-17.1h5.9zm0 2.5h-2.9v12.3h2.9c2 0 3.1-1.1 3.1-3.6v-5c0-2.6-1-3.7-3.1-3.7z" />
                <path d="m386.7 181.9v17.1h-3v-17.1z" />
                <path d="m481.3 185.3-2.2.8c-.6-1.5-1.7-2.2-3.1-2.2-2.3 0-3.4 1.3-3.4 3.9v5.3c0 2.4 1.2 3.5 3.3 3.5 1.3 0 2.2-.4 2.9-1.5v-3h-2.2v-2h4.8v8.7h-2.4v-1.3c-1 1-2.3 1.5-3.8 1.5-3.4 0-5.5-2-5.5-5.9v-5.3c0-3.8 2-6.3 6.1-6.3 2.7 0 4.8 1.5 5.5 3.8z" />
                <path d="m567.2 181.9v17.1h-3v-17.1z" />
                <path d="m661.2 181.9v2.6h-4v14.6h-3v-14.6h-4v-2.6z" />
                <path d="m747.2 199.1h-3l5.4-17.1h3.3l5.4 17.1h-3l-1.1-4h-5.8zm1.7-6.2h4.6l-2.3-8.3z" />
                <path d="m844.1 181.9v14.6h6.3v2.6h-9.2v-17.1h2.9z" />
              </g>
              <g fill="#005d8f">
                <path d="m288.9 79.2h41.9c6.8 0 11.9 1.6 15.1 4.7s4.8 7.8 4.8 14.2c0 4.2-.9 7.6-2.7 10.2s-4 4.4-6.7 5.5c5.7 1.5 9.5 5.3 11.5 11.3.7 2.2 1 4.7 1 7.5 0 6.8-1.6 11.9-4.8 15.1s-8.2 4.8-15.1 4.8h-45zm42.9 20.9c0-4.2-2.1-6.3-6.3-6.3h-17.8v14.7h17.8c4.2 0 6.3-2.1 6.3-6.3zm3.1 29.3c0-4.2-2.1-6.3-6.3-6.3h-20.9v14.6h20.9c4.2 0 6.3-2.1 6.3-6.3z" />
                <path d="m429.1 132.6c0 7.3-1.7 12.6-5 16-3.3 3.3-8.6 5-16 5h-26.1c-7.3 0-12.6-1.7-16-5-3.3-3.3-5-8.6-5-16v-33.5c0-7.3 1.7-12.6 5-16 3.3-3.3 8.6-5 16-5h26.2c7.3 0 12.6 1.7 16 5 3.3 3.3 5 8.6 5 16v33.5zm-18.9-33.5c0-4.2-2.1-6.3-6.3-6.3h-17.8c-4.2 0-6.3 2.1-6.3 6.3v33.5c0 4.2 2.1 6.3 6.3 6.3h17.9c4.2 0 6.3-2.1 6.3-6.3v-33.5z" />
                <path d="m505.5 132.6c0 7.3-1.7 12.6-5 16-3.3 3.3-8.6 5-16 5h-26.2c-7.3 0-12.6-1.7-16-5-3.3-3.3-5-8.6-5-16v-33.5c0-7.3 1.7-12.6 5-16 3.3-3.3 8.6-5 16-5h26.2c7.3 0 12.6 1.7 16 5 3.3 3.3 5 8.6 5 16zm-18.9-33.5c0-4.2-2.1-6.3-6.3-6.3h-17.8c-4.2 0-6.3 2.1-6.3 6.3v33.5c0 4.2 2.1 6.3 6.3 6.3h17.8c4.2 0 6.3-2.1 6.3-6.3z" />
                <path d="m551.5 152.4h-18.8v-58.6h-22v-14.6h62.8v14.6h-22z" />
              </g>
              <g fill="#2787b7">
                <path d="m580.8 79.2h44c7.3 0 12.6 1.7 16 5 3.3 3.3 5 8.6 5 16v10.5c0 7.3-1.7 12.6-5 16-3.3 3.3-8.6 5-16 5h-25.1v20.9h-18.8v-73.4zm46.1 20.9c0-4.2-2.1-6.3-6.3-6.3h-20.9v23h20.9c4.2 0 6.3-2.1 6.3-6.3z" />
                <path d="m777.6 151.4c-15.6 1.4-28.5 2.1-38.7 2.1-6.8 0-11.9-1.6-15.1-4.8s-4.8-8.2-4.8-15.1v-33.5c0-7.3 1.7-12.6 5-16 3.3-3.3 8.6-5 16-5h37.7v14.6h-33.5c-4.2 0-6.3 2.1-6.3 6.3v33.5c0 1.6.5 2.9 1.4 3.8s2.1 1.4 3.6 1.4 3.1 0 4.8-.1c1.7 0 3.6-.1 5.4-.2 1.9-.1 3.8-.1 5.7-.2s4.4-.2 7.4-.4 6.8-.5 11.4-.7z" />
                <path d="m804.8 152.4h-18.8v-73.2h18.8v28.8h9.4l16.3-28.8h19.9l-20.5 36.1 20.4 37.2h-19.9l-16.2-29.8h-9.4z" />
                <path d="m690.2 79.2h-20.9l-27.8 73.2h20.4.4l7.8-23 8.5-25.1 2.1 5.9 1.9-.6 6.7 19.8 2.8 7.3-7.8-7.3-3.3 12.9-3.5-10.4-3.2 4.4-3-2.8-6.4 18.9h32.6 20.4z" />
              </g>
            </svg>
          </a>
        </p>
      </div>
    </div>
  );
};

export default App;
