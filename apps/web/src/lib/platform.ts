const COMFYUI_URL_KEY = "flowscale_comfyui_url";
const DEFAULT_COMFYUI_URL = "http://localhost:8188";

export function isDesktop(): boolean {
  return (
    typeof window !== "undefined" && window.desktop?.isDesktop === true
  );
}

export function getComfyUIUrl(): string {
  if (typeof window === "undefined") return DEFAULT_COMFYUI_URL;
  return localStorage.getItem(COMFYUI_URL_KEY) || DEFAULT_COMFYUI_URL;
}

export function setComfyUIUrl(url: string): void {
  localStorage.setItem(COMFYUI_URL_KEY, url);
}
