const COMFYUI_URL_KEY = "flowscale_comfyui_url";
const DEFAULT_COMFYUI_URL = "http://localhost:8188";
const COMFYORG_API_KEY = "flowscale_comfyorg_api_key";

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

export function getComfyOrgApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(COMFYORG_API_KEY) || "";
}

export function setComfyOrgApiKey(key: string): void {
  localStorage.setItem(COMFYORG_API_KEY, key);
}
