const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({
  log: true,
  progress: ({ ratio }) => {
    if (currentProgressCallback) {
      currentProgressCallback(ratio);
    }
  },
});
const dropArea = document.getElementById("drop-area");
const fileElem = document.getElementById("fileElem");
const progress = document.getElementById("progress");
const downloads = document.getElementById("downloads");
const downloadAllBtn = document.getElementById("download-all");

let mp4Files = []; // {filename, blob}
let thumbnailFiles = []; // {filename, blob}
let currentProgressCallback = null;

// Drag & drop handlers
dropArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropArea.classList.add("dragover");
});
dropArea.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dropArea.classList.remove("dragover");
});
dropArea.addEventListener("drop", (e) => {
  e.preventDefault();
  dropArea.classList.remove("dragover");
  handleFiles(e.dataTransfer.files);
});
fileElem.addEventListener("change", (e) => {
  handleFiles(e.target.files);
});

async function handleFiles(fileList) {
  if (!fileList.length) return;
  const files = Array.from(fileList).filter((f) => f.type === "video/mp4");
  if (!files.length) {
    progress.textContent = "Please select MP4 files only.";
    return;
  }
  progress.textContent = "Loading FFmpeg...";
  downloads.innerHTML = "";
  mp4Files = [];
  thumbnailFiles = [];
  downloadAllBtn.style.display = "none";
  if (!ffmpeg.isLoaded()) await ffmpeg.load();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    progress.textContent = `Compressing (${i + 1}/${files.length}): ${
      file.name
    }`;

    // Create progress bar for this file
    const fileProgress = document.createElement("div");
    fileProgress.className = "file-progress";
    fileProgress.innerHTML = `
            <h4 class="not-prose break-all">${file.name}</h4>
            <div class="progress-bar">
              <div class="progress-fill"></div>
            </div>
            <div class="progress-text">Preparing...</div>
          `;
    downloads.appendChild(fileProgress);

    const progressFill = fileProgress.querySelector(".progress-fill");
    const progressText = fileProgress.querySelector(".progress-text");

    // Set up progress callback for this file
    currentProgressCallback = (ratio) => {
      const percentage = Math.round(ratio * 100);
      progressFill.style.width = `${percentage}%`;
      progressText.textContent = `${percentage}% complete`;
    };

    const inputName = `input${i}.mp4`;
    const outputMp4Name = file.name.replace(/\.mp4$/i, "-compressed.mp4");
    const baseName = file.name.replace(/\.mp4$/i, "");
    const outputThumbnailName = `${baseName}-thumbnail.jpg`;

    try {
      progressText.textContent = "Loading file...";
      ffmpeg.FS("writeFile", inputName, await fetchFile(file));

      progressText.textContent = "Compressing...";
      // compress mp4
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

      progressText.textContent = "Creating thumbnail...";
      const mp4Data = ffmpeg.FS("readFile", outputMp4Name);
      const mp4Blob = new Blob([mp4Data.buffer], { type: "video/mp4" });
      const mp4Url = URL.createObjectURL(mp4Blob);
      const aMp4 = document.createElement("a");
      aMp4.href = mp4Url;
      aMp4.download = outputMp4Name;
      aMp4.textContent = `Download ${outputMp4Name}`;
      aMp4.className = "download-link text-sm";

      // add before and after file sizes
      const beforeSize = file.size;
      const afterSize = mp4Blob.size;
      const sizeDiff = beforeSize - afterSize;
      const sizeDiffPercentage = (sizeDiff / beforeSize) * 100;

      const isAfterSmaller = afterSize < beforeSize;

      const afterSizeMBForHumans = Intl.NumberFormat("en-US", {
        style: "unit",
        unit: "megabyte",
        unitDisplay: "narrow",
        maximumFractionDigits: 1,
      }).format(afterSize / 1024 / 1024);
      const beforeSizeMBForHumans = Intl.NumberFormat("en-US", {
        style: "unit",
        unit: "megabyte",
        unitDisplay: "narrow",
        maximumFractionDigits: 1,
      }).format(beforeSize / 1024 / 1024);
      const diffSizeMBForHumans = Intl.NumberFormat("en-US", {
        style: "unit",
        unit: "megabyte",
        unitDisplay: "narrow",
        signDisplay: "auto",
        maximumFractionDigits: 1,
      }).format(sizeDiff / 1024 / 1024);
      const sizeDiffText = `<span>${beforeSizeMBForHumans} &rarr; <strong>${afterSizeMBForHumans}</strong><br /><span class="font-bold ${
        isAfterSmaller ? "text-green-500" : "text-red-500"
      }">Difference: ${
        isAfterSmaller ? "&darr;" : "&uarr;"
      } ${diffSizeMBForHumans} MB (${sizeDiffPercentage.toFixed(
        2
      )}%)</span></span>`;
      const sizeDiffElement = document.createElement("div");
      sizeDiffElement.innerHTML = sizeDiffText;
      downloads.appendChild(sizeDiffElement);

      downloads.appendChild(aMp4);
      mp4Files.push({ filename: outputMp4Name, blob: mp4Blob });

      // Extract first frame as jpg
      // -ss 0 seeks to the first frame, -frames:v 1 extracts one frame
      await ffmpeg.run(
        "-i",
        inputName,
        "-ss",
        "0",
        "-frames:v",
        "1",
        outputThumbnailName
      );

      progressText.textContent = "Finalizing...";
      const thumbData = ffmpeg.FS("readFile", outputThumbnailName);
      const thumbBlob = new Blob([thumbData.buffer], {
        type: "image/jpeg",
      });
      const thumbUrl = URL.createObjectURL(thumbBlob);
      const aThumb = document.createElement("a");
      aThumb.href = thumbUrl;
      aThumb.download = outputThumbnailName;
      aThumb.textContent = `Download ${outputThumbnailName}`;
      aThumb.className = "download-link text-sm";
      downloads.appendChild(aThumb);
      thumbnailFiles.push({
        filename: outputThumbnailName,
        blob: thumbBlob,
      });

      // Clean up FS
      ffmpeg.FS("unlink", inputName);
      ffmpeg.FS("unlink", outputMp4Name);
      ffmpeg.FS("unlink", outputThumbnailName);

      // Mark as complete
      progressFill.style.width = "100%";
      progressFill.style.backgroundColor = "#096";
      progressText.textContent = "Complete!";
    } catch (err) {
      progressFill.style.backgroundColor = "#C10008";
      progressText.textContent = `Error: ${err.message}`;
      const errMsg = document.createElement("div");
      errMsg.textContent = `Failed to compress ${file.name}: ${err.message}`;
      downloads.appendChild(errMsg);
    }
  }

  currentProgressCallback = null;
  progress.textContent = "All compressions complete!";
  if (mp4Files.length > 0 || thumbnailFiles.length > 0) {
    downloadAllBtn.style.display = "flex";
  }
}

downloadAllBtn.addEventListener("click", async () => {
  if (!mp4Files.length && !thumbnailFiles.length) return;
  downloadAllBtn.disabled = true;
  const initialButtonHtml = downloadAllBtn.innerHTML;
  downloadAllBtn.innerHTML = "<span>Zipping...</span>";
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
  downloadAllBtn.disabled = false;
  downloadAllBtn.innerHTML = initialButtonHtml;
});
