import { createFFmpeg, fetchFile } from "@ffmpeg/ffmpeg";
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
  const [statusText, setStatusText] = useState("");
  const [fileProgresses, setFileProgresses] = useState<FileProgress[]>([]);
  const [mp4Files, setMp4Files] = useState<ProcessedFile[]>([]);
  const [thumbnailFiles, setThumbnailFiles] = useState<ProcessedFile[]>([]);
  const [isDragover, setIsDragover] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const currentFileIndexRef = useRef<number>(-1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const convertBytesToMB = (bytes: number) => {
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  };

  const ffmpeg = createFFmpeg({
    log: true,
    progress: ({ ratio }) => {
      // Update progress for the currently processing file
      const currentIndex = currentFileIndexRef.current;
      if (currentIndex >= 0 && ratio > 0) {
        setFileProgresses((prev) =>
          prev.map((fp, index) =>
            index === currentIndex
              ? {
                  ...fp,
                  progress: Math.round(2 + ratio * 98), // 2% base + 98% for compression
                  status: "",
                }
              : fp
          )
        );
      }
    },
  });

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

    if (!ffmpeg.isLoaded()) await ffmpeg.load();

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
        updateFileProgress(1, "Loading file...");
        ffmpeg.FS("writeFile", inputName, await fetchFile(file));

        updateFileProgress(
          2,
          "Starting compression...",
          false,
          false,
          file.size
        );
        // The FFmpeg progress callback will update progress from 10% to ~85%
        await ffmpeg.run(
          "-i",
          inputName,
          "-c:v",
          "libx264",
          "-crf",
          "23",
          "-preset",
          "medium",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          outputMp4Name
        );

        updateFileProgress(98, "Creating thumbnail...");
        const mp4Data = ffmpeg.FS("readFile", outputMp4Name);
        const mp4Blob = new Blob([mp4Data.buffer], { type: "video/mp4" });
        processedMp4Files.push({ filename: outputMp4Name, blob: mp4Blob });

        // Extract first frame as jpg
        await ffmpeg.run(
          "-i",
          inputName,
          "-ss",
          "0",
          "-frames:v",
          "1",
          outputThumbnailName
        );

        updateFileProgress(99, "Finalizing...");
        const thumbData = ffmpeg.FS("readFile", outputThumbnailName);
        const thumbBlob = new Blob([thumbData.buffer], { type: "image/jpeg" });
        processedThumbnailFiles.push({
          filename: outputThumbnailName,
          blob: thumbBlob,
        });

        // Clean up FS
        ffmpeg.FS("unlink", inputName);
        ffmpeg.FS("unlink", outputMp4Name);
        ffmpeg.FS("unlink", outputThumbnailName);

        updateFileProgress(100, "Complete!", true);
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
      } catch (err: any) {
        updateFileProgress(0, `Error: ${err.message}`, false, true);
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
    <div className="prose prose-lg max-w-7xl container mx-auto py-8">
      <h1 className="text-center">MP4 Compressor</h1>
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
            className="text-sm text-stone-500 file:rounded-md file:mr-5 file:py-1 file:px-3 file:border-[1px] file:text-xs file:font-medium file:bg-stone-50 file:text-stone-700 hover:file:cursor-pointer hover:file:bg-sky-50 hover:file:text-sky-700"
          />
        </p>

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
                            href={URL.createObjectURL(mp4Files[index].blob)}
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
                              thumbnailFiles[index].blob
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
    </div>
  );
};

export default App;
