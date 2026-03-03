export const getContentTypeFromFilename = (filename: string): string => {
  const extension = filename.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return `image/${extension === "jpg" ? "jpeg" : extension}`;
    case "mp4":
    case "webm":
    case "mov":
      return `video/${extension}`;
    case "mp3":
    case "wav":
    case "ogg":
      return `audio/${extension}`;
    case "json":
      return "application/json";
    case "glb":
    case "gltf":
      return `model/${extension}`;
    default:
      return "text/plain";
  }
};
